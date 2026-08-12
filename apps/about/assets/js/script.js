(function() {
  /* ==========================================================================
     Theme Toggle
     ========================================================================== */

  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    var icon = toggle.querySelector(".theme-toggle-icon");
    var html = document.documentElement;

    function updateToggle(theme) {
      var isDark = theme === "dark";
      toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      if (icon) {
        if (isDark) {
          icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
        } else {
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

  /* ==========================================================================
     Sticky Navigation — Active Section Highlighting
     ========================================================================== */

  var nav = document.querySelector(".sticky-nav");
  if (nav) {
    var navLinks = nav.querySelectorAll(".sticky-nav__link");
    var sections = [];

    // Collect all sections referenced by nav links
    navLinks.forEach(function(link) {
      var href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        var section = document.querySelector(href);
        if (section) {
          sections.push({ id: href, el: section, link: link });
        }
      }
    });

    if (sections.length > 0) {
      // IntersectionObserver for active section
      var observerOptions = {
        root: null,
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0
      };

      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            var activeId = "#" + entry.target.id;
            navLinks.forEach(function(link) {
              var isActive = link.getAttribute("href") === activeId;
              if (isActive) {
                link.classList.add("sticky-nav__link--active");
              } else {
                link.classList.remove("sticky-nav__link--active");
              }
            });
          }
        });
      }, observerOptions);

      sections.forEach(function(s) {
        observer.observe(s.el);
      });

      // Smooth scroll for nav links
      navLinks.forEach(function(link) {
        link.addEventListener("click", function(e) {
          var href = this.getAttribute("href");
          if (href && href.startsWith("#")) {
            e.preventDefault();
            var target = document.querySelector(href);
            if (target) {
              target.scrollIntoView({ behavior: "smooth" });
            }
          }
        });
      });
    }

    // Add shadow on scroll
    var scrollObserver = new IntersectionObserver(
      function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            nav.classList.remove("sticky-nav--scrolled");
          } else {
            nav.classList.add("sticky-nav--scrolled");
          }
        });
      },
      { threshold: 1 }
    );

    // Observe the nav's position relative to viewport top
    // Use a sentinel element just above the nav
    var sentinel = document.createElement("div");
    sentinel.style.position = "absolute";
    sentinel.style.top = "0";
    sentinel.style.height = "1px";
    sentinel.style.width = "1px";
    sentinel.style.pointerEvents = "none";
    sentinel.setAttribute("aria-hidden", "true");
    nav.parentNode.insertBefore(sentinel, nav);
    scrollObserver.observe(sentinel);
  }

  /* ==========================================================================
     Scroll Reveal Animations
     ========================================================================== */

  var revealElements = document.querySelectorAll(".reveal, .reveal-stagger");

  if (revealElements.length > 0) {
    var revealObserver = new IntersectionObserver(
      function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            if (entry.target.classList.contains("reveal-stagger")) {
              entry.target.classList.add("reveal-stagger--visible");
            } else {
              entry.target.classList.add("reveal--visible");
            }
            // Once revealed, stop observing
            revealObserver.unobserve(entry.target);
          }
        });
      },
      {
        root: null,
        rootMargin: "0px 0px -40px 0px",
        threshold: 0.1
      }
    );

    revealElements.forEach(function(el) {
      revealObserver.observe(el);
    });
  }
})();
