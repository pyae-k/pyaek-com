/**
 * Multi-stock comparison modal — compare 3-5 stocks side by side.
 * Uses native <dialog> element. Shows a heatmap-style metrics table
 * and a rebased-to-100 chart overlay of all selected symbols.
 */

import { fetchQuote, fetchIntraday } from "./api.js";
import { createComparisonChart, destroyComparisonChart } from "./charts.js";
import { calculateRSI } from "./indicators.js";

var currentMultiChart = null;

/**
 * Open the multi-stock comparison modal.
 * @param {string[]} symbols - Array of 2-5 ticker symbols
 */
export function openMultiCompareModal(symbols) {
  var list = (Array.isArray(symbols) ? symbols : []).slice(0, 5).filter(Boolean);
  if (list.length < 2) return;

  var dialog = document.getElementById("multiCompareDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "multiCompareDialog";
    dialog.className = "compare-modal compare-modal--wide";
    document.body.appendChild(dialog);
  }

  dialog.innerHTML =
    '<div class="compare-modal-content">' +
      '<div class="compare-modal-header">' +
        '<h2 class="compare-modal-title">Compare Selected</h2>' +
        '<button class="compare-modal-close" id="multiCompareCloseBtn" aria-label="Close comparison" title="Close">&times;</button>' +
      '</div>' +
      '<div class="compare-loading">' +
        '<div class="stocks-skeleton">' +
          '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:40px;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  dialog.showModal();

  loadMultiComparison(dialog, list);

  var closeBtn = dialog.querySelector("#multiCompareCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", function (e) {
    if (e.key === "Escape") dialog.close();
  });
  dialog.addEventListener("close", function () {
    if (currentMultiChart) {
      destroyComparisonChart(currentMultiChart);
      currentMultiChart = null;
    }
  });
}

/**
 * Load quotes and candle data for all selected symbols.
 */
function loadMultiComparison(dialog, symbols) {
  var content = dialog.querySelector(".compare-modal-content");
  if (!content) return;

  Promise.all([
    Promise.all(symbols.map(function (s) { return fetchQuote(s); })),
    Promise.all(symbols.map(function (s) { return fetchIntraday(s, 'D', 365); })),
  ]).then(function (results) {
    var quotes = results[0];
    var candlesList = results[1];

    var rows = symbols.map(function (sym, i) {
      var quote = quotes[i];
      var candles = candlesList[i] || [];
      return {
        symbol: sym,
        quote: quote,
        candles: candles,
        metrics: computeMultiMetrics(quote, candles),
      };
    }).filter(function (r) { return r.quote || r.candles.length > 0; });

    if (rows.length === 0) {
      content.querySelector(".compare-loading").style.display = "none";
      content.querySelector(".compare-loading").outerHTML =
        '<div class="stocks-error"><p class="stocks-error-msg">Could not load data for comparison.</p></div>';
      return;
    }

    renderMultiComparison(content, rows);

    // Chart overlay
    var chartContainer = content.querySelector("#multiCompareChartContainer");
    if (chartContainer) {
      var seriesData = rows.filter(function (r) { return r.candles.length > 1; }).map(function (r) {
        return {
          symbol: r.symbol,
          data: r.candles.map(function (c) { return { time: c.time, value: c.close }; }),
        };
      });
      if (seriesData.length >= 2) {
        createComparisonChart(chartContainer, seriesData, { height: 260, rebased: true }).then(function (chartObj) {
          if (!chartObj) return;
          currentMultiChart = chartObj;
          if (chartObj.legendEl) chartContainer.appendChild(chartObj.legendEl);
        });
      }
    }

    content.querySelector(".compare-loading").style.display = "none";
  }).catch(function () {
    var contentEl = dialog.querySelector(".compare-modal-content");
    if (!contentEl) return;
    contentEl.querySelector(".compare-loading").style.display = "none";
    contentEl.querySelector(".compare-loading").outerHTML =
      '<div class="stocks-error"><p class="stocks-error-msg">Could not load comparison data.</p></div>';
  });
}

/**
 * Compute metrics for one symbol.
 */
function computeMultiMetrics(quote, candles) {
  var closes = (candles || []).map(function (c) { return c.close; }).filter(function (v) { return v > 0; });
  var price = quote && quote.price > 0 ? quote.price : (closes.length ? closes[closes.length - 1] : 0);

  function pctReturn(idxFromEnd) {
    if (closes.length < idxFromEnd + 2) return null;
    var start = closes[closes.length - 1 - idxFromEnd];
    if (!start || start <= 0) return null;
    return ((price - start) / start) * 100;
  }

  // YTD return: find the last close before Jan 1 of this year
  var ytdReturn = null;
  if (closes.length > 1 && candles.length > 1) {
    var yearStart = new Date();
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);
    var startTs = Math.floor(yearStart.getTime() / 1000);
    var baseIdx = -1;
    for (var i = 0; i < candles.length; i++) {
      if (candles[i].time < startTs) baseIdx = i;
      else break;
    }
    if (baseIdx >= 0 && closes[baseIdx] > 0) {
      ytdReturn = ((price - closes[baseIdx]) / closes[baseIdx]) * 100;
    }
  }

  var rsi = null;
  if (closes.length >= 15) {
    var rsiArr = calculateRSI(closes, 14);
    rsi = rsiArr[rsiArr.length - 1];
    if (isNaN(rsi)) rsi = null;
  }

  var changePercent = quote && quote.changePercent != null ? quote.changePercent : null;
  var trend = getTrend(closes);

  return {
    price: price,
    changePercent: changePercent,
    volume: quote && quote.volume ? quote.volume : 0,
    marketCap: quote && quote.marketCap ? quote.marketCap : 0,
    peRatio: quote && quote.peRatio != null ? quote.peRatio : null,
    ret1m: pctReturn(21),
    ret6m: pctReturn(126),
    ytdReturn: ytdReturn,
    rsi: rsi,
    trend: trend,
  };
}

/**
 * Determine trend direction from recent closes.
 */
function getTrend(closes) {
  if (closes.length < 5) return "flat";
  var recent = closes.slice(-5);
  var pct = (recent[recent.length - 1] - recent[0]) / recent[0] * 100;
  if (pct > 1) return "up";
  if (pct < -1) return "down";
  return "flat";
}

/**
 * Render the multi-stock comparison table (heatmap style).
 */
function renderMultiComparison(content, rows) {
  var labels = [
    { key: "price", label: "Price" },
    { key: "changePercent", label: "Day Chg %" },
    { key: "ret1m", label: "1M %" },
    { key: "ret6m", label: "6M %" },
    { key: "ytdReturn", label: "YTD %" },
    { key: "rsi", label: "RSI 14" },
    { key: "trend", label: "Trend" },
    { key: "peRatio", label: "P/E" },
    { key: "volume", label: "Volume" },
    { key: "marketCap", label: "Mkt Cap" },
  ];

  var header = '<div class="compare-row compare-header-row">' +
    '<span class="compare-label">Metric</span>' +
    rows.map(function (r) { return '<span class="compare-value compare-symbol-header">' + escapeHtml(r.symbol) + '</span>'; }).join('') +
  '</div>';

  var body = labels.map(function (col) {
    var cells = rows.map(function (r) {
      var v = r.metrics[col.key];
      var cls = "";
      if (col.key === "trend") {
        cls = v === "up" ? "compare-better" : (v === "down" ? "compare-down" : "");
        return '<span class="compare-value ' + cls + '">' + (v === "up" ? "▲" : v === "down" ? "▼" : "—") + '</span>';
      }
      var text = formatMetric(col.key, v);
      if (typeof v === "number" && !isNaN(v)) {
        if (col.key === "changePercent" || col.key === "ret1m" || col.key === "ret6m" || col.key === "ytdReturn") {
          cls = v > 0 ? "compare-better" : (v < 0 ? "compare-down" : "");
        } else if (col.key === "rsi") {
          cls = v >= 70 ? "compare-down" : (v <= 30 ? "compare-better" : "");
        }
      }
      return '<span class="compare-value ' + cls + '">' + text + '</span>';
    }).join('');
    return '<div class="compare-row">' +
      '<span class="compare-label">' + col.label + '</span>' +
      cells +
    '</div>';
  }).join('');

  content.querySelector(".compare-loading").outerHTML =
    '<div class="multi-compare">' +
      header + body +
      '<div class="compare-chart" id="multiCompareChartContainer">' +
        '<p style="text-align:center;color:var(--color-text-secondary);font-size:var(--text-sm);padding:var(--space-md)">Loading chart…</p>' +
      '</div>' +
      '<p class="multi-compare-hint">Performance rebased to 100. RSI &gt; 70 overbought, &lt; 30 oversold.</p>' +
    '</div>';
}

/**
 * Format a metric value based on its type.
 */
function formatMetric(key, v) {
  if (v == null || (typeof v === "number" && isNaN(v))) return "—";
  switch (key) {
    case "price": return formatPrice(v);
    case "changePercent":
    case "ret1m":
    case "ret6m":
    case "ytdReturn":
      return formatPct(v);
    case "rsi": return v.toFixed(1);
    case "peRatio": return v.toFixed(1);
    case "volume": return abbreviateVolume(v);
    case "marketCap": return abbreviateMarketCap(v);
    default: return String(v);
  }
}

/**
 * Format a price.
 */
function formatPrice(price) {
  if (price == null || price <= 0) return "—";
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a percentage.
 */
function formatPct(v) {
  if (v == null || isNaN(v)) return "—";
  var sign = v > 0 ? "+" : "";
  return sign + v.toFixed(2) + "%";
}

/**
 * Abbreviate volume.
 */
function abbreviateVolume(vol) {
  if (vol == null) return "—";
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + "B";
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + "M";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return String(vol);
}

/**
 * Abbreviate market cap.
 */
function abbreviateMarketCap(cap) {
  if (cap == null || cap <= 0) return "—";
  if (cap >= 1_000_000_000_000) return (cap / 1_000_000_000_000).toFixed(2) + "T";
  if (cap >= 1_000_000_000) return (cap / 1_000_000_000).toFixed(2) + "B";
  if (cap >= 1_000_000) return (cap / 1_000_000).toFixed(2) + "M";
  return cap.toLocaleString();
}

/**
 * Simple HTML escaping.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, function (ch) { return map[ch]; });
}
