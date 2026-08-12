/**
 * Prediction models module — standard, transparent forecasting formulas.
 * Each model returns a common shape: a forecast line, 68%/95% confidence
 * bands, stats, and a plain-language explanation aimed at a non-technical
 * public audience. No external dependencies.
 *
 * Models:
 *   linear       — ordinary least-squares regression (reuses predictTrend)
 *   movingAverage — projects the mean daily change over the last 20 bars
 *   holt         — Holt's linear-trend exponential smoothing
 *   monteCarlo   — random walk with drift, 1,000 simulated paths
 */

import { predictTrend } from "./prediction.js";

/**
 * Format a price for the plain-language confidence text.
 */
function fmtPrice(v) {
  if (v == null || isNaN(v)) return "--";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Mean of an array.
 */
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
}

/**
 * Sample standard deviation of an array.
 */
function stdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  var m = mean(arr);
  var sq = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

/**
 * Gaussian random number (Box-Muller transform).
 */
function gaussianRandom() {
  var u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Percentile of an array (p in 0-100).
 */
function percentile(arr, p) {
  var sorted = arr.slice().sort(function (a, b) { return a - b; });
  var idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

/**
 * Build the shared stats object from a forecast + 95% band.
 */
function buildStats(forecast, lower95, upper95) {
  var last = forecast[forecast.length - 1];
  var first = forecast[0];
  var expectedReturn = first ? ((last - first) / first) * 100 : 0;
  var lo = lower95[lower95.length - 1];
  var hi = upper95[upper95.length - 1];
  return {
    expectedPrice: last,
    expectedReturn: expectedReturn,
    confidenceLow: lo,
    confidenceHigh: hi,
    confidenceText: "95% chance it lands between " + fmtPrice(lo) + " and " + fmtPrice(hi),
  };
}

// ── Model implementations ────────────────────────────────────────────────────

/**
 * Linear regression (reuses predictTrend from prediction.js).
 */
function runLinear(prices, horizon) {
  var r = predictTrend(prices, horizon);
  var stats = buildStats(r.forecast, r.lower95, r.upper95);
  stats.rSquared = r.rSquared;
  stats.slope = r.slope;
  stats.stdErr = r.stdErr;
  return {
    name: "linear",
    label: "Linear Trend",
    forecast: r.forecast,
    lower68: r.lower68,
    upper68: r.upper68,
    lower95: r.lower95,
    upper95: r.upper95,
    stats: stats,
    explain: "Draws a straight line through the price history and extends it forward — the simplest way to see the overall direction.",
  };
}

/**
 * Moving average projection: mean daily change over the last 20 bars.
 * Confidence bands grow with the square root of the horizon (random-walk
 * accumulation of daily noise).
 */
function runMovingAverage(prices, horizon) {
  var n = prices.length;
  var lookback = Math.min(20, n - 1);
  var changes = [];
  for (var i = n - lookback; i < n; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  var avgChange = mean(changes);
  var vol = stdDev(changes);
  var last = prices[n - 1];

  var forecast = [], lower68 = [], upper68 = [], lower95 = [], upper95 = [];
  for (var i = 0; i < horizon; i++) {
    var pred = last + avgChange * (i + 1);
    var margin = vol * Math.sqrt(i + 1);
    forecast.push(pred);
    lower68.push(pred - margin);
    upper68.push(pred + margin);
    lower95.push(pred - margin * 1.96);
    upper95.push(pred + margin * 1.96);
  }

  return {
    name: "movingAverage",
    label: "Moving Average",
    forecast: forecast,
    lower68: lower68,
    upper68: upper68,
    lower95: lower95,
    upper95: upper95,
    stats: buildStats(forecast, lower95, upper95),
    explain: "Averages the recent daily price changes and applies that average going forward, smoothing out daily noise.",
  };
}

/**
 * Holt's linear-trend exponential smoothing (alpha=0.3, beta=0.1).
 * Weights recent prices more heavily; residuals give the confidence bands.
 */
function runHolt(prices, horizon) {
  var alpha = 0.3, beta = 0.1;
  var n = prices.length;
  var level = prices[0];
  var trend = n > 1 ? prices[1] - prices[0] : 0;
  var residuals = [];

  for (var i = 1; i < n; i++) {
    var oneStep = level + trend;
    residuals.push(prices[i] - oneStep);
    var prevLevel = level;
    level = alpha * prices[i] + (1 - alpha) * oneStep;
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  var stdErr = stdDev(residuals);
  var forecast = [], lower68 = [], upper68 = [], lower95 = [], upper95 = [];
  for (var i = 0; i < horizon; i++) {
    var pred = level + trend * (i + 1);
    var margin = stdErr * Math.sqrt(i + 1);
    forecast.push(pred);
    lower68.push(pred - margin);
    upper68.push(pred + margin);
    lower95.push(pred - margin * 1.96);
    upper95.push(pred + margin * 1.96);
  }

  return {
    name: "holt",
    label: "Exponential",
    forecast: forecast,
    lower68: lower68,
    upper68: upper68,
    lower95: lower95,
    upper95: upper95,
    stats: buildStats(forecast, lower95, upper95),
    explain: "Weights recent prices more heavily than older ones, so it reacts faster to the latest trend.",
  };
}

/**
 * Monte Carlo: random walk with drift. Simulates 1,000 paths from the
 * historical mean log-return and volatility, then reports the median path
 * with 50% and 95% percentile bands.
 */
function runMonteCarlo(prices, horizon) {
  var n = prices.length;
  var lookback = Math.min(60, n - 1);
  var returns = [];
  for (var i = n - lookback; i < n; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  var drift = mean(returns);
  var vol = stdDev(returns);
  var last = prices[n - 1];
  var SIMS = 1000;

  var paths = [];
  for (var s = 0; s < SIMS; s++) {
    var path = [last];
    for (var t = 0; t < horizon; t++) {
      path.push(path[t] * Math.exp(drift + vol * gaussianRandom()));
    }
    paths.push(path);
  }

  var forecast = [], lower68 = [], upper68 = [], lower95 = [], upper95 = [];
  for (var t = 1; t <= horizon; t++) {
    var vals = paths.map(function (p) { return p[t]; });
    forecast.push(percentile(vals, 50));
    lower68.push(percentile(vals, 16));
    upper68.push(percentile(vals, 84));
    lower95.push(percentile(vals, 2.5));
    upper95.push(percentile(vals, 97.5));
  }

  return {
    name: "monteCarlo",
    label: "Monte Carlo",
    forecast: forecast,
    lower68: lower68,
    upper68: upper68,
    lower95: lower95,
    upper95: upper95,
    stats: buildStats(forecast, lower95, upper95),
    explain: "Runs 1,000 simulated futures based on the stock's past ups and downs, then shows the range of likely outcomes.",
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

var MODELS = {
  linear: { label: "Linear Trend", run: runLinear },
  movingAverage: { label: "Moving Average", run: runMovingAverage },
  holt: { label: "Exponential", run: runHolt },
  monteCarlo: { label: "Monte Carlo", run: runMonteCarlo },
};

/**
 * Get the display label for a model key.
 * @param {string} name
 * @returns {string}
 */
export function getModelLabel(name) {
  return MODELS[name] ? MODELS[name].label : name;
}

/**
 * Run a prediction model.
 * @param {string} name - Model key (linear, movingAverage, holt, monteCarlo)
 * @param {number[]} prices - Closing prices (oldest first)
 * @param {number} horizon - Number of bars to forecast
 * @returns {object} { name, label, forecast, lower68, upper68, lower95, upper95, stats, explain }
 */
export function runModel(name, prices, horizon) {
  var model = MODELS[name] || MODELS.linear;
  if (!prices || prices.length < 2) {
    var last = prices && prices.length ? prices[prices.length - 1] : 0;
    var fill = Array(horizon).fill(last);
    return {
      name: name,
      label: model.label,
      forecast: fill,
      lower68: fill, upper68: fill,
      lower95: fill, upper95: fill,
      stats: { expectedPrice: last, expectedReturn: 0, confidenceText: "Not enough price history to forecast." },
      explain: "Not enough price history to forecast.",
    };
  }
  return model.run(prices, horizon);
}
