import { useState } from "react";
import { useFileStore } from "../store/fileStore";
import { useQueryStore } from "../store/queryStore";
import { useEditorStore } from "../store/editorStore";
import { useSettingsStore } from "../store/settingsStore";
import { useConnectionStore } from "../store/connectionStore";
import { readFromFile, fileToState, createEmptyFile, writeToFile } from "../lib/dataSerializer";

interface WelcomeScreenProps {
  engineReady: boolean;
  restoring?: boolean;
}

export function WelcomeScreen({ engineReady, restoring }: WelcomeScreenProps) {
  const error = useFileStore((s) => s.error);
  const openFile = useFileStore((s) => s.openFile);
  const createFile = useFileStore((s) => s.createFile);
  const clearError = useFileStore((s) => s.clearError);
  const resetAll = useFileStore((s) => s.resetAll);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleOpen = async () => {
    clearError();
    setBusy(true);
    setStatusMsg(null);
    const ok = await openFile();
    if (ok) {
      setStatusMsg("Verifying etlstudio.json...");
      try {
        await loadDataFromFile();
        setStatusMsg(null);
      } catch (e) {
        setStatusMsg(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  };

  const handleCreate = async () => {
    clearError();
    setBusy(true);
    setStatusMsg(null);
    const ok = await createFile();
    if (ok) {
      setStatusMsg("Initializing etlstudio.json...");
      try {
        const empty = createEmptyFile();
        await writeToFile(empty);
        const state = fileToState(empty);
        useQueryStore.getState().loadFromData(state.queries, state.folders, state.history);
        useConnectionStore.getState().loadFromData(state.connections);
        useSettingsStore.getState().applyFromData(state.settings);
        useEditorStore.getState().applyFromData(state.ui);
        setStatusMsg(null);
      } catch (e) {
        setStatusMsg(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  };

  const handleReset = async () => {
    if (!confirm(
      "Reset Application?\n\n" +
      "This will clear ALL stored data:\n" +
      "  • IndexedDB databases\n" +
      "  • localStorage\n" +
      "  • sessionStorage\n\n" +
      "You will need to select your etlstudio.json file again."
    )) return;
    clearError();
    setBusy(true);
    setStatusMsg("Resetting application...");
    await resetAll();
    setStatusMsg("Application reset. Please create or open an etlstudio.json file.");
    setBusy(false);
  };

  return (
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "var(--bg-primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-sans)",
      zIndex: 9999,
    }}>
      <div style={{ textAlign: "center", maxWidth: 480, padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          ⚡
        </div>
        <h1 style={{
          fontSize: 32,
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: 8,
        }}>
          Welcome to ETL Studio
        </h1>
        <p style={{
          fontSize: 14,
          color: "var(--text-secondary)",
          marginBottom: 32,
          lineHeight: 1.5,
        }}>
          Create a new <code style={{ color: "var(--accent)" }}>etlstudio.json</code> file
          or open an existing one to get started.
          <br />
          All your queries, steps, and settings are stored in this single file.
        </p>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid var(--error)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 24,
            color: "var(--error)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            textAlign: "left",
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {statusMsg && !error && (
          <div style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 24,
            color: "var(--accent)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            textAlign: "left",
          }}>
            {statusMsg}
          </div>
        )}

        {restoring && !error && !statusMsg && (
          <div style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 24,
            color: "var(--accent)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            textAlign: "left",
          }}>
            Restoring previous session…
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={busy || restoring}
          className="primary"
          style={{ fontSize: 16, padding: "14px 32px", width: "100%", marginBottom: 12 }}
        >
          {busy ? "Creating..." : "Create New etlstudio.json"}
        </button>

        <button
          onClick={handleOpen}
          disabled={busy || restoring}
          style={{ fontSize: 16, padding: "14px 32px", width: "100%", marginBottom: 24 }}
        >
          {busy ? "Opening..." : "Open Existing etlstudio.json"}
        </button>

        <button
          onClick={handleReset}
          disabled={busy || restoring}
          style={{
            fontSize: 12,
            padding: "6px 16px",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            background: "transparent",
          }}
        >
          Reset Application
        </button>

        <p style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 32,
          lineHeight: 1.5,
        }}>
          Requires Chrome or Edge (File System Access API).<br />
          Your data stays in the file you choose — nothing is sent to any server.<br />
          {engineReady ? "Engine ready." : "Warming up engine..."}
        </p>
      </div>
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
    throw new Error(result.error);
  }
}