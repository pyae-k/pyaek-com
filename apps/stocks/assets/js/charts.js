/**
 * Charts module — TradingView Lightweight Charts integration.
 * Dynamically loads the library from CDN with SVG fallback.
 * Provides candlestick, line, volume histogram, and prediction cone rendering.
 */

var LIGHTWEIGHT_CDN = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
var chartsLib = null;
var loadPromise = null;

/**
 * Dynamically load the Lightweight Charts library from CDN.
 * @returns {Promise<object>} The lightweight-charts module
 */
export function loadLightweightCharts() {
  if (chartsLib) return Promise.resolve(chartsLib);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = LIGHTWEIGHT_CDN;
    script.async = true;
    script.onload = function () {
      chartsLib = window.LightweightCharts || window.lightweightCharts;
      if (!chartsLib) {
        reject(new Error('Lightweight Charts failed to load'));
        return;
      }
      resolve(chartsLib);
    };
    script.onerror = function () {
      loadPromise = null;
      reject(new Error('Failed to load Lightweight Charts from CDN'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Create a stock chart in a container element.
 * @param {HTMLElement} container - The DOM element to mount the chart in
 * @param {object} [opts] - Options
 * @param {boolean} [opts.dark=false] - Use dark theme
 * @param {number} [opts.width] - Chart width (default: container width)
 * @param {number} [opts.height=300] - Chart height
 * @returns {Promise<object>} { chart, candlestickSeries, volumeSeries }
 */
export async function createStockChart(container, opts) {
  opts = opts || {};
  var lib;
  try {
    lib = await loadLightweightCharts();
  } catch (e) {
    return null;
  }

  var isDark = opts.dark || document.documentElement.getAttribute('data-theme') === 'dark';
  var height = opts.height || 300;

  var chart = lib.createChart(container, {
    width: opts.width || container.clientWidth || 600,
    height: height,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: isDark ? '#9A9A9A' : '#6B6B6B',
    },
    grid: {
      vertLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
      horzLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
    },
    crosshair: {
      mode: 0,
      vertLine: {
        color: isDark ? '#5EACFF' : '#0071E3',
        width: 1,
        style: 2,
        labelBackgroundColor: isDark ? '#5EACFF' : '#0071E3',
      },
      horzLine: {
        color: isDark ? '#5EACFF' : '#0071E3',
        width: 1,
        style: 2,
        labelBackgroundColor: isDark ? '#5EACFF' : '#0071E3',
      },
    },
    timeScale: {
      borderColor: isDark ? '#3A3A3A' : '#E0E0E0',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 0,
    },
    rightPriceScale: {
      borderColor: isDark ? '#3A3A3A' : '#E0E0E0',
    },
  });

  var candlestickSeries = chart.addCandlestickSeries({
    upColor: '#34C759',
    downColor: '#FF453A',
    borderUpColor: '#34C759',
    borderDownColor: '#FF453A',
    wickUpColor: '#34C759',
    wickDownColor: '#FF453A',
  });

  var volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  // Handle resize: keep the full data range fitted so bars span the width,
  // and match the container height so the chart fills its flex space.
  function handleResize() {
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w > 0) {
      chart.applyOptions({ width: w, height: h > 0 ? h : height });
      chart.timeScale().fitContent();
    }
  }

  var resizeObserver = null;
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
  }

  // Store cleanup on the chart object
  chart._cleanup = function () {
    if (resizeObserver) resizeObserver.disconnect();
    chart.remove();
  };

  return { chart: chart, candlestickSeries: candlestickSeries, volumeSeries: volumeSeries };
}

/**
 * Set candlestick data on a series.
 * @param {object} series - The candlestick series
 * @param {Array} data - Array of { time, open, high, low, close }
 */
export function setCandlestickData(series, data) {
  if (!series || !data) return;
  series.setData(data);
}

/**
 * Set volume data on a histogram series.
 * @param {object} series - The volume histogram series
 * @param {Array} data - Array of { time, value, color }
 */
export function setVolumeData(series, data) {
  if (!series || !data) return;
  series.setData(data);
}

/**
 * Add a line series to the chart (for forecast, EMA, etc.).
 * @param {object} chart - The chart instance
 * @param {Array} data - Array of { time, value }
 * @param {object} [opts] - Options
 * @param {string} [opts.color='#0071E3'] - Line color
 * @param {number} [opts.width=2] - Line width
 * @param {number[]} [opts.lineStyle] - Dash array for dashed lines
 * @param {string} [opts.title] - Series title
 * @param {string} [opts.priceScaleId] - Price scale to attach to (e.g. 'rsi', 'macd')
 * @param {boolean} [opts.lastValueVisible=true] - Show the last-value label
 * @param {boolean} [opts.priceLineVisible=false] - Show the price line
 * @returns {object} The line series
 */
export function addLineSeries(chart, data, opts) {
  if (!chart || !data) return null;
  opts = opts || {};

  var series = chart.addLineSeries({
    color: opts.color || '#0071E3',
    lineWidth: opts.width || 2,
    lineStyle: opts.lineStyle || 0,
    lastValueVisible: opts.lastValueVisible !== undefined ? opts.lastValueVisible : true,
    priceLineVisible: opts.priceLineVisible !== undefined ? opts.priceLineVisible : false,
    priceScaleId: opts.priceScaleId,
    title: opts.title || '',
  });

  series.setData(data);
  return series;
}

/**
 * Remove a series from a chart (used for indicator cleanup).
 * @param {object} chart - The chart instance
 * @param {object} series - The series to remove
 */
export function removeChartSeries(chart, series) {
  if (chart && series) {
    try { chart.removeSeries(series); } catch (e) {}
  }
}

/**
 * Add a prediction cone (confidence bands) to the chart.
 * @param {object} chart - The chart instance
 * @param {Array} forecastData - Array of { time, value } for the forecast line
 * @param {Array} lower68 - Array of { time, value } for lower 68% band
 * @param {Array} upper68 - Array of { time, value } for upper 68% band
 * @param {Array} lower95 - Array of { time, value } for lower 95% band
 * @param {Array} upper95 - Array of { time, value } for upper 95% band
 * @param {object} [opts] - Options
 * @param {string} [opts.color='#0071E3'] - Forecast line color
 */
export function addPredictionCone(chart, forecastData, lower68, upper68, lower95, upper95, opts) {
  if (!chart) return [];
  opts = opts || {};
  var color = opts.color || '#0071E3';
  var created = [];

  // 95% band (outer, more transparent)
  if (lower95 && upper95 && lower95.length > 0 && upper95.length > 0) {
    var band95Data = [];
    for (var i = 0; i < lower95.length; i++) {
      band95Data.push({ time: lower95[i].time, value: lower95[i].value });
    }
    for (var j = upper95.length - 1; j >= 0; j--) {
      band95Data.push({ time: upper95[j].time, value: upper95[j].value });
    }
    created.push(chart.addAreaSeries({
      data: band95Data,
      lineColor: 'transparent',
      topColor: color + '15',
      bottomColor: color + '05',
      priceLineVisible: false,
      lastValueVisible: false,
    }));
  }

  // 68% band (inner, more opaque)
  if (lower68 && upper68 && lower68.length > 0 && upper68.length > 0) {
    var band68Data = [];
    for (var i = 0; i < lower68.length; i++) {
      band68Data.push({ time: lower68[i].time, value: lower68[i].value });
    }
    for (var j = upper68.length - 1; j >= 0; j--) {
      band68Data.push({ time: upper68[j].time, value: upper68[j].value });
    }
    created.push(chart.addAreaSeries({
      data: band68Data,
      lineColor: 'transparent',
      topColor: color + '30',
      bottomColor: color + '10',
      priceLineVisible: false,
      lastValueVisible: false,
    }));
  }

  // Forecast line (dashed)
  if (forecastData && forecastData.length > 0) {
    created.push(chart.addLineSeries({
      data: forecastData,
      color: color,
      lineWidth: 2,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'Forecast',
    }));
  }

  return created;
}

/**
 * Create a multi-series comparison chart (rebased to 100 by default).
 * @param {HTMLElement} container - The DOM element to mount the chart in
 * @param {Array} seriesData - Array of { symbol, data: [{ time, value }], color }
 * @param {object} [opts] - Options
 * @param {number} [opts.height=260] - Chart height
 * @param {boolean} [opts.rebased=true] - Rebase all series to start at 100
 * @param {object} [opts.candleData] - Optional per-series candle data: { symbol: [{time, open, high, low, close}] }
 * @returns {Promise<{ chart, series: object[], legendEl }|null>}
 */
export async function createComparisonChart(container, seriesData, opts) {
  if (!container || !seriesData || seriesData.length === 0) return null;
  opts = opts || {};
  var lib;
  try {
    lib = await loadLightweightCharts();
  } catch (e) {
    return null;
  }

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var height = opts.height || 260;
  var rebased = opts.rebased !== false;

  var chart = lib.createChart(container, {
    width: container.clientWidth || 600,
    height: height,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: isDark ? '#9A9A9A' : '#6B6B6B',
    },
    grid: {
      vertLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
      horzLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
    },
    crosshair: {
      vertLine: { color: isDark ? '#5EACFF' : '#0071E3', labelBackgroundColor: isDark ? '#5EACFF' : '#0071E3' },
      horzLine: { color: isDark ? '#5EACFF' : '#0071E3', labelBackgroundColor: isDark ? '#5EACFF' : '#0071E3' },
    },
    timeScale: { borderColor: isDark ? '#3A3A3A' : '#E0E0E0', timeVisible: true },
    rightPriceScale: { borderColor: isDark ? '#3A3A3A' : '#E0E0E0' },
  });

  var PALETTE = ['#0071E3', '#34C759', '#FF9F0A', '#FF453A', '#AF52DE', '#5AC8FA'];
  var series = [];

  seriesData.forEach(function (sd, i) {
    var color = sd.color || PALETTE[i % PALETTE.length];
    var seriesObj = chart.addLineSeries({
      color: color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: sd.symbol,
    });

    var data = sd.data;
    if (rebased && data && data.length > 0) {
      var base = data[0].value || 1;
      data = data.map(function (p) {
        return { time: p.time, value: (p.value / base) * 100 };
      });
    }
    seriesObj.setData(data || []);
    series.push({ symbol: sd.symbol, series: seriesObj, color: color });
  });

  chart.timeScale().fitContent();

  // Legend
  var legendEl = document.createElement('div');
  legendEl.className = 'compare-chart-legend';
  legendEl.innerHTML = series.map(function (s) {
    return '<span class="compare-legend-item">' +
      '<span class="compare-legend-color" style="background:' + s.color + '"></span>' +
      '<span class="compare-legend-symbol">' + s.symbol + '</span>' +
    '</span>';
  }).join('');

  // Handle resize
  function handleResize() {
    var w = container.clientWidth;
    if (w > 0) chart.applyOptions({ width: w });
  }
  var resizeObserver = null;
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
  }

  chart._cleanup = function () {
    if (resizeObserver) resizeObserver.disconnect();
    chart.remove();
  };

  return { chart: chart, series: series, legendEl: legendEl };
}

/**
 * Destroy a chart created by createComparisonChart.
 * @param {object} chartObj
 */
export function destroyComparisonChart(chartObj) {
  if (chartObj && chartObj.chart && chartObj.chart._cleanup) {
    chartObj.chart._cleanup();
  }
}

/**
 * Update chart theme (dark/light) without recreating.
 * @param {object} chart - The chart instance
 * @param {boolean} isDark - Whether dark mode is active
 */
export function updateChartTheme(chart, isDark) {
  if (!chart) return;
  chart.applyOptions({
    layout: {
      textColor: isDark ? '#9A9A9A' : '#6B6B6B',
    },
    grid: {
      vertLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
      horzLines: { color: isDark ? '#2A2A2A' : '#F0F0F0' },
    },
    timeScale: {
      borderColor: isDark ? '#3A3A3A' : '#E0E0E0',
    },
    rightPriceScale: {
      borderColor: isDark ? '#3A3A3A' : '#E0E0E0',
    },
  });
}

/**
 * Clean up and remove a chart.
 * @param {object} chart - The chart instance
 */
export function destroyChart(chart) {
  if (chart && chart._cleanup) {
    chart._cleanup();
  }
}
