#!/usr/bin/env node
/**
 * stocks-fetch.mjs — Fetches stock market data from Yahoo Finance (server-side)
 * and writes apps/stocks/data/market.json for the Stocks PWA.
 *
 * Runs in GitHub Actions (Node 20). Yahoo blocks browser CORS, so this runs
 * server-side where CORS does not apply. Yahoo rate-limits aggressively, so we
 * alternate hosts, delay between calls, retry with backoff, and skip failures.
 * If no quotes can be fetched at all, the script exits non-zero so the workflow
 * does NOT commit — the last good data file stays in place.
 *
 * Universe: the full S&P 500 (~500 constituents) plus major indices/ETFs.
 * Quotes + detail are fetched in batches via the v7 quote endpoint (fast).
 * Candles: 1-month daily for every symbol (sparkline + 1M chart + prediction),
 * plus 6-month and 1-year for core symbols (indices + default watchlist).
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "apps", "stocks", "data", "market.json");

const YF_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Symbol universe. Indices + default watchlist are "core" (get full candle
// history); the S&P 500 constituents are searchable and get quotes + 1M
// candles. Extend SP500 to broaden coverage.
const INDICES = ["SPY", "QQQ", "DIA", "IWM", "^VIX", "TLT", "GLD", "EEM"];
const WATCHLIST = ["SPY", "AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"];
const SP500 = [
  "MMM", "AOS", "ABT", "ABBV", "ACN", "ADBE", "AMD", "AES",
  "AFL", "A", "APD", "ABNB", "AKAM", "ALB", "ARE", "ALGN",
  "ALLE", "LNT", "ALL", "GOOGL", "GOOG", "MO", "AMZN", "AMCR",
  "AEE", "AEP", "AXP", "AIG", "AMT", "AWK", "AMP", "AME",
  "AMGN", "APH", "ADI", "AON", "APA", "APO", "AAPL", "AMAT",
  "APP", "APTV", "ACGL", "ADM", "ARES", "ANET", "AJG", "AIZ",
  "T", "ATO", "ADSK", "ADP", "AZO", "AVB", "AVY", "AXON",
  "BKR", "BALL", "BAC", "BAX", "BDX", "BRK-B", "BBY", "TECH",
  "BIIB", "BLK", "BX", "XYZ", "BNY", "BA", "BKNG", "BSX",
  "BMY", "AVGO", "BR", "BRO", "BF-B", "BLDR", "BG", "BXP",
  "CHRW", "CDNS", "CPT", "COF", "CAH", "CCL", "CARR", "CVNA",
  "CASY", "CAT", "CBOE", "CBRE", "CDW", "COR", "CNC", "CNP",
  "CF", "CRL", "SCHW", "CHTR", "CVX", "CMG", "CB", "CHD",
  "CIEN", "CI", "CINF", "CTAS", "CSCO", "C", "CFG", "CLX",
  "CME", "CMS", "KO", "CTSH", "COHR", "COIN", "CL", "CMCSA",
  "FIX", "COP", "ED", "STZ", "CEG", "COO", "CPRT", "GLW",
  "CPAY", "CTVA", "CSGP", "COST", "CRH", "CRWD", "CCI", "CSX",
  "CMI", "CVS", "DHR", "DRI", "DDOG", "DVA", "DECK", "DE",
  "DELL", "DAL", "DVN", "DXCM", "FANG", "DLR", "DG", "DLTR",
  "D", "DPZ", "DASH", "DOV", "DOW", "DHI", "DTE", "DUK",
  "DD", "ETN", "EBAY", "ECHO", "ECL", "EIX", "EW", "ELV",
  "EME", "EMR", "ETR", "EOG", "EQT", "EFX", "EQIX", "EQR",
  "ERIE", "ESS", "EL", "EG", "EVRG", "ES", "EXC", "EXE",
  "EXPE", "EXPD", "EXR", "XOM", "FFIV", "FDS", "FICO", "FAST",
  "FRT", "FDX", "FDXF", "FERG", "FIS", "FITB", "FSLR", "FE",
  "FISV", "FLEX", "F", "FTNT", "FTV", "FOXA", "FOX", "BEN",
  "FCX", "GRMN", "IT", "GE", "GEHC", "GEV", "GEN", "GNRC",
  "GD", "GIS", "GM", "GPC", "GILD", "GPN", "GL", "GDDY",
  "GS", "HAL", "HIG", "HAS", "HCA", "DOC", "HSIC", "HSY",
  "HPE", "HLT", "HD", "HONA", "HON", "HRL", "HST", "HWM",
  "HPQ", "HUBB", "HUM", "HBAN", "HII", "IBM", "IEX", "IDXX",
  "ITW", "INCY", "IR", "PODD", "INTC", "IBKR", "ICE", "IFF",
  "IP", "INTU", "ISRG", "IVZ", "INVH", "IQV", "IRM", "JBHT",
  "JBL", "JKHY", "J", "JNJ", "JCI", "JPM", "KVUE", "KDP",
  "KEY", "KEYS", "KMB", "KIM", "KMI", "KKR", "KLAC", "KHC",
  "KR", "LHX", "LH", "LRCX", "LVS", "LDOS", "LEN", "LII",
  "LLY", "LIN", "LYV", "LMT", "L", "LOW", "LULU", "LITE",
  "LYB", "MTB", "MPC", "MAR", "MRSH", "MLM", "MRVL", "MAS",
  "MA", "MKC", "MCD", "MCK", "MDT", "MRK", "META", "MET",
  "MTD", "MGM", "MCHP", "MU", "MSFT", "MAA", "MRNA", "TAP",
  "MDLZ", "MPWR", "MNST", "MCO", "MS", "MOS", "MSI", "MSCI",
  "NDAQ", "NTAP", "NFLX", "NEM", "NWSA", "NWS", "NEE", "NKE",
  "NI", "NDSN", "NSC", "NTRS", "NOC", "NCLH", "NRG", "NUE",
  "NVDA", "NVR", "NXPI", "ORLY", "OXY", "ODFL", "OMC", "ON",
  "OKE", "ORCL", "OTIS", "PCAR", "PKG", "PLTR", "PANW", "PSKY",
  "PH", "PAYX", "PYPL", "PNR", "PEP", "PFE", "PCG", "PM",
  "PSX", "PNW", "PNC", "PPG", "PPL", "PFG", "PG", "PGR",
  "PLD", "PRU", "PEG", "PTC", "PSA", "PHM", "PWR", "QCOM",
  "DGX", "Q", "RL", "RJF", "RTX", "O", "REG", "REGN",
  "RF", "RSG", "RMD", "RVTY", "HOOD", "ROK", "ROL", "ROP",
  "ROST", "RCL", "SPGI", "CRM", "SNDK", "SBAC", "SLB", "STX",
  "SRE", "NOW", "SHW", "SPG", "SWKS", "SJM", "SW", "SNA",
  "SOLV", "SO", "LUV", "SWK", "SBUX", "STT", "STLD", "STE",
  "SYK", "SMCI", "SYF", "SNPS", "SYY", "TMUS", "TROW", "TTWO",
  "TPR", "TRGP", "TGT", "TEL", "TDY", "TER", "TSLA", "TXN",
  "TPL", "TXT", "TMO", "TJX", "TKO", "TTD", "TSCO", "TT",
  "TDG", "TRV", "TRMB", "TFC", "TYL", "TSN", "USB", "UBER",
  "UDR", "ULTA", "UNP", "UAL", "UPS", "URI", "UNH", "UHS",
  "VLO", "VEEV", "VTR", "VLTO", "VRSN", "VRSK", "VZ", "VRTX",
  "VRT", "VTRS", "VICI", "V", "VST", "VMC", "WRB", "GWW",
  "WAB", "WMT", "DIS", "WBD", "WM", "WAT", "WEC", "WFC",
  "WELL", "WST", "WDC", "WY", "WSM", "WMB", "WTW", "WDAY",
  "WYNN", "XEL", "XYL", "YUM", "ZBRA", "ZBH", "ZTS",
];
const CORE = [...new Set([...INDICES, ...WATCHLIST])];
const ALL = [...new Set([...CORE, ...SP500])];

const DELAY_MS = 200;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, cookie) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Yahoo's v7 quote endpoint requires a crumb + cookie (401 without it).
// Fetch the cookie from fc.yahoo.com, then the crumb from /v1/test/getcrumb.
async function getCrumb() {
  const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const cookie = res.headers.get("set-cookie") || "";
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error("crumb HTTP " + crumbRes.status);
  const crumb = (await crumbRes.text()).trim();
  return { crumb, cookie };
}

async function fetchWithRetry(path, cookie) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const host = YF_HOSTS[attempt % YF_HOSTS.length];
    try {
      return await fetchJSON(host + path, cookie);
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── Batched quotes + detail (v7 quote, ~50 symbols per call) ────────────────
// The v7 quote endpoint returns price, change, volume, OHLC, market cap,
// valuation metrics, and names in one response. Batching keeps the call count
// low (~10 calls for the whole S&P 500) so the pipeline stays within Yahoo's
// rate limits.
async function fetchBatchQuotes(symbols, crumb, cookie) {
  const quotes = {};
  const BATCH = 50;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const path =
      "/v7/finance/quote?symbols=" + encodeURIComponent(batch.join(",")) +
      "&crumb=" + encodeURIComponent(crumb);
    try {
      const data = await fetchWithRetry(path, cookie);
      const results = data && data.quoteResponse ? data.quoteResponse.result : [];
      for (const r of results) {
        if (!r || !r.symbol) continue;
        const price = r.regularMarketPrice || 0;
        const prevClose = r.chartPreviousClose || r.regularMarketPreviousClose || 0;
        quotes[r.symbol] = {
          symbol: r.symbol,
          name: r.shortName || r.symbol,
          companyName: r.longName || r.shortName || r.symbol,
          exchange: r.fullExchangeName || r.exchangeName || "",
          price,
          change: r.regularMarketChange != null ? r.regularMarketChange : price - prevClose,
          changePercent: r.regularMarketChangePercent != null
            ? r.regularMarketChangePercent
            : prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
          volume: r.regularMarketVolume || 0,
          high: r.regularMarketDayHigh || 0,
          low: r.regularMarketDayLow || 0,
          open: r.regularMarketOpen || 0,
          previousClose: prevClose,
          marketCap: r.marketCap || 0,
          fiftyTwoWeekHigh: r.fiftyTwoWeekHigh || 0,
          fiftyTwoWeekLow: r.fiftyTwoWeekLow || 0,
          peRatio: r.trailingPE != null ? r.trailingPE : null,
          dividendYield: r.trailingAnnualDividendYield != null ? r.trailingAnnualDividendYield : null,
          beta: r.beta != null ? r.beta : null,
          eps: r.trailingEps != null ? r.trailingEps : null,
        };
      }
    } catch (err) {
      console.warn("batch quote failed:", batch.join(","), err.message);
    }
    await sleep(DELAY_MS);
  }
  return quotes;
}

// ── Sector/industry (v1 search) ──────────────────────────────────────────────
// v7 does not return sector/industry; the v1 search endpoint does (for stocks).
// Indices/ETFs return null — the app buckets those as "Other". Fetched only
// for core symbols to keep the call count low.
async function fetchSectorInfo(symbol) {
  const data = await fetchWithRetry(
    "/v1/finance/search?q=" + encodeURIComponent(symbol)
  );
  if (!data || !Array.isArray(data.quotes)) return null;
  const match = data.quotes.find((q) => q.symbol === symbol);
  if (!match) return null;
  return {
    sector: match.sector || null,
    industry: match.industry || null,
  };
}

// ── Candles (v8 chart) ───────────────────────────────────────────────────────
async function fetchCandles(symbol, range, interval) {
  const data = await fetchWithRetry(
    "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=" + range + "&interval=" + interval
  );
  if (!data || !data.chart || !data.chart.result || !data.chart.result.length) return [];
  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const quotes = result.indicators && result.indicators.quote ? result.indicators.quote[0] : null;
  if (!quotes || !timestamps.length) return [];
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quotes.open[i] == null || quotes.close[i] == null) continue;
    candles.push({
      time: timestamps[i],
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume[i] || 0,
    });
  }
  return candles;
}

// ── News (v1 search) ────────────────────────────────────────────────────────
// The v1/finance/search endpoint returns a `news` array alongside quotes. The
// dedicated news endpoint is aggressively rate-limited, so we reuse search.
// Fetched per core symbol (watchlist + indices) plus one general market query.
async function fetchNewsForQuery(query) {
  const data = await fetchWithRetry(
    "/v1/finance/search?q=" + encodeURIComponent(query) + "&newsCount=6"
  );
  if (!data || !Array.isArray(data.news)) return [];
  return data.news
    .map((item) => {
      if (!item || !item.title || !item.link) return null;
      return {
        title: item.title,
        source: item.publisher || "",
        url: item.link,
        publishedAt: item.providerPublishTime
          ? new Date(item.providerPublishTime * 1000).toISOString()
          : null,
        summary: item.summary || "",
      };
    })
    .filter(Boolean);
}

// Dedupe by title, sort newest-first, cap the list.
function dedupeNews(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item || seen.has(item.title)) continue;
    seen.add(item.title);
    unique.push(item);
  }
  unique.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return unique.slice(0, 6);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const quotes = {};
  const candles = {};

  // v7 quote requires a crumb + cookie. Fetch once, reuse for all batches.
  let crumb = null;
  let cookie = "";
  try {
    const c = await getCrumb();
    crumb = c.crumb;
    cookie = c.cookie;
  } catch (err) {
    console.warn("crumb failed:", err.message);
  }

  // Quotes + detail for all symbols (batched)
  if (crumb) {
    const batchQuotes = await fetchBatchQuotes(ALL, crumb, cookie);
    Object.assign(quotes, batchQuotes);
  } else {
    console.error("No crumb — cannot fetch quotes. Aborting (keeping last good data).");
    process.exit(1);
  }

  // Sector for core symbols only (v1 search is per-symbol and rate-limited)
  for (const symbol of CORE) {
    if (!quotes[symbol]) continue;
    try {
      const sectorInfo = await fetchSectorInfo(symbol);
      if (sectorInfo) Object.assign(quotes[symbol], sectorInfo);
    } catch (err) {
      console.warn("sector failed:", symbol, err.message);
    }
    await sleep(DELAY_MS);
  }

  // Candles: 1-month daily for every symbol (sparkline + 1M chart + prediction);
  // 6-month and 1-year for core symbols only (full chart history).
  const RANGES_ALL = [{ key: "D60", range: "1mo", interval: "1d" }];
  const RANGES_CORE = [
    { key: "D180", range: "6mo", interval: "1d" },
    { key: "W365", range: "1y", interval: "1wk" },
  ];
  for (const symbol of Object.keys(quotes)) {
    candles[symbol] = {};
    for (const r of RANGES_ALL) {
      try {
        candles[symbol][r.key] = await fetchCandles(symbol, r.range, r.interval);
      } catch (err) {
        console.warn("candles failed:", symbol, r.key, err.message);
        candles[symbol][r.key] = [];
      }
      await sleep(DELAY_MS);
    }
    if (CORE.includes(symbol)) {
      for (const r of RANGES_CORE) {
        try {
          candles[symbol][r.key] = await fetchCandles(symbol, r.range, r.interval);
        } catch (err) {
          console.warn("candles failed:", symbol, r.key, err.message);
          candles[symbol][r.key] = [];
        }
        await sleep(DELAY_MS);
      }
    }
  }

  if (Object.keys(quotes).length === 0) {
    console.error("No quotes fetched — aborting (keeping last good data).");
    process.exit(1);
  }

  // News: per-symbol for core symbols (watchlist + indices) plus a general
  // market query. The app falls back to the "market" key for symbols without
  // per-symbol news.
  const news = {};
  const NEWS_QUERIES = [...CORE, "stock market"];
  for (const q of NEWS_QUERIES) {
    try {
      const items = dedupeNews(await fetchNewsForQuery(q));
      if (items.length) news[q === "stock market" ? "market" : q] = items;
    } catch (err) {
      console.warn("news failed:", q, err.message);
    }
    await sleep(DELAY_MS);
  }

  // Preserve last-good news for keys we could not refresh (keeps the panel
  // populated even when a symbol's news fetch fails).
  try {
    const prev = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    if (prev && prev.news && typeof prev.news === "object") {
      for (const key of Object.keys(prev.news)) {
        if (!news[key]) news[key] = prev.news[key];
      }
    }
  } catch (e) {}

  // Sparkline + historicalPrices from D60 closes (for watchlist + prediction)
  for (const symbol of Object.keys(quotes)) {
    const closes = ((candles[symbol] && candles[symbol].D60) || []).map((c) => c.close);
    quotes[symbol].historicalPrices = closes;
    quotes[symbol].sparkline = closes.slice(-30);
  }

  const symbols = ALL.map((s) => {
    const q = quotes[s];
    return {
      symbol: s,
      name: q ? q.name : s,
      exchange: q ? q.exchange : "",
    };
  });

  const out = {
    updatedAt: new Date().toISOString(),
    quotes,
    candles,
    news,
    symbols,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log("Wrote", OUT_FILE, "with", Object.keys(quotes).length, "quotes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
