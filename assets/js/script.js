(function() {
  // Service worker registration
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function() {
      navigator.serviceWorker.register("/sw.js").catch(function() {});
    });
  }

  // Theme toggle
  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    var icon = toggle.querySelector(".theme-toggle-icon");
    var html = document.documentElement;

    function updateToggle(theme) {
      var isDark = theme === "dark";
      toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      if (icon) {
        if (isDark) {
          // Sun icon for dark mode (switch to light)
          icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
        } else {
          // Moon icon for light mode (switch to dark)
          icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
        }
      }
    }

    updateToggle(html.getAttribute("data-theme") || "light");

    toggle.addEventListener("click", function() {
      var current = html.getAttribute("data-theme") || "light";
      var next = current === "dark" ? "light" : "dark";
      html.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      updateToggle(next);
    });
  }
})();

// Overflow guard: scale main content to fit viewport when it overflows
(function() {
  var main = document.querySelector("main");
  var footer = document.querySelector("footer");
  if (!main) return;

  function fitContent() {
    // Reset transforms first
    main.style.transform = "";
    main.style.transformOrigin = "";
    main.style.flex = "";
    main.style.height = "";
    main.style.marginBottom = "";

    // Force layout reflow
    void main.offsetHeight;

    var vh = window.innerHeight;
    var footerHeight = footer ? footer.offsetHeight : 0;
    var mainHeight = main.scrollHeight;
    var totalHeight = mainHeight + footerHeight;

    // Only scale if content overflows (with 2px tolerance)
    if (totalHeight > vh + 2) {
      var availableHeight = vh - footerHeight;
      var scale = availableHeight / mainHeight;
      // Clamp scale to prevent extreme values
      scale = Math.max(0.25, Math.min(1, scale));

      main.style.transform = "scale(" + scale + ")";
      main.style.transformOrigin = "top center";
      main.style.flex = "0 0 auto";
      // Keep the original layout height so the scaled visual height equals the
      // available space, then pull the footer up to remove the blank band.
      main.style.height = mainHeight + "px";
      main.style.marginBottom = "-" + (mainHeight * (1 - scale)) + "px";
    }
  }

  // Use ResizeObserver for efficient resize detection
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function() {
      fitContent();
    });
    ro.observe(document.body);
  }

  // Also run on load and orientation change
  window.addEventListener("load", fitContent);
  window.addEventListener("orientationchange", function() {
    setTimeout(fitContent, 100);
  });

  // Run once immediately in case DOM is already ready
  if (document.readyState === "complete") {
    fitContent();
  } else {
    document.addEventListener("DOMContentLoaded", fitContent);
  }
})();
