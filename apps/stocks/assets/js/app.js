/**
 * Stocks PWA — Bootstrap.
 * Single-page dashboard with 3-state theme, auto-refresh, and SW registration.
 */

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', function () {
  // Import and render dashboard
  import('./dashboard.js').then(function (m) {
    return m.renderDashboard(document.getElementById('app'));
  }).then(function () {
    // Theme toggle lives in the dashboard top bar, so init after render
    initThemeToggle();
  }).catch(function () {
    var app = document.getElementById('app');
    if (app) {
      app.innerHTML =
        '<div class="stocks-error" style="padding:var(--space-3xl) var(--space-md)">' +
          '<p class="stocks-error-msg">Failed to load dashboard</p>' +
          '<button class="stocks-retry-btn" onclick="window.location.reload()">Reload</button>' +
        '</div>';
    }
  });
});

// Service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
  });
}

// 3-state theme toggle (light → dark → system → light)
var themeInitDone = false;
function initThemeToggle() {
  var toggle = document.querySelector('.theme-toggle');
  if (!toggle || themeInitDone) return;
  themeInitDone = true;
  var icon = toggle.querySelector('.theme-toggle-icon');
  var html = document.documentElement;

  // Theme states
  var THEMES = ['light', 'dark', 'system'];
  var THEME_KEY = 'theme-preference';

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; }
    catch (e) { return 'light'; }
  }

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function resolveTheme(pref) {
    if (pref === 'system') return getSystemTheme();
    return pref;
  }

  function applyTheme(pref) {
    var resolved = resolveTheme(pref);
    html.setAttribute('data-theme', resolved);
    updateToggle(resolved, pref);
  }

  function updateToggle(resolved, pref) {
    if (!toggle || !icon) return;
    var label = '';
    if (pref === 'light') {
      label = 'Switch to dark mode';
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else if (pref === 'dark') {
      label = 'Switch to system mode';
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    } else {
      label = 'Switch to light mode';
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    }
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }

  // Initialize
  var stored = getStoredTheme();
  applyTheme(stored);

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    var current = getStoredTheme();
    if (current === 'system') {
      applyTheme('system');
    }
  });

  // Cycle on click: light → dark → system → light
  toggle.addEventListener('click', function () {
    var current = getStoredTheme();
    var nextIdx = (THEMES.indexOf(current) + 1) % THEMES.length;
    var next = THEMES[nextIdx];
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  });
}
