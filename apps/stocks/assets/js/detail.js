/**
 * Stock detail module — renders stock detail in the center zone.
 * Integrates with dashboard state (no separate route).
 * Uses TradingView Lightweight Charts for interactive candlestick charts
 * with prediction cone overlay and technical indicators.
 */

import { fetchQuote, fetchIntraday } from "./api.js";
import { runModel } from "./models.js";
import { renderPredictionCone } from "./prediction.js";
import { createStockChart, setCandlestickData, setVolumeData, addLineSeries, addPredictionCone, updateChartTheme, destroyChart, removeChartSeries } from "./charts.js";
import { calculateSMA, calculateEMA, calculateRSI, calculateBollingerBands, calculateMACD } from "./indicators.js";

var currentChart = null;
var currentCandleData = [];
var currentHistPrices = [];
var currentResolution = 'W'; // 'D' (daily) or 'W' (weekly) — drives forecast horizon
var currentSymbol = '';
var activeModel = 'linear';  // active prediction model key

// Indicator state
var activeIndicators = {};   // name -> series reference (or array for multi-series)
var indicatorSeries = [];    // all indicator line series for cleanup

// Prediction overlay state
var predictionSeries = [];   // series created by addPredictionCone, for cleanup

/**
 * Render stock detail into the center zone.
 * @param {HTMLElement} container
 * @param {string} symbol
 */
export async function renderStockDetail(container, symbol) {
  var sym = (symbol || "").toUpperCase().trim();
  if (!sym) return;
  currentSymbol = sym;

  try {
    var results = await Promise.all([
      fetchQuote(sym),
      fetchIntraday(sym, 'W', 365),
    ]);
    var quote = results[0];
    var candles = results[1];

    currentCandleData = Array.isArray(candles) ? candles : [];
    currentHistPrices = currentCandleData.map(function (c) { return c.close; });

    renderContent(container, sym, quote);
  } catch (err) {
    renderError(container, sym, err);
  }
}

/**
 * Render the full detail content.
 */
function renderContent(container, symbol, quote) {
  var price = quote && quote.price != null ? formatPrice(quote.price) : "--";
  var changePct = quote && quote.changePercent != null ? quote.changePercent : 0;
  var isUp = changePct >= 0;
  var changeClass = isUp ? "up" : "down";
  var changeSign = isUp ? "+" : "";
  var companyName = quote ? (quote.name || quote.companyName || symbol) : symbol;

  container.innerHTML =
    '<div class="stock-detail-zone">' +
      '<div class="stock-detail-header">' +
        '<div class="stock-detail-left">' +
          '<h2 class="stock-detail-symbol">' + escapeHtml(symbol) + '</h2>' +
          '<span class="stock-detail-company">' + escapeHtml(companyName) + '</span>' +
        '</div>' +
        '<div class="stock-detail-right">' +
          '<span class="stock-detail-price">' + price + '</span>' +
          '<span class="stock-detail-change ' + changeClass + '">' + changeSign + changePct.toFixed(2) + '%</span>' +
        '</div>' +
      '</div>' +

      '<div class="metric-row">' +
        '<div class="metric-card">' +
          '<span class="metric-label">Open</span>' +
          '<span class="metric-value small">' + (quote && quote.open != null ? formatPrice(quote.open) : "--") + '</span>' +
        '</div>' +
        '<div class="metric-card">' +
          '<span class="metric-label">High</span>' +
          '<span class="metric-value small">' + (quote && quote.high != null ? formatPrice(quote.high) : "--") + '</span>' +
        '</div>' +
        '<div class="metric-card">' +
          '<span class="metric-label">Low</span>' +
          '<span class="metric-value small">' + (quote && quote.low != null ? formatPrice(quote.low) : "--") + '</span>' +
        '</div>' +
        '<div class="metric-card">' +
          '<span class="metric-label">Volume</span>' +
          '<span class="metric-value small">' + (quote && quote.volume != null ? abbreviateVolume(quote.volume) : "--") + '</span>' +
        '</div>' +
        '<div class="metric-card">' +
          '<span class="metric-label">Mkt Cap</span>' +
          '<span class="metric-value small">' + (quote && quote.marketCap != null ? abbreviateMarketCap(quote.marketCap) : "--") + '</span>' +
        '</div>' +
        '<div class="metric-card">' +
          '<span class="metric-label">Prev Close</span>' +
          '<span class="metric-value small">' + (quote && quote.previousClose != null ? formatPrice(quote.previousClose) : "--") + '</span>' +
        '</div>' +
      '</div>' +

      // Chart section
      '<div class="chart-section">' +
        '<div class="chart-header">' +
          '<h3 class="chart-title">Price Chart</h3>' +
          '<div class="chart-controls">' +
            '<div class="chart-toggles" id="chartTimeToggles">' +
              '<button class="chart-toggle-btn" data-period="D" data-days="60">1M</button>' +
              '<button class="chart-toggle-btn" data-period="D" data-days="180">6M</button>' +
              '<button class="chart-toggle-btn active" data-period="W" data-days="365">1Y</button>' +
            '</div>' +
            '<button class="chart-expand-btn" id="expandChartBtn" aria-label="Expand chart" title="Expand to fullscreen">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="9 21 3 21 3 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="3" x2="14" y2="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="21" x2="10" y2="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="tv-chart-container" id="chartContainer"></div>' +
        '<div class="indicator-toggles" id="indicatorToggles" role="group" aria-label="Technical indicators">' +
          '<span class="indicator-toggle-label">Indicators</span>' +
          '<button class="indicator-toggle-btn" data-indicator="sma20" aria-pressed="false">SMA 20</button>' +
          '<button class="indicator-toggle-btn" data-indicator="sma50" aria-pressed="false">SMA 50</button>' +
          '<button class="indicator-toggle-btn" data-indicator="ema200" aria-pressed="false">EMA 200</button>' +
          '<button class="indicator-toggle-btn" data-indicator="bb" aria-pressed="false">Bollinger</button>' +
          '<button class="indicator-toggle-btn" data-indicator="rsi" aria-pressed="false">RSI 14</button>' +
          '<button class="indicator-toggle-btn" data-indicator="macd" aria-pressed="false">MACD</button>' +
        '</div>' +
        '<div class="prediction-toggles" id="predictionToggles" role="group" aria-label="Prediction models">' +
          '<span class="prediction-toggle-label">Predict</span>' +
          '<button class="prediction-toggle-btn' + (activeModel === 'linear' ? ' active' : '') + '" data-model="linear" aria-pressed="' + (activeModel === 'linear') + '">Linear Trend</button>' +
          '<button class="prediction-toggle-btn' + (activeModel === 'movingAverage' ? ' active' : '') + '" data-model="movingAverage" aria-pressed="' + (activeModel === 'movingAverage') + '">Moving Average</button>' +
          '<button class="prediction-toggle-btn' + (activeModel === 'holt' ? ' active' : '') + '" data-model="holt" aria-pressed="' + (activeModel === 'holt') + '">Exponential</button>' +
          '<button class="prediction-toggle-btn' + (activeModel === 'monteCarlo' ? ' active' : '') + '" data-model="monteCarlo" aria-pressed="' + (activeModel === 'monteCarlo') + '">Monte Carlo</button>' +
        '</div>' +
        '<div class="prediction-explain-card" id="predictionExplain"></div>' +
        '<div class="prediction-stats" id="predictionStats"></div>' +
      '</div>' +

    '</div>';

  // Initialize chart
  initChart(symbol);

  // Attach expand-to-fullscreen
  var expandBtn = container.querySelector("#expandChartBtn");
  if (expandBtn) {
    expandBtn.addEventListener("click", function () {
      var chartSection = expandBtn.closest(".chart-section");
      if (!chartSection) return;
      chartSection.classList.toggle("chart-fullscreen");
      if (currentChart) {
        setTimeout(function () {
          var chartContainer = document.getElementById("chartContainer");
          if (chartContainer && currentChart.chart) {
            currentChart.chart.applyOptions({ width: chartContainer.clientWidth });
          }
        }, 100);
      }
    });
  }

  // Attach time-period toggles
  container.querySelectorAll("#chartTimeToggles .chart-toggle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      container.querySelectorAll("#chartTimeToggles .chart-toggle-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var period = btn.dataset.period || "D";
      var days = parseInt(btn.dataset.days, 10) || 60;
      loadNewCandleData(symbol, period, days);
    });
  });

  // Attach indicator toggles
  container.querySelectorAll("#indicatorToggles .indicator-toggle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.dataset.indicator;
      var isOn = btn.getAttribute("aria-pressed") === "true";
      if (isOn) {
        removeIndicator(name);
        btn.setAttribute("aria-pressed", "false");
        btn.classList.remove("active");
      } else {
        addIndicator(name);
        btn.setAttribute("aria-pressed", "true");
        btn.classList.add("active");
      }
    });
  });

  // Attach prediction model toggles
  container.querySelectorAll("#predictionToggles .prediction-toggle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      container.querySelectorAll("#predictionToggles .prediction-toggle-btn").forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      activeModel = btn.dataset.model || "linear";
      if (currentChart && currentHistPrices.length >= 2) {
        addPredictionOverlay(currentChart.chart, currentHistPrices);
      }
    });
  });
}

/**
 * Add a technical indicator overlay to the chart.
 * @param {string} name - Indicator key (sma20, sma50, ema200, bb, rsi, macd)
 */
function addIndicator(name) {
  if (!currentChart || currentHistPrices.length < 2) return;
  if (activeIndicators[name]) return;

  var prices = currentHistPrices;
  var times = currentCandleData.map(function (c) { return c.time; });

  function toSeries(values) {
    var out = [];
    for (var i = 0; i < values.length && i < times.length; i++) {
      if (values[i] == null || isNaN(values[i])) continue;
      out.push({ time: times[i], value: values[i] });
    }
    return out;
  }

  var seriesData = null;
  var opts = {};
  switch (name) {
    case "sma20":
      seriesData = toSeries(calculateSMA(prices, 20));
      opts = { color: "#FF9F0A", width: 1, title: "SMA 20" };
      break;
    case "sma50":
      seriesData = toSeries(calculateSMA(prices, 50));
      opts = { color: "#AF52DE", width: 1, title: "SMA 50" };
      break;
    case "ema200":
      seriesData = toSeries(calculateEMA(prices, 200));
      opts = { color: "#5AC8FA", width: 1, title: "EMA 200" };
      break;
    case "bb":
      var bb = calculateBollingerBands(prices, 20, 2);
      var upper = addLineSeries(currentChart.chart, toSeries(bb.upper), { color: "#FF453A88", width: 1, title: "BB Upper" });
      var middle = addLineSeries(currentChart.chart, toSeries(bb.middle), { color: "#6B6B6B88", width: 1, title: "BB Mid" });
      var lower = addLineSeries(currentChart.chart, toSeries(bb.lower), { color: "#34C75988", width: 1, title: "BB Lower" });
      activeIndicators[name] = [upper, middle, lower];
      indicatorSeries.push(upper, middle, lower);
      return;
    case "rsi":
      // RSI overlays the lower band of the main chart on its own price scale.
      var rsiSeries = addLineSeries(currentChart.chart, toSeries(calculateRSI(prices, 14)), {
        color: "#AF52DE", width: 1, title: "RSI 14", priceScaleId: "rsi",
      });
      try {
        rsiSeries.createPriceLine({ price: 70, color: "#FF453A88", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
        rsiSeries.createPriceLine({ price: 30, color: "#34C75988", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
      } catch (e) {}
      activeIndicators[name] = rsiSeries;
      indicatorSeries.push(rsiSeries);
      break;
    case "macd":
      // MACD + signal lines overlay the lower band on their own price scale.
      var macd = calculateMACD(prices, 12, 26, 9);
      var macdLine = addLineSeries(currentChart.chart, toSeries(macd.macd), {
        color: "#0071E3", width: 1, title: "MACD", priceScaleId: "macd",
      });
      var signalLine = addLineSeries(currentChart.chart, toSeries(macd.signal), {
        color: "#FF9F0A", width: 1, title: "Signal", priceScaleId: "macd",
      });
      activeIndicators[name] = [macdLine, signalLine];
      indicatorSeries.push(macdLine, signalLine);
      break;
    default:
      return;
  }

  if (seriesData && seriesData.length > 0) {
    var series = addLineSeries(currentChart.chart, seriesData, opts);
    activeIndicators[name] = series;
    indicatorSeries.push(series);
  }

  updateScaleMargins();
}

/**
 * Remove an indicator overlay by name.
 * @param {string} name
 */
function removeIndicator(name) {
  var ref = activeIndicators[name];
  if (ref) {
    if (Array.isArray(ref)) {
      ref.forEach(function (s) { removeChartSeries(currentChart.chart, s); });
    } else {
      removeChartSeries(currentChart.chart, ref);
    }
    delete activeIndicators[name];
  }
  updateScaleMargins();
}

/**
 * Clear all indicator overlays (called when chart is rebuilt).
 */
function clearIndicators() {
  activeIndicators = {};
  indicatorSeries = [];
}

/**
 * Re-render all active indicators with the current candle data.
 * Called when the time period changes so overlays track the new range.
 */
function reapplyIndicators() {
  var names = Object.keys(activeIndicators);
  names.forEach(function (n) { removeIndicator(n); });
  names.forEach(function (n) { addIndicator(n); });
}

/**
 * Recompute price/volume/indicator scale margins based on which RSI/MACD
 * overlays are active. RSI/MACD share the lower band of the main chart;
 * when both are on they stack, and volume moves to the very bottom.
 */
function updateScaleMargins() {
  if (!currentChart || !currentChart.chart) return;
  var chart = currentChart.chart;
  var hasRsi = !!activeIndicators["rsi"];
  var hasMacd = !!activeIndicators["macd"];
  var hasSub = hasRsi || hasMacd;

  chart.priceScale("right").applyOptions({
    scaleMargins: { top: 0, bottom: hasSub ? 0.3 : 0.2 },
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: hasSub ? 0.9 : 0.8, bottom: 0 },
  });

  if (hasRsi) {
    chart.priceScale("rsi").applyOptions({
      scaleMargins: hasMacd ? { top: 0.7, bottom: 0.2 } : { top: 0.7, bottom: 0.1 },
      autoScale: false,
    });
  }
  if (hasMacd) {
    chart.priceScale("macd").applyOptions({
      scaleMargins: hasRsi ? { top: 0.8, bottom: 0.1 } : { top: 0.7, bottom: 0.1 },
      autoScale: true,
    });
  }
}

/**
 * Initialize the chart with current candle data.
 */
function initChart(symbol) {
  var chartContainer = document.getElementById("chartContainer");
  if (!chartContainer) return;

  // Clean up previous chart and indicators
  if (currentChart) {
    destroyChart(currentChart.chart);
    currentChart = null;
  }
  clearIndicators();
  predictionSeries = [];

  createStockChart(chartContainer, { height: 300 }).then(function (chartObj) {
    if (!chartObj) {
      // Fallback: render SVG prediction cone
      renderSvgFallback(symbol);
      return;
    }
    currentChart = chartObj;

    // Set candlestick data
    if (currentCandleData.length > 0) {
      var candleData = currentCandleData.map(function (c) {
        return {
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
      });
      setCandlestickData(chartObj.candlestickSeries, candleData);

      // Set volume data
      var volData = currentCandleData.map(function (c) {
        var isUp = c.close >= c.open;
        return {
          time: c.time,
          value: c.volume,
          color: isUp ? '#34C75944' : '#FF453A44',
        };
      });
      setVolumeData(chartObj.volumeSeries, volData);

      // Add prediction overlay
      addPredictionOverlay(chartObj.chart, currentHistPrices);
    }

    // Fit content after layout so bars span the full chart width
    requestAnimationFrame(function () {
      if (currentChart && currentChart.chart) {
        currentChart.chart.timeScale().fitContent();
      }
    });
  });
}

/**
 * Add the active prediction model's cone overlay to the chart.
 * Removes any previous overlay first. Horizon adapts to the data resolution:
 * 30 days for daily bars, 8 weeks for weekly bars.
 */
function addPredictionOverlay(chart, histPrices) {
  if (!chart || histPrices.length < 2) return;

  removePredictionOverlay(chart);

  var horizon = currentResolution === 'W' ? 8 : 30;
  var step = currentResolution === 'W' ? 7 * 86400 : 86400;
  var result = runModel(activeModel, histPrices, horizon);
  var lastTime = currentCandleData.length > 0 ? currentCandleData[currentCandleData.length - 1].time : Math.floor(Date.now() / 1000);

  var forecastLine = [];
  var lower68 = [];
  var upper68 = [];
  var lower95 = [];
  var upper95 = [];

  for (var i = 0; i < horizon; i++) {
    var t = lastTime + (i + 1) * step;
    forecastLine.push({ time: t, value: result.forecast[i] });
    lower68.push({ time: t, value: result.lower68[i] });
    upper68.push({ time: t, value: result.upper68[i] });
    lower95.push({ time: t, value: result.lower95[i] });
    upper95.push({ time: t, value: result.upper95[i] });
  }

  predictionSeries = addPredictionCone(chart, forecastLine, lower68, upper68, lower95, upper95);

  // Plain-language explanation + compact stats
  renderPredictionExplain(result, horizon);
  var statsEl = document.getElementById("predictionStats");
  if (statsEl) {
    statsEl.innerHTML = renderModelStats(result, horizon);
  }
}

/**
 * Remove the current prediction overlay series from the chart.
 */
function removePredictionOverlay(chart) {
  if (predictionSeries && predictionSeries.length) {
    predictionSeries.forEach(function (s) { removeChartSeries(chart, s); });
    predictionSeries = [];
  }
}

/**
 * Render the plain-language prediction explanation card.
 * Collapsed by default so the chart keeps the vertical space; the full
 * explanation expands on demand.
 */
function renderPredictionExplain(result, horizon) {
  var el = document.getElementById("predictionExplain");
  if (!el) return;
  var horizonText = currentResolution === 'W' ? horizon + " weeks" : horizon + " days";
  el.innerHTML =
    '<div class="prediction-explain-title">' + escapeHtml(result.label) + ' — what it does</div>' +
    '<p class="prediction-explain-result"><strong>' + escapeHtml(currentSymbol) + '</strong> is projected to be around ' + fmtPrice(result.stats.expectedPrice) + ' in ' + horizonText + '.</p>' +
    '<button class="prediction-explain-toggle" id="explainToggle" aria-expanded="false" aria-controls="explainBody">What does this mean?</button>' +
    '<div class="prediction-explain-body" id="explainBody" hidden>' +
      '<p class="prediction-explain-text">' + escapeHtml(result.explain) + '</p>' +
      '<p class="prediction-explain-confidence">' + escapeHtml(result.stats.confidenceText) + '.</p>' +
      '<p class="prediction-explain-disclaimer">Estimates from past prices only — not financial advice.</p>' +
    '</div>';

  var toggle = el.querySelector("#explainToggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var body = el.querySelector("#explainBody");
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      if (body) body.hidden = expanded;
    });
  }
}

/**
 * Render the compact model stats line.
 */
function renderModelStats(result, horizon) {
  var ret = result.stats.expectedReturn;
  var sign = ret > 0 ? "+" : "";
  var unit = currentResolution === 'W' ? 'w' : 'd';
  var ci = (result.stats.confidenceLow != null && result.stats.confidenceHigh != null)
    ? '95% CI: ' + fmtPrice(result.stats.confidenceLow) + '–' + fmtPrice(result.stats.confidenceHigh)
    : escapeHtml(result.stats.confidenceText);
  return '' +
    '<span class="prediction-stat">Model: ' + escapeHtml(result.label) + '</span>' +
    '<span class="prediction-stat">' + horizon + unit + ' return: ' + sign + ret.toFixed(2) + '%</span>' +
    '<span class="prediction-stat">' + ci + '</span>';
}

/**
 * Format a price with a dollar sign.
 */
function fmtPrice(v) {
  if (v == null || isNaN(v)) return "--";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Load new candle data when time period changes.
 */
function loadNewCandleData(symbol, period, days) {
  fetchIntraday(symbol, period, days).then(function (candles) {
    currentCandleData = Array.isArray(candles) ? candles : [];
    currentHistPrices = currentCandleData.map(function (c) { return c.close; });
    currentResolution = period === 'W' ? 'W' : 'D';

    if (currentChart && currentCandleData.length > 0) {
      var candleData = currentCandleData.map(function (c) {
        return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
      });
      setCandlestickData(currentChart.candlestickSeries, candleData);

      var volData = currentCandleData.map(function (c) {
        var isUp = c.close >= c.open;
        return { time: c.time, value: c.volume, color: isUp ? '#34C75944' : '#FF453A44' };
      });
      setVolumeData(currentChart.volumeSeries, volData);

      // Re-add prediction with the active model
      addPredictionOverlay(currentChart.chart, currentHistPrices);

      // Re-render active indicators against the new candle range
      reapplyIndicators();

      // Fit content after layout so bars span the full chart width
      requestAnimationFrame(function () {
        if (currentChart && currentChart.chart) {
          currentChart.chart.timeScale().fitContent();
        }
      });
    } else {
      // No chart or no data, try SVG fallback
      renderSvgFallback(symbol);
    }
  });
}

/**
 * Render SVG prediction cone as fallback when Lightweight Charts fails to load.
 */
function renderSvgFallback(symbol) {
  var chartContainer = document.getElementById("chartContainer");
  if (!chartContainer) return;

  if (currentHistPrices.length >= 2) {
    var horizon = currentResolution === 'W' ? 8 : 30;
    var result = runModel(activeModel, currentHistPrices, horizon);
    chartContainer.innerHTML =
      '<div class="prediction-chart">' +
        renderPredictionCone(currentHistPrices, result, { width: 400, height: 140 }) +
      '</div>';
    renderPredictionExplain(result, horizon);
    var statsEl = document.getElementById("predictionStats");
    if (statsEl) {
      statsEl.innerHTML = renderModelStats(result, horizon);
    }
  } else {
    chartContainer.innerHTML =
      '<div class="stocks-empty" style="padding:var(--space-xl)">' +
        '<p style="font-size:var(--text-sm)">Insufficient price data for charting</p>' +
      '</div>';
  }
}

/**
 * Render error state.
 */
function renderError(container, symbol, err) {
  container.innerHTML =
    '<div class="stock-detail-zone">' +
      '<div class="stocks-error">' +
        '<p class="stocks-error-msg">Could not load data for ' + escapeHtml(symbol) + '.</p>' +
        '<p class="stocks-error-detail">' + escapeHtml(err.message || "Unknown error") + '</p>' +
        '<button class="stocks-retry-btn">Retry</button>' +
      '</div>' +
    '</div>';

  container.querySelector(".stocks-retry-btn")?.addEventListener("click", function () {
    renderStockDetail(container, symbol);
  });
}

/**
 * Format a price number.
 */
function formatPrice(price) {
  if (price == null) return "--";
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Abbreviate volume.
 */
function abbreviateVolume(vol) {
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + "B";
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + "M";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return String(vol);
}

/**
 * Abbreviate market cap.
 */
function abbreviateMarketCap(cap) {
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
