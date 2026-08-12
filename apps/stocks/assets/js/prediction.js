/**
 * Prediction module — simple linear regression for stock price forecasting.
 * Enhanced with statistical annotations, volume bars, and time-period toggles.
 * No external dependencies.
 */

/**
 * Calculate linear regression forecast from historical prices.
 * @param {number[]} prices - Array of closing prices (oldest first).
 * @param {number} [daysToForecast=5] - Number of days to project forward.
 * @returns {{ forecast: number[], lower68: number[], upper68: number[], lower95: number[], upper95: number[], slope: number, rSquared: number, intercept: number, stdErr: number }}
 */
export function predictTrend(prices, daysToForecast) {
  if (daysToForecast === undefined) daysToForecast = 5;
  var n = prices.length;
  if (n < 2) {
    var fill = Array(daysToForecast).fill(prices[0] || 0);
    return {
      forecast: fill,
      lower68: fill, upper68: fill,
      lower95: fill, upper95: fill,
      slope: 0, rSquared: 0, intercept: prices[0] || 0, stdErr: 0,
    };
  }

  // x values: 0, 1, 2, ..., n-1
  var x = prices.map(function(_, i) { return i; });
  var y = prices;

  var sumX = x.reduce(function(a, b) { return a + b; }, 0);
  var sumY = y.reduce(function(a, b) { return a + b; }, 0);
  var sumXY = x.reduce(function(a, _, i) { return a + x[i] * y[i]; }, 0);
  var sumX2 = x.reduce(function(a, _, i) { return a + x[i] * x[i]; }, 0);
  var meanX = sumX / n;
  var meanY = sumY / n;

  // slope = (n*sum(xy) - sum(x)*sum(y)) / (n*sum(x²) - sum(x)²)
  var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // intercept = mean(y) - slope * mean(x)
  var intercept = meanY - slope * meanX;

  // R-squared
  var ssRes = y.reduce(function(a, _, i) {
    var pred = slope * x[i] + intercept;
    return a + (y[i] - pred) * (y[i] - pred);
  }, 0);
  var ssTot = y.reduce(function(a, _, i) { return a + (y[i] - meanY) * (y[i] - meanY); }, 0);
  var rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Standard error of the estimate
  var stdErr = n > 2 ? Math.sqrt(ssRes / (n - 2)) : (prices.reduce(function(a, b) { return a + Math.abs(b); }, 0) / n);

  // Generate forecast with confidence intervals
  var forecast = [];
  var lower68 = [];
  var upper68 = [];
  var lower95 = [];
  var upper95 = [];

  for (var i = 0; i < daysToForecast; i++) {
    var day = n + i;
    var pred = slope * day + intercept;
    forecast.push(pred);

    // Uncertainty cone widens with each forecast day
    var margin = stdErr * (1 + i * 0.5);
    lower68.push(pred - margin * 1.0);
    upper68.push(pred + margin * 1.0);
    lower95.push(pred - margin * 2.0);
    upper95.push(pred + margin * 2.0);
  }

  return { forecast: forecast, lower68: lower68, upper68: upper68, lower95: lower95, upper95: upper95, slope: slope, rSquared: rSquared, intercept: intercept, stdErr: stdErr };
}

/**
 * Render a small sparkline SVG string.
 * @param {number[]} prices - Data points (oldest first).
 * @param {number} [width=60] - SVG width.
 * @param {number} [height=18] - SVG height.
 * @returns {string} SVG markup.
 */
export function renderSparkline(prices, width, height) {
  if (width === undefined) width = 60;
  if (height === undefined) height = 18;
  if (!prices || prices.length < 2) {
    return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg"></svg>';
  }

  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  var range = max - min || 1;
  var padding = 2;
  var drawW = width - padding * 2;
  var drawH = height - padding * 2;

  var points = prices.map(function(p, i) {
    var x = padding + (i / (prices.length - 1)) * drawW;
    var y = padding + drawH - ((p - min) / range) * drawH;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  var isUp = prices[prices.length - 1] >= prices[0];
  var strokeColor = isUp ? 'var(--color-success, #34C759)' : 'var(--color-error, #FF453A)';

  // Area fill
  var areaPoints = points + ' ' + (width - padding).toFixed(1) + ',' + (padding + drawH).toFixed(1) + ' ' + padding.toFixed(1) + ',' + (padding + drawH).toFixed(1);

  return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="sparkGrad' + Math.random().toString(36).slice(2, 6) + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + strokeColor + '" stop-opacity="0.2"/>' +
    '<stop offset="100%" stop-color="' + strokeColor + '" stop-opacity="0.02"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<polygon fill="url(#sparkGrad' + Math.random().toString(36).slice(2, 6) + ')" stroke="none" points="' + areaPoints + '"/>' +
    '<polyline fill="none" stroke="' + strokeColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="' + points + '"/>' +
    '</svg>';
}

/**
 * Render a prediction cone SVG string with historical data, forecast line,
 * 68% and 95% confidence bands, and optional volume bars.
 * @param {number[]} historicalPrices - Past prices (oldest first).
 * @param {object} forecastResult - Result from predictTrend.
 * @param {object} [opts] - Options.
 * @param {number} [opts.width=400] - SVG width.
 * @param {number} [opts.height=140] - SVG height.
 * @param {number[]} [opts.volumes] - Volume data for histogram bars.
 * @param {boolean} [opts.rebased=false] - Show rebased-to-100 view.
 * @returns {string} SVG markup.
 */
export function renderPredictionCone(historicalPrices, forecastResult, opts) {
  if (!opts) opts = {};
  var width = opts.width || 400;
  var height = opts.height || 140;
  var volumes = opts.volumes || [];
  var rebased = opts.rebased || false;

  var forecast = forecastResult.forecast;
  var lower68 = forecastResult.lower68;
  var upper68 = forecastResult.upper68;
  var lower95 = forecastResult.lower95;
  var upper95 = forecastResult.upper95;

  var allValues;
  if (rebased) {
    var basePrice = historicalPrices[0] || 1;
    allValues = historicalPrices.map(function(p) { return (p / basePrice) * 100; })
      .concat(forecast.map(function(p) { return (p / basePrice) * 100; }))
      .concat(lower68.map(function(p) { return (p / basePrice) * 100; }))
      .concat(upper68.map(function(p) { return (p / basePrice) * 100; }))
      .concat(lower95.map(function(p) { return (p / basePrice) * 100; }))
      .concat(upper95.map(function(p) { return (p / basePrice) * 100; }));
  } else {
    allValues = historicalPrices.concat(forecast).concat(lower68).concat(upper68).concat(lower95).concat(upper95);
  }

  var min = Math.min.apply(null, allValues);
  var max = Math.max.apply(null, allValues);
  var range = max - min || 1;
  var padding = { top: 8, right: 8, bottom: 20, left: 8 };
  var drawW = width - padding.left - padding.right;
  var drawH = height - padding.top - padding.bottom;
  var totalPoints = historicalPrices.length + forecast.length;

  var scaleY = function(v) { return padding.top + drawH - ((v - min) / range) * drawH; };
  var scaleX = function(i) { return padding.left + (i / (totalPoints - 1 || 1)) * drawW; };

  // Rebase if needed
  var basePrice = rebased ? (historicalPrices[0] || 1) : 1;
  var hist = rebased ? historicalPrices.map(function(p) { return (p / basePrice) * 100; }) : historicalPrices;
  var fcast = rebased ? forecast.map(function(p) { return (p / basePrice) * 100; }) : forecast;
  var l68 = rebased ? lower68.map(function(p) { return (p / basePrice) * 100; }) : lower68;
  var u68 = rebased ? upper68.map(function(p) { return (p / basePrice) * 100; }) : upper68;
  var l95 = rebased ? lower95.map(function(p) { return (p / basePrice) * 100; }) : lower95;
  var u95 = rebased ? upper95.map(function(p) { return (p / basePrice) * 100; }) : upper95;

  // Historical line points
  var histPoints = hist.map(function(p, i) {
    return scaleX(i).toFixed(1) + ',' + scaleY(p).toFixed(1);
  }).join(' ');

  // Forecast line points
  var fcastPoints = fcast.map(function(p, i) {
    var idx = historicalPrices.length + i;
    return scaleX(idx).toFixed(1) + ',' + scaleY(p).toFixed(1);
  }).join(' ');

  // 95% confidence cone
  var cone95Top = u95.map(function(_, i) {
    var idx = historicalPrices.length + i;
    return scaleX(idx).toFixed(1) + ',' + scaleY(u95[i]).toFixed(1);
  });
  var cone95Bottom = l95.map(function(_, i) {
    var idx = historicalPrices.length + i;
    return scaleX(idx).toFixed(1) + ',' + scaleY(l95[i]).toFixed(1);
  }).reverse();
  var cone95Points = cone95Top.concat(cone95Bottom).join(' ');

  // 68% confidence cone
  var cone68Top = u68.map(function(_, i) {
    var idx = historicalPrices.length + i;
    return scaleX(idx).toFixed(1) + ',' + scaleY(u68[i]).toFixed(1);
  });
  var cone68Bottom = l68.map(function(_, i) {
    var idx = historicalPrices.length + i;
    return scaleX(idx).toFixed(1) + ',' + scaleY(l68[i]).toFixed(1);
  }).reverse();
  var cone68Points = cone68Top.concat(cone68Bottom).join(' ');

  // Volume bars
  var volumeHtml = '';
  if (volumes && volumes.length > 0) {
    var volMax = Math.max.apply(null, volumes);
    var volRange = volMax || 1;
    var volBarW = (drawW / historicalPrices.length) * 0.6;
    var volBarMaxH = 20;
    var volBars = volumes.map(function(v, i) {
      if (i >= historicalPrices.length) return '';
      var barH = (v / volRange) * volBarMaxH;
      var x = scaleX(i) - volBarW / 2;
      var y = height - padding.bottom - barH;
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + volBarW.toFixed(1) + '" height="' + barH.toFixed(1) + '" fill="var(--color-border, #E0E0E0)" fill-opacity="0.4" rx="1"/>';
    }).join('');
    volumeHtml = volBars;
  }

  var gradId = 'coneGrad' + Math.random().toString(36).slice(2, 6);
  var gradId68 = 'coneGrad68' + Math.random().toString(36).slice(2, 6);

  return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0%" stop-color="var(--color-accent, #0071E3)" stop-opacity="0.15"/>' +
    '<stop offset="100%" stop-color="var(--color-accent, #0071E3)" stop-opacity="0.04"/>' +
    '</linearGradient>' +
    '<linearGradient id="' + gradId68 + '" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0%" stop-color="var(--color-accent, #0071E3)" stop-opacity="0.3"/>' +
    '<stop offset="100%" stop-color="var(--color-accent, #0071E3)" stop-opacity="0.08"/>' +
    '</linearGradient>' +
    '</defs>' +
    // Volume bars
    volumeHtml +
    // 95% confidence band
    '<polygon fill="url(#' + gradId + ')" stroke="none" points="' + cone95Points + '"/>' +
    // 68% confidence band
    '<polygon fill="url(#' + gradId68 + ')" stroke="none" points="' + cone68Points + '"/>' +
    // Historical line
    '<polyline fill="none" stroke="var(--color-accent, #0071E3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="' + histPoints + '"/>' +
    // Forecast line (dashed)
    '<polyline fill="none" stroke="var(--color-accent, #0071E3)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" points="' + fcastPoints + '"/>' +
    // Labels
    '<text x="' + padding.left + '" y="' + (height - 4) + '" fill="var(--color-text-secondary, #6B6B6B)" font-size="9" font-family="var(--font-sans, sans-serif)">History</text>' +
    '<text x="' + (width - padding.right) + '" y="' + (height - 4) + '" fill="var(--color-text-secondary, #6B6B6B)" font-size="9" text-anchor="end" font-family="var(--font-sans, sans-serif)">Forecast</text>' +
    '</svg>';
}

/**
 * Render prediction stats line with statistical annotations.
 * @param {object} forecast - Result from predictTrend.
 * @param {number} [daysToForecast=5] - Number of forecast days.
 * @returns {string} HTML string.
 */
export function renderPredictionStats(forecast, daysToForecast) {
  if (daysToForecast === undefined) daysToForecast = 5;
  var slope = forecast.slope;
  var r2 = forecast.rSquared;
  var stdErr = forecast.stdErr;
  var lastForecast = forecast.forecast[forecast.forecast.length - 1] || 0;
  var firstForecast = forecast.forecast[0] || 0;
  var expectedReturn = firstForecast !== 0 ? ((lastForecast - firstForecast) / firstForecast * 100) : 0;

  return '' +
    '<span class="prediction-stat">Slope: ' + (slope > 0 ? '+' : '') + slope.toFixed(4) + '</span>' +
    '<span class="prediction-stat">R²: ' + r2.toFixed(4) + '</span>' +
    '<span class="prediction-stat">StdErr: ' + stdErr.toFixed(2) + '</span>' +
    '<span class="prediction-stat">' + daysToForecast + 'd return: ' + (expectedReturn > 0 ? '+' : '') + expectedReturn.toFixed(2) + '%</span>';
}
