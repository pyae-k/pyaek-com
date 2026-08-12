/**
 * Auto-complete symbol search module.
 * Provides debounced search with dropdown results, keyboard navigation,
 * and click-outside-to-close behavior.
 */

import { searchSymbols } from "./api.js";

/**
 * Initialize auto-complete symbol search on an input element.
 * @param {HTMLInputElement} inputEl - The text input element
 * @param {HTMLElement} dropdownEl - The dropdown container element
 * @param {function} onSelect - Callback when a symbol is selected, receives { symbol, name, exchange }
 * @param {object} [opts] - Options
 * @param {number} [opts.debounceMs=300] - Debounce delay in ms
 * @param {number} [opts.minChars=1] - Minimum characters before searching
 */
export function initSymbolSearch(inputEl, dropdownEl, onSelect, opts) {
  if (!inputEl || !dropdownEl) return;
  opts = opts || {};
  var debounceMs = opts.debounceMs || 300;
  var minChars = opts.minChars || 1;

  var debounceTimer = null;
  var activeIndex = -1;
  var currentResults = [];

  /**
   * Hide the dropdown and reset state.
   */
  function hideDropdown() {
    dropdownEl.innerHTML = "";
    dropdownEl.classList.remove("active");
    activeIndex = -1;
    currentResults = [];
  }

  /**
   * Show the dropdown with results.
   */
  function showDropdown() {
    dropdownEl.classList.add("active");
  }

  /**
   * Perform the search.
   */
  function doSearch(query) {
    if (!query || query.length < minChars) {
      hideDropdown();
      return;
    }

    searchSymbols(query).then(function (results) {
      currentResults = Array.isArray(results) ? results.slice(0, 10) : [];
      activeIndex = -1;

      if (currentResults.length === 0) {
        dropdownEl.innerHTML =
          '<div class="search-result-empty">No results found</div>';
        showDropdown();
        return;
      }

      dropdownEl.innerHTML = currentResults.map(function (item, i) {
        return '<div class="search-result-item" data-index="' + i + '" data-symbol="' + escapeHtml(item.symbol) + '">' +
          '<span class="search-result-symbol">' + escapeHtml(item.symbol) + '</span>' +
          '<span class="search-result-name">' + escapeHtml(item.name) + '</span>' +
          (item.exchange ? '<span class="search-result-exchange">' + escapeHtml(item.exchange) + '</span>' : '') +
        '</div>';
      }).join("");

      showDropdown();

      // Attach click handlers to result items
      dropdownEl.querySelectorAll(".search-result-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var idx = parseInt(el.dataset.index, 10);
          if (currentResults[idx]) {
            onSelect(currentResults[idx]);
            hideDropdown();
            inputEl.value = "";
          }
        });
      });
    }).catch(function () {
      hideDropdown();
    });
  }

  /**
   * Handle keyboard navigation.
   */
  function handleKeydown(e) {
    var items = dropdownEl.querySelectorAll(".search-result-item");

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (items.length === 0) return;
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActiveItem(items);
        break;

      case "ArrowUp":
        e.preventDefault();
        if (items.length === 0) return;
        activeIndex = Math.max(activeIndex - 1, -1);
        updateActiveItem(items);
        break;

      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < currentResults.length) {
          onSelect(currentResults[activeIndex]);
          hideDropdown();
          inputEl.value = "";
        }
        break;

      case "Escape":
        e.preventDefault();
        hideDropdown();
        inputEl.blur();
        break;
    }
  }

  /**
   * Update the active/highlighted item in the dropdown.
   */
  function updateActiveItem(items) {
    items.forEach(function (el, i) {
      el.classList.toggle("search-result-active", i === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  // Attach input handler with debounce
  inputEl.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    var query = inputEl.value.trim();
    if (!query || query.length < minChars) {
      hideDropdown();
      return;
    }
    debounceTimer = setTimeout(function () {
      doSearch(query);
    }, debounceMs);
  });

  // Attach keyboard handler
  inputEl.addEventListener("keydown", handleKeydown);

  // Click outside to close
  document.addEventListener("click", function (e) {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
      hideDropdown();
    }
  });

  // Cleanup on input blur (with delay for click selection)
  inputEl.addEventListener("blur", function () {
    setTimeout(hideDropdown, 200);
  });

  // Return a cleanup function
  return function destroy() {
    clearTimeout(debounceTimer);
    hideDropdown();
  };
}

/**
 * Simple HTML escaping.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, function (ch) { return map[ch]; });
}
