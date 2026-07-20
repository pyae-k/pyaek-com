import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/theme.css";
import "./styles/layout.css";

// In dev, unregister any stale service workers from previous builds/previews
// so they stop intercepting navigation and serving cached shells. In production
// builds the SW is registered by vite-plugin-pwa (via registerSW), so we must
// NOT touch it here — unregistering unconditionally would tear down the very
// offline cache the PWA depends on.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  caches.keys().then((keys) => {
    for (const k of keys) caches.delete(k);
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Unable to find #root element in index.html");
}

let fatalOverlay: HTMLDivElement | null = null;

/**
 * Render a full-screen fatal error overlay in a separate DOM node so it never
 * mutates React's managed container. Writing innerHTML on #root while React is
 * mounted causes React to crash with "removeChild: node is not a child".
 */
function showFatalError(title: string, err: unknown) {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(title, err);

  if (!fatalOverlay) {
    fatalOverlay = document.createElement("div");
    fatalOverlay.style.position = "fixed";
    fatalOverlay.style.inset = "0";
    fatalOverlay.style.zIndex = "99999";
    document.body.appendChild(fatalOverlay);
  }

  fatalOverlay.innerHTML = `
    <div style="
      width:100%;height:100%;background:#0f172a;color:#f1f5f9;
      font-family:sans-serif;padding:32px;overflow:auto;
    ">
      <h1 style="color:#ef4444;margin-bottom:16px;">${title}</h1>
      <p style="margin-bottom:16px;line-height:1.5;">
        The app could not start. Check the browser console for additional details,
        or try a hard refresh (Ctrl/Cmd + Shift + R).
      </p>
      <pre style="
        background:#1e293b;border:1px solid #334155;border-radius:8px;
        padding:16px;font-family:monospace;font-size:12px;
        white-space:pre-wrap;word-break:break-word;
      ">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
    </div>
  `;
}

window.addEventListener("error", (e) => {
  showFatalError("Runtime Error", e.error ?? e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  showFatalError("Unhandled Promise Rejection", e.reason);
});

try {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
} catch (e) {
  showFatalError("Failed to render app", e);
}
