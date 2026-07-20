import { Header } from "./components/layout/Header";
import { LeftPanel } from "./components/layout/LeftPanel";
import { CenterPanel } from "./components/layout/CenterPanel";
import { RightPanel } from "./components/layout/RightPanel";
import { BottomPanel } from "./components/layout/BottomPanel";
import { StepDialogHost } from "./components/steps/StepDialogHost";
import { StepCatalogModal } from "./components/steps/StepCatalogModal";
import { ConnectionsModal } from "./components/modals/ConnectionsModal";
import { GetDataModal } from "./components/modals/GetDataModal";
import { ProfilePanel } from "./components/modals/ProfilePanel";
import { HistoryPanel } from "./components/modals/HistoryPanel";
import { AiPanel } from "./components/modals/AiPanel";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useEditorStore } from "./store/editorStore";
import { useSettingsStore } from "./store/settingsStore";
import { useQueryStore } from "./store/queryStore";
import { useConnectionStore } from "./store/connectionStore";
import { useFileStore } from "./store/fileStore";
import { useAutoPreview } from "./hooks/useAutoPreview";
import { useAutoSave } from "./hooks/useAutoSave";
import { getDuckDB } from "./lib/duckdb";
import { readFromFile, fileToState, createEmptyFile, writeToFile } from "./lib/dataSerializer";
import { useEffect, useState, useCallback, useRef } from "react";
import type { MobilePanel } from "./types/ui";

function ResizeHandle({
  direction,
  position,
  onResize,
}: {
  direction: "h" | "v";
  position: string;
  onResize: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const startPos = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startPos.current = direction === "h" ? e.clientX : e.clientY;
    document.body.style.cursor = direction === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const current = direction === "h" ? ev.clientX : ev.clientY;
      const delta = current - startPos.current;
      startPos.current = current;
      onResize(delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [direction, onResize]);

  return (
    <div
      className={`resize-handle resize-handle-${direction} ${position}`}
      onMouseDown={onMouseDown}
    />
  );
}

export function App() {
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const panelSizes = useEditorStore((s) => s.panelSizes);
  const setPanelSizes = useEditorStore((s) => s.setPanelSizes);
  const mobilePanel = useEditorStore((s) => s.mobilePanel);
  const setMobilePanel = useEditorStore((s) => s.setMobilePanel);
  const theme = useSettingsStore((s) => s.theme);
  const fileStatus = useFileStore((s) => s.status);

  // App initialization tries to restore the previously-saved etlstudio.json
  // handle first. If the handle is still valid and permitted, the app loads
  // the project and skips the Welcome screen. Otherwise it falls back to the
  // Welcome screen so the user can explicitly connect.
  const [engineReady, setEngineReady] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const tryRestore = useFileStore((s) => s.tryRestore);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDuckDB();
      } catch (e) {
        console.error("DuckDB init failed:", e);
      }
      if (!cancelled) setEngineReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Track whether this effect instance actually finished restore work.
    // In React Strict Mode the effect runs twice; the first instance is
    // cancelled, but its cleanup ensures restoring is never left stuck.
    let cancelled = false;
    let done = false;
    const run = async () => {
      try {
        const ok = await tryRestore();
        if (cancelled) return;
        if (ok) {
          await loadDataFromFile();
        }
      } catch (e) {
        console.error("Auto-restore failed:", e);
      } finally {
        done = true;
        if (!cancelled) setRestoring(false);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (!done) setRestoring(false);
    };
  }, [tryRestore]);

  useAutoPreview();
  useAutoSave();

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  // Keep the Welcome screen visible while we attempt a silent restore; after
  // that, show it only when no file is connected.
  if (fileStatus !== "connected" || restoring) {
    return <WelcomeScreen engineReady={engineReady} restoring={restoring} />;
  }

  const mobileTabs: { id: MobilePanel; label: string }[] = [
    { id: "explorer", label: "Explorer" },
    { id: "preview", label: "Preview" },
    { id: "steps", label: "Steps" },
    { id: "script", label: "Script" },
  ];

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <div
          className={`left-panel ${leftCollapsed ? "collapsed" : ""} ${mobilePanel === "explorer" ? "mobile-active" : ""}`}
          style={leftCollapsed ? {} : { width: panelSizes.leftWidth }}
        >
          <LeftPanel />
          {!leftCollapsed && (
            <ResizeHandle
              direction="h"
              position="left"
              onResize={(delta) => setPanelSizes({
                ...panelSizes,
                leftWidth: Math.max(160, Math.min(500, panelSizes.leftWidth + delta)),
              })}
            />
          )}
        </div>
        <div className="app-main">
          <CenterPanel />
          <div
            className={`bottom-panel ${mobilePanel === "script" ? "mobile-active" : ""}`}
            style={{ height: panelSizes.bottomHeight }}
          >
            <ResizeHandle
              direction="v"
              position="bottom"
              onResize={(delta) => setPanelSizes({
                ...panelSizes,
                bottomHeight: Math.max(100, Math.min(600, panelSizes.bottomHeight - delta)),
              })}
            />
            <BottomPanel />
          </div>
        </div>
        <div
          className={`right-panel ${rightCollapsed ? "collapsed" : ""} ${mobilePanel === "steps" ? "mobile-active" : ""}`}
          style={rightCollapsed ? {} : { width: panelSizes.rightWidth }}
        >
          {!rightCollapsed && (
            <ResizeHandle
              direction="h"
              position="right"
              onResize={(delta) => setPanelSizes({
                ...panelSizes,
                rightWidth: Math.max(180, Math.min(600, panelSizes.rightWidth - delta)),
              })}
            />
          )}
          <RightPanel />
        </div>
      </div>
      <div className="mobile-tabs">
        {mobileTabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${mobilePanel === t.id ? "active" : ""}`}
            onClick={() => setMobilePanel(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <StepDialogHost />
      <StepCatalogModal />
      <ConnectionsModal />
      <GetDataModal />
      <ProfilePanel />
      <HistoryPanel />
      <AiPanel />
    </div>
  );
}

async function loadDataFromFile() {
  const result = await readFromFile();
  if (result.data) {
    const state = fileToState(result.data);
    useQueryStore.getState().loadFromData(state.queries, state.folders, state.history);
    useConnectionStore.getState().loadFromData(state.connections);
    // Re-link folder handles from IDB; unlinked ones prompt on first use.
    void useConnectionStore.getState().relinkAll();
    if (state.settings) useSettingsStore.getState().applyFromData(state.settings);
    if (state.ui) {
      // Never restore open modals on load — the user must explicitly open them.
      // Also clear any stale active step/query selection that would pop a picker.
      const sanitizedUi = {
        ...state.ui,
        getDataOpen: false,
        stepCatalogOpen: false,
        activeStepId: null,
        editingStepId: null,
      };
      useEditorStore.getState().applyFromData(sanitizedUi);
    }
    if (state.ui?.activeQueryId) {
      useEditorStore.getState().setActiveQuery(state.ui.activeQueryId);
    }
  } else if (!result.error || result.error === "File is empty") {
    const empty = createEmptyFile();
    await writeToFile(empty);
    const state = fileToState(empty);
    useQueryStore.getState().loadFromData(state.queries, state.folders, state.history);
    useConnectionStore.getState().loadFromData(state.connections);
  } else {
    console.error("Failed to restore project file:", result.error);
  }
}