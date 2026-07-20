import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBase, assetUrl } from "./basePath";

describe("basePath", () => {
  const origWindow = (globalThis as { window?: Window }).window;

  beforeEach(() => {
    // node env has no window by default
    (globalThis as { window?: Window }).window = undefined as unknown as Window;
  });

  afterEach(() => {
    (globalThis as { window?: Window }).window = origWindow;
  });

  it("returns '/' when window is undefined (SSR/node)", () => {
    expect(resolveBase()).toBe("/");
  });

  it("builds asset URLs relative to base when no window", () => {
    expect(assetUrl("/duckdb/duckdb-eh.wasm")).toBe("/duckdb/duckdb-eh.wasm");
    expect(assetUrl("duckdb/x.js")).toBe("/duckdb/x.js");
  });

  it("honors window.__APP_BASE__ when set", () => {
    (globalThis as { window: Window & typeof globalThis }).window =
      { __APP_BASE__: "/my-repo/" } as unknown as Window & typeof globalThis;
    expect(resolveBase()).toBe("/my-repo/");
    expect(assetUrl("/duckdb/duckdb-eh.wasm")).toBe("/my-repo/duckdb/duckdb-eh.wasm");
  });

  it("normalizes a base that lacks a trailing slash", () => {
    (globalThis as { window: Window & typeof globalThis }).window =
      { __APP_BASE__: "/repo" } as unknown as Window & typeof globalThis;
    expect(resolveBase()).toBe("/repo/");
  });

  it("honors an override over __APP_BASE__", () => {
    (globalThis as { window: Window & typeof globalThis }).window = {
      __APP_BASE__: "/repo/",
      __APP_BASE_OVERRIDE__: "/other/",
    } as unknown as Window & typeof globalThis;
    expect(resolveBase()).toBe("/other/");
  });
});