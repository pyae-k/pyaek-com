/**
 * Data fetching module for Stocks PWA.
 * Primary data source: apps/stocks/data/market.json — a JSON snapshot of Yahoo
 * Finance data committed by the GitHub Actions pipeline (scripts/stocks-fetch.mjs).
 * The pipeline runs server-side (no CORS, no API key) and refreshes the file
 * during market hours.
 *
 * In-memory cache of the data file (loaded once, refreshed on clearCache()).
 */

var DATA_URL = 'data/market.json';

// In-memory cache of the pipeline data file.
var marketData = null;
var marketDataPromise = null;

/**
 * Load the pipeline data file (data/market.json) once and cache it in memory.
 * Subsequent calls return the cached copy. clearCache() resets it so the next
 * call re-fetches.
 * @returns {Promise<Object|null>} { updatedAt, quotes, candles, symbols }
 */
function loadMarketData() {
  if (marketData) return Promise.resolve(marketData);
  if (marketDataPromise) return marketDataPromise;

  marketDataPromise = fetch(DATA_URL)
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      marketData = data;
      marketDataPromise = null;
      return data;
    })
    .catch(function () {
      marketDataPromise = null;
      return null;
    });

  return marketDataPromise;
}

/**
 * Get the timestamp of the last pipeline data refresh.
 * @returns {Promise<string|null>} ISO timestamp or null if data not loaded
 */
export function getLastUpdated() {
  return loadMarketData().then(function (data) {
    return data ? data.updatedAt : null;
  });
}

/**
 * Fetch a quote for a single symbol from the pipeline data file.
 * @param {string} symbol - Ticker symbol
 * @returns {Promise<Object|null>} Quote object or null if not in the universe
 */
export function fetchQuote(symbol) {
  if (!symbol) return Promise.resolve(null);
  var sym = symbol.toUpperCase().trim();
  return loadMarketData().then(function (data) {
    if (!data || !data.quotes) return null;
    return data.quotes[sym] || null;
  });
}

/**
 * Fetch a quote enriched with market cap and valuation metrics.
 * Same as fetchQuote — the pipeline file already merges price + detail.
 * @param {string} symbol - Ticker symbol
 * @returns {Promise<Object|null>}
 */
export function fetchQuoteDetail(symbol) {
  return fetchQuote(symbol);
}

/**
 * Fetch quotes for one or more symbols from the pipeline data file.
 * Symbols outside the pipeline universe are omitted.
 * @param {string[]} symbols - Array of ticker symbols
 * @returns {Promise<Array>} Array of quote objects
 */
export function fetchQuotes(symbols) {
  if (!symbols || symbols.length === 0) return Promise.resolve([]);
  return loadMarketData().then(function (data) {
    if (!data || !data.quotes) return [];
    var results = [];
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i].toUpperCase().trim();
      if (data.quotes[sym]) results.push(data.quotes[sym]);
    }
    return results;
  });
}

/**
 * Fetch major market indices for the ticker tape.
 * Covers US equities, tech, small caps, volatility, bonds, commodities, EM.
 * @returns {Promise<Array>} Array of { symbol, name, price, change, changePercent }
 */
export function fetchMarketIndices() {
  var symbols = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX', 'TLT', 'GLD', 'EEM'];
  return fetchQuotes(symbols).then(function (quotes) {
    if (!Array.isArray(quotes)) return [];
    return quotes.map(function (q) {
      if (!q) return null;
      return {
        symbol: q.symbol,
        name: q.name || q.symbol,
        price: q.price || 0,
        change: q.change || 0,
        changePercent: q.changePercent || 0,
      };
    }).filter(Boolean);
  });
}

/**
 * Fetch intraday candle data for charting from the pipeline data file.
 * The pipeline stores three daily/weekly ranges: D60 (1mo/1d), D180 (6mo/1d),
 * W365 (1y/1wk). Minute-level intraday data is not stored.
 * @param {string} symbol - Ticker symbol
 * @param {string} [resolution='D'] - Resolution: 'D', 'W', 'M'
 * @param {number} [days=60] - Number of days of history
 * @returns {Promise<Array>} Array of { time, open, high, low, close, volume }
 */
export function fetchIntraday(symbol, resolution, days) {
  if (!symbol) return Promise.resolve([]);
  resolution = resolution || 'D';
  days = days || 60;

  // Map (resolution, days) to the pipeline candle key.
  var key;
  if (resolution === 'D' || resolution === 'W' || resolution === 'M') {
    if (days <= 60) key = 'D60';
    else if (days <= 180) key = 'D180';
    else key = 'W365';
  } else {
    // Minute-level resolutions are not stored by the pipeline.
    return Promise.resolve([]);
  }

  var sym = symbol.toUpperCase().trim();
  return loadMarketData().then(function (data) {
    if (!data || !data.candles || !data.candles[sym]) return [];
    return data.candles[sym][key] || [];
  });
}

/**
 * Fetch the full pipeline universe of symbols.
 * @returns {Promise<string[]>} Array of ticker symbols
 */
export function fetchAllSymbols() {
  return loadMarketData().then(function (data) {
    if (!data || !Array.isArray(data.symbols)) return [];
    return data.symbols.map(function (s) { return s.symbol; });
  });
}

/**
 * Search for symbols by query string against the pipeline universe.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of { symbol, name, exchange }
 */
export function searchSymbols(query) {
  if (!query || query.trim().length === 0) return Promise.resolve([]);
  var q = query.trim().toLowerCase();
  return loadMarketData().then(function (data) {
    if (!data || !Array.isArray(data.symbols)) return [];
    return data.symbols.filter(function (item) {
      return item.symbol.toLowerCase().indexOf(q) !== -1 ||
             (item.name && item.name.toLowerCase().indexOf(q) !== -1);
    });
  });
}

/**
 * Fetch sector data for a symbol from the pipeline data file.
 * @param {string} symbol
 * @returns {Promise<string|null>} Sector name or null
 */
export function fetchSector(symbol) {
  if (!symbol) return Promise.resolve(null);
  var sym = symbol.toUpperCase().trim();
  return loadMarketData().then(function (data) {
    if (!data || !data.quotes || !data.quotes[sym]) return null;
    var q = data.quotes[sym];
    return q.sector || q.industry || null;
  });
}

/**
 * Fetch sectors for multiple symbols.
 * @param {string[]} symbols
 * @returns {Promise<Object>} Map of symbol -> sector
 */
export function fetchSectors(symbols) {
  if (!symbols || symbols.length === 0) return Promise.resolve({});
  return loadMarketData().then(function (data) {
    var map = {};
    if (!data || !data.quotes) return map;
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i].toUpperCase().trim();
      var q = data.quotes[sym];
      if (q && (q.sector || q.industry)) map[sym] = q.sector || q.industry;
    }
    return map;
  });
}

/**
 * Fetch news for a symbol, falling back to market-wide news.
 * The pipeline stores per-symbol news for core symbols plus a "market" key
 * for general headlines. Symbols without per-symbol news get the market list.
 * @param {string} symbol - Ticker symbol
 * @returns {Promise<Array>} Array of { title, source, url, publishedAt, summary }
 */
export function fetchNews(symbol) {
  return loadMarketData().then(function (data) {
    if (!data || !data.news) return [];
    var sym = symbol ? symbol.toUpperCase().trim() : null;
    var items = (sym && data.news[sym]) ? data.news[sym] : (data.news.market || []);
    if (!Array.isArray(items)) return [];
    return items.slice().sort(function (a, b) {
      return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
    });
  });
}

/**
 * Clear the in-memory cache. The next data call re-fetches data/market.json.
 */
export function clearCache() {
  marketData = null;
  marketDataPromise = null;
}

// ── Market status (local estimate) ───────────────────────────────────────────

/**
 * Fetch market status (open/closed).
 * Estimates based on US market hours (9:30 AM - 4:00 PM ET, Mon-Fri).
 * @returns {Promise<Object|null>} { isOpen, nextOpen, nextClose }
 */
export function fetchMarketStatus() {
  return Promise.resolve().then(function () {
    var now = new Date();
    var day = now.getUTCDay();
    var hourET = now.getUTCHours() - 4; // EDT is UTC-4
    var minET = now.getUTCMinutes();
    var timeET = hourET * 60 + minET;

    // Weekends: closed
    if (day === 0 || day === 6) {
      return {
        isOpen: false,
        nextOpen: getNextMarketOpen(now),
        nextClose: null,
      };
    }

    // Market hours: 9:30 AM - 4:00 PM ET
    var isOpen = timeET >= 570 && timeET < 960; // 9:30 = 570, 16:00 = 960
    return {
      isOpen: isOpen,
      nextOpen: isOpen ? null : getNextMarketOpen(now),
      nextClose: isOpen ? getTodayAt(now, 16, 0) : null,
    };
  });
}

/**
 * Get the next market open time.
 */
function getNextMarketOpen(now) {
  var d = new Date(now);
  var day = d.getUTCDay();
  var hourET = d.getUTCHours() - 4;
  var minET = d.getUTCMinutes();
  var timeET = hourET * 60 + minET;

  // If after market close today, next open is tomorrow
  if (timeET >= 960) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Skip to next weekday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Set to 9:30 AM ET
  d.setUTCHours(13, 30, 0, 0); // 9:30 AM ET = 13:30 UTC
  return d.toISOString();
}

/**
 * Get a date at a specific ET time.
 */
function getTodayAt(now, hourET, minET) {
  var d = new Date(now);
  d.setUTCHours(hourET + 4, minET, 0, 0); // Convert ET to UTC
  return d.toISOString();
}

