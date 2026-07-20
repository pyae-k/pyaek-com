// Base-path detection (ported from pwa_duckdb/config.js).
//
// The same production build must work at any deploy path, including GitHub
// Pages subpaths like /<repo>/. index.html runs an inline script that computes
// the base and sets window.__APP_BASE__ (and injects a <base> tag) before the
// module loads. This module re-exports that value and offers helpers to build
// URLs that are absolute-relative-to-base (used for the DuckDB wasm/worker,
// which Vite does not rewrite because they live in public/duckdb/).

declare global {
  interface Window {
    __APP_BASE__?: string;
    __APP_BASE_OVERRIDE__?: string;
  }
}

function normalizeBase(b: string): string {
  if (!b) return "/";
  let s = b;
  if (!s.endsWith("/")) s += "/";
  if (!s.startsWith("/") && !/^[a-z]+:/i.test(s)) s = "/" + s;
  return s;
}

/** Resolve the app base path, preferring the value set by index.html's inline script. */
export function resolveBase(): string {
  if (typeof window === "undefined") return "/";
  const override = window.__APP_BASE_OVERRIDE__;
  if (override) return normalizeBase(override);
  if (window.__APP_BASE__) return normalizeBase(window.__APP_BASE__);
  const { location } = window;
  if (location.protocol === "file:") {
    return normalizeBase(location.href.replace(/[^/]*$/, ""));
  }
  const path = location.pathname;
  if (path && path !== "/") return normalizeBase(path.replace(/[^/]*$/, "") || "/");
  return "/";
}

/** Build a URL relative to the app base (leading slashes on `path` are stripped). */
export function assetUrl(path: string): string {
  const p = path.replace(/^\/+/, "");
  return resolveBase() + p;
}