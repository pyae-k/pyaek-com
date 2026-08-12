/**
 * Stock comparison modal — side-by-side comparison of two stocks.
 * Uses native <dialog> element with fallback.
 * Features: rebased-to-100 chart overlay, performance metrics (1M/6M/YTD),
 * volatility, correlation, valuation metrics (P/E, dividend yield, 52w range),
 * and an index comparison option.
 */

import { fetchQuote, fetchIntraday } from "./api.js";
import { createComparisonChart, destroyComparisonChart } from "./charts.js";

var currentCompareChart = null;

/**
 * Open the stock comparison modal.
 * @param {string} symbol1 - First ticker symbol
 * @param {string} [symbol2] - Optional second ticker symbol (user can select)
 */
export function openCompareModal(symbol1, symbol2) {
  var dialog = document.getElementById("compareDialog");
  if (!dialog) {
    dialog = createCompareDialog();
    document.body.appendChild(dialog);
  }

  var indexOptions = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', 'SPY', 'QQQ', 'DIA', 'IWM', 'TLT', 'GLD', 'EEM'];

  dialog.innerHTML =
    '<div class="compare-modal-content">' +
      '<div class="compare-modal-header">' +
        '<h2 class="compare-modal-title">Compare Stocks</h2>' +
        '<button class="compare-modal-close" id="compareCloseBtn" aria-label="Close comparison" title="Close">&times;</button>' +
      '</div>' +
      '<div class="compare-picker">' +
        '<label class="compare-picker-label" for="compareSymbol2">Compare with</label>' +
        '<input type="text" id="compareSymbol2" class="compare-symbol-input" placeholder="Enter symbol or index" value="' + escapeHtml(symbol2 || "") + '" autocomplete="off">' +
        '<button class="add-symbol-btn" id="compareApplyBtn">Compare</button>' +
      '</div>' +
      '<div class="compare-quick-picks" id="compareQuickPicks">' +
        indexOptions.map(function (sym) {
          return '<button class="compare-quick-pick" data-symbol="' + escapeHtml(sym) + '">' + escapeHtml(sym.replace("^", "")) + '</button>';
        }).join("") +
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

  // Load data for both symbols
  var symbols = [symbol1];
  if (symbol2) symbols.push(symbol2);

  loadComparison(dialog, symbol1, symbols);

  attachCloseHandler(dialog);
  attachPickerHandlers(dialog, symbol1);
}

/**
 * Create the comparison dialog element.
 */
function createCompareDialog() {
  var dialog = document.createElement("dialog");
  dialog.id = "compareDialog";
  dialog.className = "compare-modal";
  return dialog;
}

/**
 * Attach close handler to the dialog.
 */
function attachCloseHandler(dialog) {
  var closeBtn = dialog.querySelector("#compareCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      dialog.close();
      cleanupCompareChart();
    });
  }
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) {
      dialog.close();
      cleanupCompareChart();
    }
  });
  dialog.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      dialog.close();
      cleanupCompareChart();
    }
  });
  dialog.addEventListener("close", cleanupCompareChart);
}

/**
 * Attach handlers for the symbol picker and quick picks.
 */
function attachPickerHandlers(dialog, symbol1) {
  var input = dialog.querySelector("#compareSymbol2");
  var applyBtn = dialog.querySelector("#compareApplyBtn");
  var quickPicks = dialog.querySelector("#compareQuickPicks");

  function runCompare() {
    var val = (input.value || "").toUpperCase().trim();
    if (!val || val === symbol1) return;
    cleanupCompareChart();
    loadComparison(dialog, symbol1, [symbol1, val]);
  }

  if (applyBtn) applyBtn.addEventListener("click", runCompare);
  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") runCompare();
    });
  }
  if (quickPicks) {
    quickPicks.querySelectorAll(".compare-quick-pick").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sym = btn.dataset.symbol;
        if (input) input.value = sym;
        if (sym === symbol1) return;
        cleanupCompareChart();
        loadComparison(dialog, symbol1, [symbol1, sym]);
      });
    });
  }
}

/**
 * Load quotes and chart data for the comparison.
 */
function loadComparison(dialog, symbol1, symbols) {
  var content = dialog.querySelector(".compare-modal-content");
  if (!content) return;

  // Show loading. On a re-run (second symbol picked) the first render already
  // replaced the loading element with the comparison table, so remove the old
  // comparison output and re-create the loading element in its place.
  var loading = content.querySelector(".compare-loading");
  if (!loading) {
    [".compare-table", ".compare-chart", ".compare-perf"].forEach(function (sel) {
      var el = content.querySelector(sel);
      if (el) el.remove();
    });
    content.insertAdjacentHTML("beforeend",
      '<div class="compare-loading">' +
        '<div class="stocks-skeleton">' +
          '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:40px;"></div>' +
        '</div>' +
      '</div>');
    loading = content.querySelector(".compare-loading");
  }
  loading.style.display = "block";

  Promise.all([
    Promise.all(symbols.map(function (s) { return fetchQuote(s); })),
    Promise.all(symbols.map(function (s) { return fetchIntraday(s, 'D', 365); })),
  ]).then(function (results) {
    var quotes = results[0];
    var candlesList = results[1];

    var data1 = quotes[0];
    var data2 = quotes[1] || null;
    var candles1 = candlesList[0] || [];
    var candles2 = candlesList[1] || [];

    if (!data1) {
      renderError(dialog, 'Could not load data for ' + escapeHtml(symbol1));
      return;
    }

    // Compute performance metrics
    var metrics1 = computeMetrics(data1, candles1);
    var metrics2 = data2 ? computeMetrics(data2, candles2) : null;
    var correlation = (data2 && candles1.length > 5 && candles2.length > 5)
      ? computeCorrelation(candles1, candles2)
      : null;

    renderComparison(dialog, data1, data2, symbol1, symbols[1] || null, metrics1, metrics2, correlation);

    // Render chart overlay
    var chartContainer = dialog.querySelector("#compareChartContainer");
    if (chartContainer) {
      chartContainer.innerHTML = '';
      var seriesData = [];
      if (candles1.length > 1) {
        seriesData.push({
          symbol: symbol1,
          data: candles1.map(function (c) { return { time: c.time, value: c.close }; }),
        });
      }
      if (data2 && candles2.length > 1) {
        seriesData.push({
          symbol: symbols[1],
          data: candles2.map(function (c) { return { time: c.time, value: c.close }; }),
        });
      }
      renderCompareChart(chartContainer, seriesData);
    }
  }).catch(function (err) {
    renderError(dialog, err.message || 'Comparison failed');
  });
}

/**
 * Compute performance and volatility metrics from quote + candles.
 */
function computeMetrics(quote, candles) {
  var closes = (candles || []).map(function (c) { return c.close; }).filter(function (v) { return v > 0; });
  var price = quote.price || (closes.length ? closes[closes.length - 1] : 0);

  function pctReturn(idxFromEnd) {
    if (closes.length < idxFromEnd + 2) return null;
    var start = closes[closes.length - 1 - idxFromEnd];
    if (!start || start <= 0) return null;
    return ((price - start) / start) * 100;
  }

  // Volatility: annualized std dev of daily returns (14d)
  var volatility = null;
  if (closes.length >= 15) {
    var returns = [];
    for (var i = closes.length - 14; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    if (returns.length >= 2) {
      var mean = returns.reduce(function (a, b) { return a + b; }, 0) / returns.length;
      var variance = returns.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (returns.length - 1);
      volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
  }

  return {
    price: price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    marketCap: quote.marketCap,
    peRatio: quote.peRatio,
    dividendYield: quote.dividendYield,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    ret1m: pctReturn(21),
    ret6m: pctReturn(126),
    volatility: volatility,
  };
}

/**
 * Compute Pearson correlation of daily returns between two candle series.
 */
function computeCorrelation(candles1, candles2) {
  var map2 = {};
  candles2.forEach(function (c) { map2[c.time] = c.close; });

  var r1 = [];
  var r2 = [];
  for (var i = 1; i < candles1.length; i++) {
    var close2 = map2[candles1[i].time];
    if (close2 == null) continue;
    var prev2 = map2[candles1[i - 1].time];
    if (prev2 == null || candles1[i - 1].close <= 0 || prev2 <= 0) continue;
    r1.push((candles1[i].close - candles1[i - 1].close) / candles1[i - 1].close);
    r2.push((close2 - prev2) / prev2);
  }
  if (r1.length < 5) return null;

  var n = r1.length;
  var mean1 = r1.reduce(function (a, b) { return a + b; }, 0) / n;
  var mean2 = r2.reduce(function (a, b) { return a + b; }, 0) / n;
  var num = 0, den1 = 0, den2 = 0;
  for (var i = 0; i < n; i++) {
    num += (r1[i] - mean1) * (r2[i] - mean2);
    den1 += (r1[i] - mean1) * (r1[i] - mean1);
    den2 += (r2[i] - mean2) * (r2[i] - mean2);
  }
  if (den1 === 0 || den2 === 0) return null;
  return num / Math.sqrt(den1 * den2);
}

/**
 * Render the comparison chart overlay.
 */
function renderCompareChart(container, seriesData) {
  cleanupCompareChart();
  if (seriesData.length < 2) {
    container.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);font-size:var(--text-sm);padding:var(--space-md)">Chart comparison unavailable</p>';
    return;
  }
  createComparisonChart(container, seriesData, { height: 240, rebased: true }).then(function (chartObj) {
    if (!chartObj) {
      container.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);font-size:var(--text-sm);padding:var(--space-md)">Chart comparison unavailable</p>';
      return;
    }
    currentCompareChart = chartObj;
    if (chartObj.legendEl) {
      container.appendChild(chartObj.legendEl);
    }
  });
}

/**
 * Clean up the comparison chart.
 */
function cleanupCompareChart() {
  if (currentCompareChart) {
    destroyComparisonChart(currentCompareChart);
    currentCompareChart = null;
  }
}

/**
 * Render the comparison content.
 */
function renderComparison(dialog, data1, data2, symbol1, symbol2, metrics1, metrics2, correlation) {
  var content = dialog.querySelector(".compare-modal-content");
  if (!content) return;

  var rows = buildMetricRows(data1, data2, metrics1, metrics2);

  // Correlation row
  if (correlation != null) {
    var corrClass = correlation >= 0.5 ? 'compare-high-corr' : (correlation <= -0.5 ? 'compare-low-corr' : '');
    rows += '<div class="compare-row compare-correlation">' +
      '<span class="compare-label">Correlation</span>' +
      '<span class="compare-value ' + corrClass + '" colspan="2">' + correlation.toFixed(2) + '</span>' +
    '</div>';
  }

  var perfHtml = buildPerformanceHtml(data2, metrics1, metrics2);

  content.querySelector(".compare-loading").style.display = "none";
  content.querySelector(".compare-loading").outerHTML =
    '<div class="compare-table">' +
      '<div class="compare-header-row">' +
        '<span class="compare-label"></span>' +
        '<span class="compare-value compare-symbol-header">' + escapeHtml(symbol1) + '</span>' +
        '<span class="compare-value compare-symbol-header">' + (symbol2 ? escapeHtml(symbol2) : "—") + '</span>' +
      '</div>' +
      rows +
    '</div>' +
    '<div class="compare-chart" id="compareChartContainer">' +
      '<p style="text-align:center;color:var(--color-text-secondary);font-size:var(--text-sm);padding:var(--space-md)">Loading chart…</p>' +
    '</div>' +
    '<div class="compare-perf">' +
      '<h3 class="compare-perf-title">Performance vs Index</h3>' +
      perfHtml +
    '</div>';

  attachCloseHandler(dialog);
}

/**
 * Build the metrics table rows.
 */
function buildMetricRows(data1, data2, metrics1, metrics2) {
  var rows = [];

  rows.push(metricRow("Price", formatPrice(metrics1.price), metrics2 ? formatPrice(metrics2.price) : "—", metrics1.price, metrics2 && metrics2.price));
  rows.push(metricRow("Change %", formatPct(metrics1.changePercent), metrics2 ? formatPct(metrics2.changePercent) : "—", metrics1.changePercent, metrics2 && metrics2.changePercent));
  rows.push(metricRow("Volume", abbreviateVolume(metrics1.volume), metrics2 ? abbreviateVolume(metrics2.volume) : "—", metrics1.volume, metrics2 && metrics2.volume));
  rows.push(metricRow("Market Cap", abbreviateMarketCap(metrics1.marketCap), metrics2 ? abbreviateMarketCap(metrics2.marketCap) : "—", metrics1.marketCap, metrics2 && metrics2.marketCap));
  rows.push(metricRow("P/E Ratio", formatNum(metrics1.peRatio), metrics2 ? formatNum(metrics2.peRatio) : "—", null, null));
  rows.push(metricRow("Dividend Yield", formatPct((metrics1.dividendYield || 0) * 100), metrics2 ? formatPct((metrics2.dividendYield || 0) * 100) : "—", null, null));
  rows.push(metricRow("52W High", formatPrice(metrics1.fiftyTwoWeekHigh), metrics2 ? formatPrice(metrics2.fiftyTwoWeekHigh) : "—", metrics1.fiftyTwoWeekHigh, metrics2 && metrics2.fiftyTwoWeekHigh));
  rows.push(metricRow("52W Low", formatPrice(metrics1.fiftyTwoWeekLow), metrics2 ? formatPrice(metrics2.fiftyTwoWeekLow) : "—", null, null));
  rows.push(metricRow("1M Return", formatPct(metrics1.ret1m), metrics2 ? formatPct(metrics2.ret1m) : "—", metrics1.ret1m, metrics2 && metrics2.ret1m));
  rows.push(metricRow("6M Return", formatPct(metrics1.ret6m), metrics2 ? formatPct(metrics2.ret6m) : "—", metrics1.ret6m, metrics2 && metrics2.ret6m));
  rows.push(metricRow("Volatility (ann.)", formatPct(metrics1.volatility), metrics2 ? formatPct(metrics2.volatility) : "—", metrics1.volatility, metrics2 && metrics2.volatility));

  return rows.join("");
}

/**
 * Create a single metric row, highlighting the "better" value.
 */
function metricRow(label, v1, v2, num1, num2) {
  var betterClass1 = "";
  var betterClass2 = "";
  if (num1 != null && num2 != null && num1 !== num2) {
    var higherBetter = label === "Price" || label === "Volume" || label === "Market Cap" || label === "52W High" ||
      label === "1M Return" || label === "6M Return";
    if (label === "Change %" || label === "Volatility (ann.)") {
      // For change %, higher is better; for volatility, lower is better
      var wantHigher = label === "Change %";
      betterClass1 = (wantHigher ? num1 >= num2 : num1 <= num2) ? "compare-better" : "";
      betterClass2 = (wantHigher ? num2 >= num1 : num2 <= num1) ? "compare-better" : "";
    } else if (higherBetter) {
      betterClass1 = num1 >= num2 ? "compare-better" : "";
      betterClass2 = num2 >= num1 ? "compare-better" : "";
    } else if (label === "P/E Ratio" || label === "52W Low") {
      betterClass1 = num1 <= num2 ? "compare-better" : "";
      betterClass2 = num2 <= num1 ? "compare-better" : "";
    }
  }

  return '<div class="compare-row">' +
    '<span class="compare-label">' + label + '</span>' +
    '<span class="compare-value ' + betterClass1 + '">' + v1 + '</span>' +
    '<span class="compare-value ' + betterClass2 + '">' + v2 + '</span>' +
  '</div>';
}

/**
 * Build the performance comparison HTML (1M / 6M returns for both stocks).
 */
function buildPerformanceHtml(data2, metrics1, metrics2) {
  var lines = [];

  function statRow(label, a, b) {
    return '<div class="compare-row">' +
      '<span class="compare-label">' + label + '</span>' +
      '<span class="compare-value">' + formatPct(a) + '</span>' +
      '<span class="compare-value">' + (b != null ? formatPct(b) : "—") + '</span>' +
    '</div>';
  }

  if (metrics1.ret1m != null || (metrics2 && metrics2.ret1m != null)) {
    lines.push(statRow("1M Return", metrics1.ret1m, metrics2 && metrics2.ret1m));
  }
  if (metrics1.ret6m != null || (metrics2 && metrics2.ret6m != null)) {
    lines.push(statRow("6M Return", metrics1.ret6m, metrics2 && metrics2.ret6m));
  }

  return lines.length
    ? lines.join('')
    : '<p style="font-size:var(--text-xs);color:var(--color-text-secondary)">Insufficient history for performance comparison.</p>';
}

/**
 * Render error state.
 */
function renderError(dialog, message) {
  var content = dialog.querySelector(".compare-modal-content");
  if (!content) return;
  var loading = content.querySelector(".compare-loading");
  if (!loading) return; // already replaced by a rendered comparison
  loading.style.display = "none";
  loading.outerHTML =
    '<div class="stocks-error">' +
      '<p class="stocks-error-msg">' + message + '</p>' +
    '</div>';
}

/**
 * Format a price number.
 */
function formatPrice(price) {
  if (price == null || isNaN(price) || price === 0) return "—";
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
 * Format a generic number.
 */
function formatNum(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(2);
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
