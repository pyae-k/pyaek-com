// Auto-refresh polling, countdown timer, and freshness indicator
// Pattern follows the stocks app (dashboard.js:757-831)

import { loadRefreshInterval, saveRefreshInterval, loadRefreshPaused, saveRefreshPaused } from './store.js';

let refreshTimer = null;
let countdownTimer = null;
let freshnessTimer = null;
let secondsRemaining = 0;
let isPaused = false;
let currentInterval = 120;
let onRefreshCallback = null;
let stateRef = null;

// DOM refs (lazy)
let freshnessBadge, freshnessText, refreshCountdown, pauseBtn, refreshBtn;

function getEls() {
  if (!freshnessBadge) freshnessBadge = document.getElementById('freshnessBadge');
  if (!freshnessText) freshnessText = document.getElementById('freshnessText');
  if (!refreshCountdown) refreshCountdown = document.getElementById('refreshCountdown');
  if (!pauseBtn) pauseBtn = document.getElementById('pauseBtn');
  if (!refreshBtn) refreshBtn = document.getElementById('refreshBtn');
}

/**
 * Initialize refresh controls in the header.
 * @param {Object} state - App state object (mutated in place for lastFetchTime)
 * @param {Object} callbacks
 * @param {Function} callbacks.onRefresh - Called when auto-refresh fires
 * @param {Function} callbacks.onIntervalChange - Called when interval changes
 */
export function initRefreshControls(state, callbacks = {}) {
  stateRef = state;
  onRefreshCallback = callbacks.onRefresh || (() => {});

  getEls();

  // Load persisted settings
  currentInterval = loadRefreshInterval();
  isPaused = loadRefreshPaused();
  state.refreshInterval = currentInterval;
  state.refreshPaused = isPaused;

  // Show controls
  if (freshnessBadge) freshnessBadge.hidden = false;
  if (refreshCountdown) refreshCountdown.hidden = false;
  if (pauseBtn) pauseBtn.hidden = false;

  // Wire manual refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (onRefreshCallback) onRefreshCallback();
    });
  }

  // Wire pause/resume button
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (isPaused) {
        resumeRefresh();
      } else {
        pauseRefresh();
      }
    });
    updatePauseBtn();
  }

  // Start timers
  if (!isPaused && currentInterval > 0) {
    startTimers();
  }

  // Update freshness immediately if we have a lastFetchTime
  if (state.lastFetchTime) {
    updateFreshness(state.lastFetchTime);
  }
}

/**
 * Start the countdown and refresh timers.
 */
function startTimers() {
  stopTimers();
  if (isPaused || currentInterval <= 0) return;

  secondsRemaining = currentInterval;
  updateCountdown();

  // Countdown tick every 1s
  countdownTimer = setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining <= 0) {
      secondsRemaining = currentInterval;
      // Fire refresh
      if (onRefreshCallback) onRefreshCallback();
    }
    updateCountdown();
  }, 1000);
}

/**
 * Stop all timers.
 */
function stopTimers() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (freshnessTimer) { clearInterval(freshnessTimer); freshnessTimer = null; }
}

/**
 * Update the countdown display.
 */
function updateCountdown() {
  if (!refreshCountdown) return;
  if (isPaused) {
    refreshCountdown.textContent = 'paused';
    return;
  }
  if (secondsRemaining <= 0) {
    refreshCountdown.textContent = '';
    return;
  }
  const s = Math.ceil(secondsRemaining);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    refreshCountdown.textContent = `${m}m ${sec}s`;
  } else {
    refreshCountdown.textContent = `${s}s`;
  }
}

/**
 * Update the freshness indicator text.
 * @param {number} lastUpdated - Timestamp of last successful fetch
 */
export function updateFreshness(lastUpdated) {
  if (!freshnessBadge || !freshnessText) return;
  if (!lastUpdated) {
    freshnessText.textContent = 'never';
    return;
  }

  const elapsed = Date.now() - lastUpdated;
  const staleThreshold = (stateRef && stateRef.staleThreshold) || 120000;

  let text;
  if (elapsed < 5000) {
    text = 'just now';
  } else if (elapsed < 60000) {
    text = `${Math.floor(elapsed / 1000)}s ago`;
  } else if (elapsed < 3600000) {
    text = `${Math.floor(elapsed / 60000)}m ago`;
  } else {
    text = `${Math.floor(elapsed / 3600000)}h ago`;
  }

  freshnessText.textContent = text;

  // Toggle stale class
  if (elapsed > staleThreshold) {
    freshnessBadge.classList.add('stale');
  } else {
    freshnessBadge.classList.remove('stale');
  }
}

/**
 * Start the freshness update timer (runs every 10s).
 * Call this after a successful fetch.
 */
export function startFreshnessTimer() {
  if (freshnessTimer) clearInterval(freshnessTimer);
  freshnessTimer = setInterval(() => {
    if (stateRef && stateRef.lastFetchTime) {
      updateFreshness(stateRef.lastFetchTime);
    }
  }, 10000);
}

/**
 * Called after a successful fetch to reset the countdown and freshness.
 * @param {number} fetchTime - Timestamp of the fetch
 */
export function onFetchComplete(fetchTime) {
  if (stateRef) stateRef.lastFetchTime = fetchTime;
  updateFreshness(fetchTime);
  startFreshnessTimer();

  // Reset countdown
  if (!isPaused && currentInterval > 0) {
    secondsRemaining = currentInterval;
    updateCountdown();
  }
}

/**
 * Pause auto-refresh.
 */
export function pauseRefresh() {
  isPaused = true;
  stateRef.refreshPaused = true;
  saveRefreshPaused(true);
  stopTimers();
  updatePauseBtn();
  updateCountdown();
}

/**
 * Resume auto-refresh.
 */
export function resumeRefresh() {
  isPaused = false;
  stateRef.refreshPaused = false;
  saveRefreshPaused(false);
  updatePauseBtn();
  if (currentInterval > 0) {
    startTimers();
  }
}

/**
 * Toggle pause/resume.
 */
export function togglePause() {
  if (isPaused) {
    resumeRefresh();
  } else {
    pauseRefresh();
  }
}

/**
 * Get the current refresh interval in seconds.
 */
export function getRefreshInterval() {
  return currentInterval;
}

/**
 * Set a new refresh interval.
 * @param {number} seconds - 30, 60, 120, 300, or 0 (off)
 */
export function setRefreshInterval(seconds) {
  currentInterval = seconds;
  stateRef.refreshInterval = seconds;
  saveRefreshInterval(seconds);
  if (!isPaused && seconds > 0) {
    startTimers();
  } else {
    stopTimers();
  }
  updateCountdown();
}

/**
 * Update the pause button icon and aria-label.
 */
function updatePauseBtn() {
  if (!pauseBtn) return;
  if (isPaused) {
    pauseBtn.classList.add('paused');
    pauseBtn.setAttribute('aria-label', 'Resume auto-refresh');
    pauseBtn.setAttribute('title', 'Resume auto-refresh');
    pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`;
  } else {
    pauseBtn.classList.remove('paused');
    pauseBtn.setAttribute('aria-label', 'Pause auto-refresh');
    pauseBtn.setAttribute('title', 'Pause auto-refresh');
    pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>`;
  }
}

/**
 * Clean up all timers (call on page unload if needed).
 */
export function destroy() {
  stopTimers();
  refreshTimer = null;
  countdownTimer = null;
  freshnessTimer = null;
}
