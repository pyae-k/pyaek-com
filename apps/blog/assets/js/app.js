(function () {
  "use strict";

  /* ==========================================================================
     Blog Post Data — loaded from posts.json
     ========================================================================== */

  var posts = [];

  async function loadPosts() {
    try {
      var resp = await fetch("posts/posts.json");
      posts = await resp.json();
      // Sort by date descending
      posts.sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });
      renderPosts();
      // Offline deep link: SW serves index.html for a post URL — show it
      handleRoute();
    } catch (err) {
      console.error("Failed to load posts:", err);
      document.getElementById("blogGrid").innerHTML =
        '<p class="empty-state">Unable to load blog posts. Please try again later.</p>';
      if (pagination) pagination.style.display = "none";
    }
  }

  /* ==========================================================================
     State
     ========================================================================== */

  var selectedPostId = null;
  // Fixed page size: 12 posts per page at every breakpoint. The grid uses a
  // fixed row count (grid-template-rows) so each page of 12 fits without
  // scrolling and cards keep a constant size even when a page has fewer posts;
  // pagination handles the rest.
  var postsPerPage = 12;
  var currentPage = 1;
  var totalPages = 1;

  /* ==========================================================================
     DOM Refs
     ========================================================================== */

  var blogGrid = document.getElementById("blogGrid");
  var pagination = document.getElementById("pagination");

  /* ==========================================================================
     Helpers
     ========================================================================== */

  function formatDate(isoDate) {
    var d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // Real post URL: /yyyy/mm/slug/ derived from the post's date
  function postUrl(post) {
    return post.date.slice(0, 7).replace("-", "/") + "/" + post.id + "/";
  }

  // Scroll the fixed-screen content area back to the top — the page itself
  // never scrolls, main is the scroll container
  function scrollMainToTop() {
    var main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Reflect the current page in the URL (?page=), preserving ?filter= and ?q=
  function updatePageParam(page) {
    var params = new URLSearchParams(location.search);
    if (page > 1) {
      params.set("page", page);
    } else {
      params.delete("page");
    }
    var qs = params.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  /* ==========================================================================
     SVG Icons per category
     ========================================================================== */

  function getCategoryIcon(category) {
    if (category === "tech") {
      // Code/terminal icon
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
    }
    // Finance — chart/bar icon
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>';
  }

  /* ==========================================================================
     Create Blog Card
     ========================================================================== */

  function createCard(post) {
    var article = document.createElement("article");
    article.className = "blog-card";
    article.dataset.category = post.category;
    article.id = "post-" + post.id;

    // Icon
    var iconDiv = document.createElement("div");
    iconDiv.className = "blog-card-icon";
    iconDiv.setAttribute("aria-hidden", "true");
    iconDiv.innerHTML = getCategoryIcon(post.category);

    // Title
    var titleEl = document.createElement("h2");
    titleEl.className = "blog-card-title";
    var link = document.createElement("a");
    link.className = "blog-card-link";
    // Real URL — cards open the static post page in a new tab
    link.href = postUrl(post);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = post.title;
    titleEl.appendChild(link);

    // Excerpt
    var excerpt = document.createElement("p");
    excerpt.className = "blog-card-excerpt";
    excerpt.textContent = post.excerpt;

    // Meta line: category badge · date · read time
    var meta = document.createElement("div");
    meta.className = "blog-card-meta";
    meta.innerHTML =
      '<span class="blog-card-category" data-category="' +
      post.category +
      '">' +
      post.category +
      '</span><span class="blog-card-date">' +
      formatDate(post.date) +
      '</span><span class="blog-card-readtime">' +
      post.readTime +
      "</span>";

    article.appendChild(iconDiv);
    article.appendChild(titleEl);
    article.appendChild(excerpt);
    article.appendChild(meta);

    // The whole card is a click target: the anchor opens a new tab itself,
    // any other part of the card (icon, excerpt, meta) opens the same page
    article.addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      var a = document.createElement("a");
      a.href = postUrl(post);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    return article;
  }

  /* ==========================================================================
     Render Posts (paginated)
     ========================================================================== */

  function getFilteredPosts() {
    return posts.filter(function (post) {
      var matchesFilter = activeFilter === "all" || post.category === activeFilter;
      if (!matchesFilter) return false;
      if (!searchQuery) return true;
      var text = (post.title + " " + post.excerpt).toLowerCase();
      return text.indexOf(searchQuery) !== -1;
    });
  }

  function renderPosts() {
    if (posts.length === 0) {
      blogGrid.innerHTML = '<div class="empty-state">No posts yet.</div>';
      renderPagination(1);
      return;
    }

    var filtered = getFilteredPosts();
    totalPages = Math.max(1, Math.ceil(filtered.length / postsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var start = (currentPage - 1) * postsPerPage;
    var pagePosts = filtered.slice(start, start + postsPerPage);

    blogGrid.innerHTML = "";

    if (pagePosts.length === 0) {
      blogGrid.innerHTML =
        '<div class="empty-state">' +
        (searchQuery
          ? 'No posts found matching "' + searchQuery + '".'
          : "No posts in this category yet.") +
        "</div>";
    } else {
      pagePosts.forEach(function (post) {
        blogGrid.appendChild(createCard(post));
      });
    }

    renderPagination(totalPages);
  }

  /* ==========================================================================
     Pagination UI
     ========================================================================== */

  // Page numbers: show all when few pages, else windowed (first/last, current ± 1, ellipsis)
  function getPageItems(totalPages, current) {
    if (totalPages <= 7) {
      var all = [];
      for (var i = 1; i <= totalPages; i++) all.push(i);
      return all;
    }
    var items = [];
    var range = 1;
    for (var i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= current - range && i <= current + range)) {
        items.push(i);
      } else if (items[items.length - 1] !== "ellipsis") {
        items.push("ellipsis");
      }
    }
    return items;
  }

  function createPageButton(label, page, disabled, ariaLabel, isActive) {
    var btn = document.createElement("button");
    btn.className = "page-btn" + (isActive ? " active" : "");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    if (isActive) btn.setAttribute("aria-current", "page");
    if (disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", function () {
        currentPage = page;
        renderPosts();
        updatePageParam(page);
        scrollMainToTop();
      });
    }
    return btn;
  }

  function renderPagination(totalPages) {
    if (!pagination) return;
    pagination.innerHTML = "";

    if (totalPages <= 1) {
      pagination.style.display = "none";
      return;
    }
    pagination.style.display = "flex";

    // Previous
    pagination.appendChild(
      createPageButton("‹", currentPage - 1, currentPage === 1, "Previous page")
    );

    // Page numbers
    getPageItems(totalPages, currentPage).forEach(function (item) {
      if (item === "ellipsis") {
        var span = document.createElement("span");
        span.className = "page-ellipsis";
        span.textContent = "…";
        span.setAttribute("aria-hidden", "true");
        pagination.appendChild(span);
      } else {
        pagination.appendChild(
          createPageButton(String(item), item, false, "Page " + item, item === currentPage)
        );
      }
    });

    // Next
    pagination.appendChild(
      createPageButton("›", currentPage + 1, currentPage === totalPages, "Next page")
    );
  }

  /* ==========================================================================
     Filter & Search
     ========================================================================== */

  var activeFilter = "all";
  var searchQuery = "";
  var searchTimer = null;

  function filterPosts() {
    // Reset to page 1 and re-render the paginated, filtered set
    currentPage = 1;
    renderPosts();
    // Drop any stale ?page= so the URL matches the reset view
    updatePageParam(1);
  }

  function initFilters() {
    var filterBtns = document.querySelectorAll(".header-filter-btn");
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        filterBtns.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        activeFilter = btn.dataset.filter;
        filterPosts();
        // Reflect the filter in the URL, preserving any active search query
        var params = new URLSearchParams(location.search);
        if (activeFilter === "all") {
          params.delete("filter");
        } else {
          params.set("filter", activeFilter);
        }
        var qs = params.toString();
        history.replaceState(null, "", qs ? "?" + qs : location.pathname);
      });
    });
  }

  function initSearch() {
    var input = document.getElementById("searchInput");
    if (!input) return;
    input.addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        searchQuery = input.value.trim().toLowerCase();
        filterPosts();
        // Reflect the query in the URL so ?q= deep links stay meaningful,
        // preserving any active ?filter= param
        var params = new URLSearchParams(location.search);
        if (searchQuery) {
          params.set("q", input.value.trim());
        } else {
          params.delete("q");
        }
        var qs = params.toString();
        history.replaceState(null, "", qs ? "?" + qs : location.pathname);
      }, 200);
    });
  }

  /* ==========================================================================
     Post Detail View
     ========================================================================== */

  // Show a post inline — used only for offline deep links, where the SW serves
  // index.html for a post URL. Online clicks navigate to the static post page.
  function showPostDetail(postId) {
    selectedPostId = postId;
    var post = posts.find(function (p) {
      return p.id === postId;
    });
    if (!post) return;

    // Keep exactly one h1 on the page: hide the index heading in detail view
    var indexH1 = document.querySelector(".blog-index-h1");
    if (indexH1) indexH1.hidden = true;

    // Hide grid and pagination, show detail
    blogGrid.style.display = "none";
    if (pagination) pagination.style.display = "none";

    // Remove existing detail if any
    var existing = document.getElementById("postDetail");
    if (existing) existing.remove();

    var detail = document.createElement("div");
    detail.className = "post-detail";
    detail.id = "postDetail";

    detail.innerHTML =
      '<div class="post-detail-header">' +
      '<h1 class="post-detail-title">' +
      escapeHtml(post.title) +
      "</h1>" +
      '<div class="post-detail-meta">' +
      '<span class="blog-card-category" data-category="' +
      post.category +
      '">' +
      post.category +
      "</span>" +
      "<span>" +
      formatDate(post.date) +
      "</span>" +
      "<span>" +
      post.readTime +
      "</span>" +
      '<span>By <a class="post-detail-author" href="/apps/about/">' +
      escapeHtml(post.author) +
      "</a></span>" +
      "</div>" +
      "</div>" +
      '<div class="post-detail-body">' +
      post.content +
      "</div>";

    blogGrid.parentNode.insertBefore(detail, blogGrid.nextSibling);

    // Scroll to top of detail
    detail.scrollIntoView({ behavior: "smooth" });
  }

  function hidePostDetail() {
    selectedPostId = null;
    var detail = document.getElementById("postDetail");
    if (detail) detail.remove();
    // Restore the index h1 when returning to the grid
    var indexH1 = document.querySelector(".blog-index-h1");
    if (indexH1) indexH1.hidden = false;
    blogGrid.style.display = "grid";
    if (pagination) pagination.style.display = totalPages > 1 ? "flex" : "none";
    document.title = "Blog — Pyaek";
    scrollMainToTop();
  }

  // Route on popstate / initial load: show the post when the URL is a post URL
  function handleRoute() {
    var m = location.pathname.match(/\/\d{4}\/\d{2}\/([^/]+)\/$/);
    if (m && posts.length) {
      var post = posts.find(function (p) {
        return p.id === m[1];
      });
      if (post) {
        showPostDetail(post.id);
        document.title = post.title + " — Pyaek";
        return;
      }
    }
    hidePostDetail();
  }

  // Minimal HTML escaping for user-facing text
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ==========================================================================
     Theme Toggle
     ========================================================================== */

  function initTheme() {
    var toggle = document.querySelector(".theme-toggle");
    if (!toggle) return;
    var icon = toggle.querySelector(".theme-toggle-icon");
    var html = document.documentElement;

    function updateToggle(theme) {
      var isDark = theme === "dark";
      toggle.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
      if (icon) {
        icon.innerHTML = isDark
          ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
          : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      }
    }

    updateToggle(html.getAttribute("data-theme") || "light");

    toggle.addEventListener("click", function () {
      var current = html.getAttribute("data-theme") || "light";
      var next = current === "dark" ? "light" : "dark";
      html.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      updateToggle(next);
    });
  }

  /* ==========================================================================
     Init
     ========================================================================== */

  function init() {
    initTheme();
    initFilters();
    initSearch();
    // Prefill search from ?q= URL param (SearchAction target)
    var q = new URLSearchParams(location.search).get("q");
    if (q) {
      var searchInput = document.getElementById("searchInput");
      if (searchInput) searchInput.value = q;
      searchQuery = q.trim().toLowerCase();
    }
    // Apply ?filter= URL param (deep link from static page header)
    var filter = new URLSearchParams(location.search).get("filter");
    if (filter === "finance" || filter === "tech") {
      activeFilter = filter;
      document.querySelectorAll(".header-filter-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.filter === filter);
      });
    }
    // Apply ?page= URL param (deep link to a specific page); renderPosts()
    // clamps out-of-range values once posts load
    var pageParam = parseInt(new URLSearchParams(location.search).get("page"), 10);
    if (pageParam > 1) currentPage = pageParam;
    // Show loading state while posts load
    document.getElementById("blogGrid").innerHTML =
      '<div class="empty-state" aria-label="Loading posts">Loading posts...</div>';
    loadPosts();

    // Browser back/forward between grid and post detail
    window.addEventListener("popstate", handleRoute);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
