/**
 * Dashboard — single-page layout with all zones visible at once.
 * No tab switching. Left sidebar: watchlist. Center: stock detail.
 */

import { fetchQuotes, fetchMarketIndices, fetchMarketStatus, fetchSectors, fetchNews, fetchAllSymbols, clearCache, getLastUpdated } from "./api.js";
import { renderSparkline } from "./prediction.js";
import { initSymbolSearch } from "./search.js";
import { openCompareModal } from "./compare.js";

var WATCHLIST_KEY = "stocks-watchlist";
var DEFAULT_SYMBOLS = ["SPY", "AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"];
var SELECTED_SYMBOL_KEY = "stocks-selected";
var lastRefreshTime = Date.now();
var refreshInterval = 0;
var refreshTimer = null;
var refreshCountdownTimer = null;
var refreshPaused = false;

/**
 * Get the stored watchlist symbols from localStorage, or null when none.
 * @returns {string[]|null}
 */
function getStoredWatchlist() {
  try {
    var stored = localStorage.getItem(WATCHLIST_KEY);
    if (stored) {
      var parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {}
  return null;
}

/**
 * Get watchlist symbols from localStorage, falling back to the default set.
 * @returns {string[]}
 */
function getWatchlist() {
  return getStoredWatchlist() || DEFAULT_SYMBOLS;
}

/**
 * Save watchlist symbols to localStorage.
 * @param {string[]} symbols
 */
function saveWatchlist(symbols) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
}

/**
 * Get the currently selected symbol.
 * @returns {string|null}
 */
function getSelectedSymbol() {
  try {
    return localStorage.getItem(SELECTED_SYMBOL_KEY) || null;
  } catch (e) { return null; }
}

/**
 * Set the currently selected symbol.
 * @param {string|null} symbol
 */
function setSelectedSymbol(symbol) {
  if (symbol) {
    localStorage.setItem(SELECTED_SYMBOL_KEY, symbol);
  } else {
    localStorage.removeItem(SELECTED_SYMBOL_KEY);
  }
}

/**
 * Format a price number.
 */
function formatPrice(price) {
  if (price == null) return "--";
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a relative time string.
 */
function formatRelativeTime(timestamp) {
  var elapsed = Math.floor((Date.now() - timestamp) / 1000);
  if (elapsed < 5) return "just now";
  if (elapsed < 60) return elapsed + "s ago";
  if (elapsed < 3600) return Math.floor(elapsed / 60) + "m ago";
  return Math.floor(elapsed / 3600) + "h ago";
}

/**
 * Simple HTML escaping.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, function(ch) { return map[ch]; });
}

/**
 * Render the full single-page dashboard.
 * @param {HTMLElement} container
 */
export async function renderDashboard(container) {
  // Read refresh interval
  try {
    var stored = localStorage.getItem("stocks-refresh");
    if (stored != null) refreshInterval = parseInt(stored, 10) || 0;
  } catch (e) {}
  // Freshness reflects the pipeline data timestamp, not the client clock.
  getLastUpdated().then(function (ts) {
    if (ts) lastRefreshTime = new Date(ts).getTime();
    updateFreshness();
  });

  // Build the shell
  container.innerHTML = buildShell();

  // Start ticker tape
  loadTicker();

  // Resolve the initial watchlist. New users (no stored watchlist) default
  // to the full pipeline universe; the result is persisted so later loads are
  // instant. Falls back to DEFAULT_SYMBOLS if the data file is unavailable.
  var symbols = getStoredWatchlist();
  if (!symbols) {
    try {
      var all = await fetchAllSymbols();
      if (all && all.length) {
        symbols = all;
        saveWatchlist(all);
      }
    } catch (e) {}
  }
  if (!symbols) symbols = DEFAULT_SYMBOLS;

  var selectedSymbol = getSelectedSymbol();

  // Default to the first watchlist symbol (SPY for new users) when nothing
  // is selected or the stored selection is no longer in the watchlist.
  if (!selectedSymbol || symbols.indexOf(selectedSymbol) === -1) {
    selectedSymbol = symbols[0] || null;
  }

  // Load left sidebar (watchlist)
  loadWatchlist(symbols, selectedSymbol);

  // Load center zone (stock detail or market overview)
  if (selectedSymbol) {
    loadStockDetail(selectedSymbol);
  } else {
    renderMarketOverview();
  }

  // Load news for the selected symbol (falls back to market news)
  loadNews(selectedSymbol);

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Setup auto-refresh
  setupAutoRefresh();

  // Setup freshness indicator
  updateFreshness();
}

/**
 * Build the dashboard HTML shell.
 */
function buildShell() {
  return '' +
    // Top bar
    '<div class="stocks-topbar">' +
      '<div class="ticker-bar" id="tickerBar">' +
        '<div class="ticker-track" id="tickerTrack"></div>' +
      '</div>' +
      '<div class="stocks-topbar-controls">' +
        '<div class="doc-btn-group" aria-label="Documentation and contact">' +
          '<a class="doc-btn" href="/apps/stocks/readme/" title="README documentation" aria-label="README documentation">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' +
          '</a>' +
          '<a class="doc-btn" href="/apps/stocks/tech-doc/" title="Technical documentation" aria-label="Technical documentation">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
          '</a>' +
          '<a class="doc-btn" href="mailto:hello@pyaek.com" title="Contact hello@pyaek.com" aria-label="Contact hello@pyaek.com">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>' +
          '</a>' +
        '</div>' +
        '<span class="refresh-countdown" id="refreshCountdown" hidden></span>' +
        '<span class="freshness-badge" id="freshnessBadge">' +
          '<span class="dot"></span>' +
          '<span id="freshnessText">just now</span>' +
        '</span>' +
        '<button class="stocks-refresh-btn" id="pauseBtn" aria-label="Pause auto-refresh" title="Pause auto-refresh">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>' +
        '</button>' +
        '<button class="stocks-refresh-btn" id="refreshBtn" aria-label="Refresh data" title="Refresh data">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 4v6h6M23 20v-6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<button class="theme-toggle theme-toggle--3state" aria-label="Switch to dark mode" title="Switch to dark mode">' +
          '<svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +

    // 3-zone grid
    '<div class="stocks-grid">' +
      // Left sidebar
      '<div class="stocks-left" id="leftSidebar">' +
        '<div class="sidebar-widget">' +
          '<div class="sidebar-widget-title-row">' +
            '<div class="sidebar-widget-title">Watchlist</div>' +
          '</div>' +
          '<div class="search-container">' +
            '<div class="add-symbol">' +
              '<input type="text" class="add-symbol-input" id="addSymbolInput" placeholder="Search symbol" maxlength="10" autocomplete="off">' +
              '<button class="add-symbol-btn" id="addSymbolBtn">Add</button>' +
            '</div>' +
            '<div class="search-dropdown" id="searchDropdown"></div>' +
          '</div>' +
          '<div class="watchlist-scroll" id="watchlistContainer">' +
            '<div class="stocks-skeleton">' +
              '<div class="skeleton-line" style="width:100%;height:20px;margin-bottom:6px;"></div>' +
              '<div class="skeleton-line" style="width:100%;height:20px;margin-bottom:6px;"></div>' +
              '<div class="skeleton-line" style="width:100%;height:20px;margin-bottom:6px;"></div>' +
              '<div class="skeleton-line" style="width:100%;height:20px;margin-bottom:6px;"></div>' +
              '<div class="skeleton-line" style="width:100%;height:20px;"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Center
      '<div class="stocks-center" id="centerZone">' +
        '<div class="stocks-skeleton" id="centerSkeleton">' +
          '<div class="skeleton-line" style="width:60%;height:32px;margin-bottom:16px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
          '<div class="skeleton-line" style="width:100%;height:120px;margin-bottom:8px;"></div>' +
        '</div>' +
      '</div>' +

      // Right sidebar: latest news (per-symbol, falls back to market)
      '<div class="stocks-right" id="rightSidebar">' +
        '<div class="sidebar-widget">' +
          '<div class="sidebar-widget-title" id="newsWidgetTitle">Latest News</div>' +
          '<div class="news-list" id="newsList">' +
            '<div class="stocks-skeleton">' +
              '<div class="skeleton-line" style="width:100%;height:14px;margin-bottom:8px;"></div>' +
              '<div class="skeleton-line" style="width:90%;height:14px;margin-bottom:8px;"></div>' +
              '<div class="skeleton-line" style="width:100%;height:14px;margin-bottom:8px;"></div>' +
              '<div class="skeleton-line" style="width:85%;height:14px;"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>';
}

/**
 * Load ticker tape with market indices and market status.
 */
function loadTicker() {
  Promise.all([
    fetchMarketIndices(),
    fetchMarketStatus(),
  ]).then(function(results) {
    var indices = results[0];
    var marketStatus = results[1];
    var track = document.getElementById("tickerTrack");
    if (!track) return;

    // Market status badge
    var statusHtml = '';
    if (marketStatus) {
      var isOpen = marketStatus.isOpen;
      statusHtml = '<span class="ticker-label">Markets</span>' +
        '<span class="market-status ' + (isOpen ? 'open' : 'closed') + '">' +
          (isOpen ? 'Open' : 'Closed') +
        '</span>';
    }

    if (!indices || indices.length === 0) {
      track.innerHTML = statusHtml || '';
      return;
    }

    var items = indices.map(function(idx) {
      var isUp = (idx.changePercent || 0) >= 0;
      var cls = isUp ? "up" : "down";
      var sign = isUp ? "+" : "";
      return '<span class="ticker-item">' +
        '<span class="ticker-symbol">' + escapeHtml(idx.symbol.replace("^", "")) + '</span>' +
        '<span class="ticker-price">' + formatPrice(idx.price) + '</span>' +
        '<span class="ticker-change ' + cls + '">' + sign + (idx.changePercent || 0).toFixed(2) + '%</span>' +
      '</span>';
    }).join("");

    // Duplicate for seamless scroll
    track.innerHTML = statusHtml + items + items;
  }).catch(function() {});
}

/**
 * Load the watchlist into the left sidebar.
 */
function loadWatchlist(symbols, selectedSymbol) {
  var container = document.getElementById("watchlistContainer");
  if (!container) return;

  if (symbols.length === 0) {
    container.innerHTML =
      '<div class="stocks-empty" style="padding:var(--space-lg) var(--space-sm)">' +
        '<p style="font-size:var(--text-sm)">Add your first symbol</p>' +
      '</div>';
    return;
  }

  Promise.all([
    fetchQuotes(symbols),
    fetchSectors(symbols),
  ]).then(function(results) {
    var quotes = results[0];
    var sectorMap = results[1] || {};

    var quoteMap = {};
    (Array.isArray(quotes) ? quotes : []).forEach(function(q) {
      if (q && q.symbol) quoteMap[q.symbol.toUpperCase()] = q;
    });

    // Build sector filter bar
    var allSectors = {};
    symbols.forEach(function(sym) {
      var sector = sectorMap[sym] || 'Other';
      allSectors[sector] = (allSectors[sector] || 0) + 1;
    });
    var sectorList = Object.keys(allSectors).sort();
    var activeFilter = container._activeSector || 'All';

    var filterHtml = '<div class="sector-filter-bar">' +
      '<button class="sector-filter-btn' + (activeFilter === 'All' ? ' active' : '') + '" data-sector="All">All</button>' +
      sectorList.map(function(s) {
        return '<button class="sector-filter-btn' + (activeFilter === s ? ' active' : '') + '" data-sector="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
      }).join('') +
    '</div>';

    var rows = symbols.map(function(sym) {
      var q = quoteMap[sym];
      var isActive = sym === selectedSymbol;
      var activeClass = isActive ? ' active' : '';
      var sector = sectorMap[sym] || 'Other';
      var sectorClass = 'data-sector="' + escapeHtml(sector) + '"';
      var hidden = activeFilter !== 'All' && sector !== activeFilter;
      var hiddenClass = hidden ? ' filtered-out' : '';

      if (!q) {
        return '<tr class="watchlist-row' + activeClass + hiddenClass + '" ' + sectorClass + ' data-symbol="' + escapeHtml(sym) + '">' +
          '<td class="watchlist-actions"><button class="watchlist-remove" data-symbol="' + escapeHtml(sym) + '" aria-label="Remove ' + escapeHtml(sym) + '" title="Remove">&times;</button></td>' +
          '<td class="watchlist-sym">' + escapeHtml(sym) + '</td>' +
          '<td class="watchlist-price">--</td>' +
          '<td class="watchlist-change">--</td>' +
          '<td class="watchlist-sparkline"></td>' +
          '<td class="watchlist-actions"></td>' +
        '</tr>';
      }

      var changePct = q.changePercent != null ? q.changePercent : 0;
      var isUp = changePct >= 0;
      var changeClass = isUp ? "up" : "down";
      var sign = isUp ? "+" : "";
      var sparklinePrices = q.historicalPrices || q.sparkline || [];

      // Volatility alert for 5%+ daily swings
      var isVolatile = Math.abs(changePct) >= 5;
      var volatilityIcon = isVolatile
        ? '<span class="volatility-indicator" title="High volatility: ' + changePct.toFixed(2) + '%">' +
            '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/></svg>' +
          '</span>'
        : '';

      return '<tr class="watchlist-row' + activeClass + hiddenClass + (isVolatile ? ' volatile' : '') + '" ' + sectorClass + ' data-symbol="' + escapeHtml(sym) + '">' +
        '<td class="watchlist-actions"><button class="watchlist-remove" data-symbol="' + escapeHtml(sym) + '" aria-label="Remove ' + escapeHtml(sym) + '" title="Remove">&times;</button></td>' +
        '<td class="watchlist-sym">' + escapeHtml(sym) + volatilityIcon + '</td>' +
        '<td class="watchlist-price">' + formatPrice(q.price) + '</td>' +
        '<td class="watchlist-change ' + changeClass + '">' + sign + changePct.toFixed(2) + '%</td>' +
        '<td class="watchlist-sparkline">' + renderSparkline(sparklinePrices) + '</td>' +
        '<td class="watchlist-actions">' +
          '<button class="watchlist-compare" data-symbol="' + escapeHtml(sym) + '" aria-label="Compare ' + escapeHtml(sym) + '" title="Compare">' +
            '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join("");

    container.innerHTML =
      filterHtml +
      '<table class="watchlist-compact">' +
        '<thead><tr><th></th><th>Sym</th><th>Price</th><th>Chg%</th><th></th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    // Attach sector filter handlers
    container.querySelectorAll('.sector-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        container.querySelectorAll('.sector-filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var sector = btn.dataset.sector;
        container._activeSector = sector;
        container.querySelectorAll('.watchlist-row').forEach(function(row) {
          if (sector === 'All' || row.getAttribute('data-sector') === sector) {
            row.classList.remove('filtered-out');
          } else {
            row.classList.add('filtered-out');
          }
        });
      });
    });

    // Attach row click handlers
    container.querySelectorAll(".watchlist-row").forEach(function(row) {
      row.addEventListener("click", function(e) {
        if (e.target.closest(".watchlist-remove")) return;
        if (e.target.closest(".watchlist-compare")) return;
        var sym = row.dataset.symbol;
        if (sym) selectSymbol(sym);
      });
    });

    // Attach remove handlers
    container.querySelectorAll(".watchlist-remove").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var sym = btn.dataset.symbol;
        if (!sym) return;
        var current = getWatchlist().filter(function(s) { return s !== sym; });
        saveWatchlist(current);
        if (getSelectedSymbol() === sym) {
          setSelectedSymbol(null);
        }
        loadWatchlist(current, getSelectedSymbol());
        if (current.length > 0) {
          selectSymbol(current[0]);
        } else {
          renderMarketOverview();
        }
      });
    });

    // Attach compare handlers
    container.querySelectorAll(".watchlist-compare").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var sym = btn.dataset.symbol;
        if (sym) openCompareModal(sym);
      });
    });

  }).catch(function() {
    container.innerHTML =
      '<div class="stocks-error" style="padding:var(--space-md)">' +
        '<p class="stocks-error-msg" style="font-size:var(--text-sm)">Could not load watchlist</p>' +
        '<button class="stocks-retry-btn" style="font-size:var(--text-xs)">Retry</button>' +
      '</div>';
    container.querySelector(".stocks-retry-btn")?.addEventListener("click", function() {
      loadWatchlist(getWatchlist(), getSelectedSymbol());
    });
  });

  // Add symbol handler (manual entry fallback)
  var addBtn = document.getElementById("addSymbolBtn");
  var addInput = document.getElementById("addSymbolInput");
  var searchDropdown = document.getElementById("searchDropdown");

  function addSymbolToWatchlist(symbol) {
    var val = (symbol || "").toUpperCase().trim();
    if (!val) return;
    var current = getWatchlist();
    if (current.indexOf(val) !== -1) {
      if (addInput) addInput.value = "";
      return;
    }
    current.push(val);
    saveWatchlist(current);
    if (addInput) addInput.value = "";
    loadWatchlist(current, getSelectedSymbol());
    selectSymbol(val);
  }

  // Manual add button
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      if (addInput) addSymbolToWatchlist(addInput.value);
    });
  }

  // Auto-complete search
  if (addInput && searchDropdown) {
    initSymbolSearch(addInput, searchDropdown, function (result) {
      addSymbolToWatchlist(result.symbol);
    }, { debounceMs: 300, minChars: 1 });
  }
}

/**
 * Load the latest news into the left sidebar.
 * Shows per-symbol news for the selected symbol, falling back to market news
 * for symbols the pipeline does not cover.
 * @param {string} symbol
 */
function loadNews(symbol) {
  var list = document.getElementById("newsList");
  var title = document.getElementById("newsWidgetTitle");
  if (!list) return;

  fetchNews(symbol).then(function (items) {
    if (!list) return;
    var sym = (symbol || "").toUpperCase().trim();
    if (title) title.textContent = "Latest News" + (sym ? " · " + sym : "");

    if (!items || items.length === 0) {
      list.innerHTML =
        '<div class="stocks-empty" style="padding:var(--space-md) var(--space-sm)">' +
          '<p style="font-size:var(--text-xs)">No recent news</p>' +
        '</div>';
      return;
    }

    list.innerHTML = items.map(function (item) {
      var meta = [];
      if (item.source) meta.push(escapeHtml(item.source));
      if (item.publishedAt) {
        var ts = new Date(item.publishedAt).getTime();
        if (!isNaN(ts)) meta.push(formatRelativeTime(ts));
      }
      return '<div class="news-item">' +
        '<a class="news-title" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.title) + '</a>' +
        (meta.length ? '<div class="news-meta">' + meta.join(" · ") + '</div>' : '') +
      '</div>';
    }).join("");
  }).catch(function () {
    if (list) {
      list.innerHTML =
        '<div class="stocks-empty" style="padding:var(--space-md) var(--space-sm)">' +
          '<p style="font-size:var(--text-xs)">Could not load news</p>' +
        '</div>';
    }
  });
}

/**
 * Select a symbol and update the center zone.
 */
function selectSymbol(symbol) {
  setSelectedSymbol(symbol);
  // Update active row in watchlist
  var rows = document.querySelectorAll(".watchlist-row");
  rows.forEach(function(r) { r.classList.remove("active"); });
  var activeRow = document.querySelector('.watchlist-row[data-symbol="' + escapeHtml(symbol) + '"]');
  if (activeRow) activeRow.classList.add("active");

  loadStockDetail(symbol);
  loadNews(symbol);
}

/**
 * Load stock detail into the center zone.
 */
function loadStockDetail(symbol) {
  var center = document.getElementById("centerZone");
  if (!center) return;

  // Show skeleton
  center.innerHTML =
    '<div class="stocks-skeleton">' +
      '<div class="skeleton-line" style="width:200px;height:32px;margin-bottom:16px;"></div>' +
      '<div class="skeleton-line" style="width:150px;height:24px;margin-bottom:16px;"></div>' +
      '<div class="skeleton-line" style="width:100%;height:40px;margin-bottom:8px;"></div>' +
      '<div class="skeleton-line" style="width:100%;height:140px;margin-bottom:8px;"></div>' +
    '</div>';

  import("./detail.js").then(function(m) {
    m.renderStockDetail(center, symbol);
  }).catch(function() {
    center.innerHTML =
      '<div class="stocks-error">' +
        '<p class="stocks-error-msg">Could not load detail for ' + escapeHtml(symbol) + '</p>' +
        '<button class="stocks-retry-btn">Retry</button>' +
      '</div>';
    center.querySelector(".stocks-retry-btn")?.addEventListener("click", function() {
      loadStockDetail(symbol);
    });
  });
}

/**
 * Render market overview placeholder in center zone.
 */
function renderMarketOverview() {
  var center = document.getElementById("centerZone");
  if (!center) return;

  center.innerHTML =
    '<div class="market-overview">' +
      '<svg class="market-overview-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>' +
      '</svg>' +
      '<h3>Market Dashboard</h3>' +
      '<p>Select a symbol from the watchlist to view detailed data and predictions. Or add a new symbol to get started.</p>' +
    '</div>';
}

/**
 * Setup auto-refresh timer with countdown and pause/resume.
 */
function setupAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (refreshCountdownTimer) {
    clearInterval(refreshCountdownTimer);
    refreshCountdownTimer = null;
  }

  var countdownEl = document.getElementById("refreshCountdown");
  var pauseBtn = document.getElementById("pauseBtn");

  if (refreshInterval > 0 && !refreshPaused) {
    var secondsRemaining = refreshInterval;

    refreshTimer = setInterval(function () {
      refreshAll();
      secondsRemaining = refreshInterval;
    }, refreshInterval * 1000);

    // Countdown display
    if (countdownEl) {
      countdownEl.hidden = false;
      refreshCountdownTimer = setInterval(function () {
        secondsRemaining--;
        if (secondsRemaining <= 0) secondsRemaining = refreshInterval;
        if (countdownEl) {
          countdownEl.textContent = secondsRemaining + 's';
        }
      }, 1000);
    }
  } else {
    if (countdownEl) countdownEl.hidden = true;
  }

  // Pause/resume button
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      refreshPaused = !refreshPaused;
      if (refreshPaused) {
        pauseBtn.setAttribute("aria-label", "Resume auto-refresh");
        pauseBtn.setAttribute("title", "Resume auto-refresh");
        pauseBtn.classList.add("paused");
        if (countdownEl) countdownEl.hidden = true;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        if (refreshCountdownTimer) {
          clearInterval(refreshCountdownTimer);
          refreshCountdownTimer = null;
        }
      } else {
        pauseBtn.setAttribute("aria-label", "Pause auto-refresh");
        pauseBtn.setAttribute("title", "Pause auto-refresh");
        pauseBtn.classList.remove("paused");
        setupAutoRefresh(); // Restart
      }
    });
  }

  // Manual refresh button
  var refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      clearCache();
      refreshAll();
      // Reset countdown
      if (countdownEl && refreshInterval > 0) {
        countdownEl.textContent = refreshInterval + 's';
      }
    });
  }
}

/**
 * Refresh all data zones.
 */
function refreshAll() {
  // Freshness reflects the pipeline data timestamp, not the client clock.
  getLastUpdated().then(function (ts) {
    if (ts) lastRefreshTime = new Date(ts).getTime();
    updateFreshness();
  });

  var symbols = getWatchlist();
  var selectedSymbol = getSelectedSymbol();

  loadTicker();
  loadWatchlist(symbols, selectedSymbol);

  if (selectedSymbol && symbols.indexOf(selectedSymbol) !== -1) {
    loadStockDetail(selectedSymbol);
  }
}

/**
 * Update the freshness indicator.
 */
function updateFreshness() {
  var textEl = document.getElementById("freshnessText");
  var badge = document.getElementById("freshnessBadge");
  if (!textEl || !badge) return;

  textEl.textContent = formatRelativeTime(lastRefreshTime);
  var elapsed = Date.now() - lastRefreshTime;
  // Pipeline refreshes every 5 min during market hours; allow 10 min before
  // flagging data as stale.
  if (elapsed > 600000) {
    badge.classList.add("stale");
  } else {
    badge.classList.remove("stale");
  }

  // Update every 10 seconds
  setTimeout(updateFreshness, 10000);
}

/**
 * Keyboard shortcuts: j/k navigate watchlist, Enter select, r refresh,
 * c compare current symbol, s or / focus search, ? help overlay.
 */
function setupKeyboardShortcuts() {
  var kbIndex = 0;

  function visibleSymbols() {
    var symbols = [];
    document.querySelectorAll(".watchlist-row").forEach(function (row) {
      if (!row.classList.contains("filtered-out")) symbols.push(row.dataset.symbol);
    });
    return symbols;
  }

  function setKbCursor(row) {
    document.querySelectorAll(".watchlist-row.kb-highlight").forEach(function (r) {
      r.classList.remove("kb-highlight");
    });
    if (row) row.classList.add("kb-highlight");
  }

  function ensureKbVisible(row) {
    if (!row) return;
    var list = document.getElementById("watchlistContainer");
    if (!list) return;
    var rTop = row.offsetTop;
    var rBottom = rTop + row.offsetHeight;
    var lTop = list.scrollTop;
    var lBottom = lTop + list.clientHeight;
    if (rTop < lTop) list.scrollTop = rTop;
    else if (rBottom > lBottom) list.scrollTop = rBottom - list.clientHeight;
  }

  function isShortcutTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return true;
    return el.isContentEditable;
  }

  document.addEventListener("keydown", function (e) {
    // Never hijack keys while typing in a field or clicking a control
    if (isShortcutTarget(e.target) && e.key !== "Escape") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var symbols = visibleSymbols();

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      if (symbols.length === 0) return;
      kbIndex = (kbIndex + 1) % symbols.length;
      var rowJ = document.querySelector('.watchlist-row[data-symbol="' + escapeHtml(symbols[kbIndex]) + '"]');
      setKbCursor(rowJ);
      ensureKbVisible(rowJ);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      if (symbols.length === 0) return;
      kbIndex = (kbIndex - 1 + symbols.length) % symbols.length;
      var rowK = document.querySelector('.watchlist-row[data-symbol="' + escapeHtml(symbols[kbIndex]) + '"]');
      setKbCursor(rowK);
      ensureKbVisible(rowK);
    } else if (e.key === "Enter") {
      var cur = document.querySelector(".watchlist-row.kb-highlight");
      var sym = cur ? cur.dataset.symbol : (symbols[kbIndex] || symbols[0]);
      if (sym) selectSymbol(sym);
    } else if (e.key.toLowerCase() === "r") {
      var refreshBtn = document.getElementById("refreshBtn");
      if (refreshBtn) refreshBtn.click();
    } else if (e.key.toLowerCase() === "c") {
      var curRow = document.querySelector(".watchlist-row.kb-highlight") || document.querySelector(".watchlist-row.active");
      var csym = curRow ? curRow.dataset.symbol : getSelectedSymbol();
      if (csym) openCompareModal(csym);
    } else if (e.key === "s" || e.key === "/") {
      e.preventDefault();
      var input = document.getElementById("addSymbolInput");
      if (input) input.focus();
    } else if (e.key === "?") {
      e.preventDefault();
      toggleHelpOverlay();
    } else if (e.key === "Escape") {
      closeHelpOverlay();
    }
  });
}

/**
 * Toggle the keyboard-shortcuts help overlay.
 */
function toggleHelpOverlay() {
  var existing = document.getElementById("kbHelpOverlay");
  if (existing) {
    closeHelpOverlay();
    return;
  }
  var overlay = document.createElement("div");
  overlay.id = "kbHelpOverlay";
  overlay.className = "kb-help-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Keyboard shortcuts");
  overlay.innerHTML =
    '<div class="kb-help-box">' +
      '<h2 class="kb-help-title">Keyboard shortcuts</h2>' +
      '<ul class="kb-help-list">' +
        '<li><kbd>j</kbd> <span class="kb-help-key-arrow">/</span> <kbd>k</kbd> Move watchlist selection</li>' +
        '<li><kbd>Enter</kbd> Open selected symbol</li>' +
        '<li><kbd>r</kbd> Refresh data</li>' +
        '<li><kbd>c</kbd> Compare current symbol</li>' +
        '<li><kbd>s</kbd> or <kbd>/</kbd> Focus search</li>' +
        '<li><kbd>?</kbd> Show this help</li>' +
        '<li><kbd>Esc</kbd> Close / blur</li>' +
      '</ul>' +
      '<button class="add-symbol-btn" id="kbHelpClose">Close</button>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeHelpOverlay();
  });
  var closeBtn = overlay.querySelector("#kbHelpClose");
  if (closeBtn) closeBtn.addEventListener("click", closeHelpOverlay);
  if (closeBtn) closeBtn.focus();
}

/**
 * Close the keyboard-shortcuts help overlay.
 */
function closeHelpOverlay() {
  var overlay = document.getElementById("kbHelpOverlay");
  if (overlay) overlay.remove();
}
