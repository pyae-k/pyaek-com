/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative base so the same build works at any deploy path (GitHub Pages
  // subpaths). index.html's inline script additionally injects a <base> tag
  // and exposes window.__APP_BASE__ for runtime URL construction.
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "DuckDB ETL Studio",
        short_name: "DuckDB ETL",
        id: "/",
        description: "DuckDB-native ETL designer with connections, transforms, and AI assist",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,wasm,svg}"],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
        globIgnores: ["**/duckdb-eh.wasm"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: /\/duckdb\/.*\.wasm$/,
            handler: "CacheFirst",
            options: {
              cacheName: "duckdb-wasm-cache",
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/duckdb\/.*\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "duckdb-worker-cache",
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});