/**
 * Technical indicators module — client-side calculation.
 * No external dependencies. All calculations are done in-browser.
 * Provides EMA, SMA, RSI, Bollinger Bands, and MACD.
 */

/**
 * Calculate Simple Moving Average.
 * @param {number[]} prices - Array of prices (oldest first)
 * @param {number} period - Lookback period
 * @returns {number[]} Array of SMA values (same length as prices, NaN for first period-1)
 */
export function calculateSMA(prices, period) {
  if (!prices || prices.length < period) return prices.map(function () { return NaN; });
  var result = [];
  for (var i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) {
        sum += prices[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate Exponential Moving Average.
 * @param {number[]} prices - Array of prices (oldest first)
 * @param {number} period - Lookback period
 * @returns {number[]} Array of EMA values (same length as prices, NaN for first period-1)
 */
export function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices.map(function () { return NaN; });
  var result = [];
  var multiplier = 2 / (period + 1);

  // Start with SMA for the first period
  var sum = 0;
  for (var i = 0; i < period; i++) {
    sum += prices[i];
    result.push(NaN);
  }
  result[period - 1] = sum / period;

  // Calculate EMA for remaining values
  for (var i = period; i < prices.length; i++) {
    result.push((prices[i] - result[i - 1]) * multiplier + result[i - 1]);
  }
  return result;
}

/**
 * Calculate Relative Strength Index.
 * @param {number[]} prices - Array of prices (oldest first)
 * @param {number} [period=14] - Lookback period
 * @returns {number[]} Array of RSI values (0-100, NaN for first period)
 */
export function calculateRSI(prices, period) {
  if (period === undefined) period = 14;
  if (!prices || prices.length < period + 1) return prices.map(function () { return NaN; });

  var result = [];
  // First period values are NaN
  for (var i = 0; i < period; i++) {
    result.push(NaN);
  }

  // Calculate initial average gain/loss
  var avgGain = 0;
  var avgLoss = 0;
  for (var i = 1; i <= period; i++) {
    var diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      avgGain += diff;
    } else {
      avgLoss += Math.abs(diff);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // Calculate remaining RSI values using smoothed method
  for (var i = period + 1; i < prices.length; i++) {
    var diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
    var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

/**
 * Calculate Bollinger Bands.
 * @param {number[]} prices - Array of prices (oldest first)
 * @param {number} [period=20] - Lookback period
 * @param {number} [stdDev=2] - Number of standard deviations
 * @returns {{ middle: number[], upper: number[], lower: number[] }}
 */
export function calculateBollingerBands(prices, period, stdDev) {
  if (period === undefined) period = 20;
  if (stdDev === undefined) stdDev = 2;
  if (!prices || prices.length < period) {
    return {
      middle: prices.map(function () { return NaN; }),
      upper: prices.map(function () { return NaN; }),
      lower: prices.map(function () { return NaN; }),
    };
  }

  var middle = calculateSMA(prices, period);
  var upper = [];
  var lower = [];

  for (var i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      // Calculate standard deviation over the period
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) {
        sum += prices[j];
      }
      var mean = sum / period;
      var sqDiff = 0;
      for (var j = i - period + 1; j <= i; j++) {
        sqDiff += (prices[j] - mean) * (prices[j] - mean);
      }
      var std = Math.sqrt(sqDiff / period);
      upper.push(middle[i] + stdDev * std);
      lower.push(middle[i] - stdDev * std);
    }
  }

  return { middle: middle, upper: upper, lower: lower };
}

/**
 * Calculate MACD (Moving Average Convergence Divergence).
 * @param {number[]} prices - Array of prices (oldest first)
 * @param {number} [fastPeriod=12] - Fast EMA period
 * @param {number} [slowPeriod=26] - Slow EMA period
 * @param {number} [signalPeriod=9] - Signal line period
 * @returns {{ macd: number[], signal: number[], histogram: number[] }}
 */
export function calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod) {
  if (fastPeriod === undefined) fastPeriod = 12;
  if (slowPeriod === undefined) slowPeriod = 26;
  if (signalPeriod === undefined) signalPeriod = 9;
  if (!prices || prices.length < slowPeriod) {
    return {
      macd: prices.map(function () { return NaN; }),
      signal: prices.map(function () { return NaN; }),
      histogram: prices.map(function () { return NaN; }),
    };
  }

  var fastEMA = calculateEMA(prices, fastPeriod);
  var slowEMA = calculateEMA(prices, slowPeriod);

  // MACD line = fast EMA - slow EMA
  var macd = [];
  for (var i = 0; i < prices.length; i++) {
    if (i < slowPeriod - 1 || isNaN(fastEMA[i]) || isNaN(slowEMA[i])) {
      macd.push(NaN);
    } else {
      macd.push(fastEMA[i] - slowEMA[i]);
    }
  }

  // Signal line = 9-period EMA of MACD
  var signal = calculateEMA(macd.filter(function (v) { return !isNaN(v); }), signalPeriod);
  var signalPadded = macd.map(function (v) { return NaN; });
  var signalIdx = 0;
  for (var i = 0; i < macd.length; i++) {
    if (!isNaN(macd[i])) {
      if (signalIdx < signal.length) {
        signalPadded[i] = signal[signalIdx];
        signalIdx++;
      }
    }
  }

  // Histogram = MACD - Signal
  var histogram = [];
  for (var i = 0; i < macd.length; i++) {
    if (isNaN(macd[i]) || isNaN(signalPadded[i])) {
      histogram.push(NaN);
    } else {
      histogram.push(macd[i] - signalPadded[i]);
    }
  }

  return { macd: macd, signal: signalPadded, histogram: histogram };
}
