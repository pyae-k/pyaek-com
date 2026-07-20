import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { useSettingsStore } from "../store/settingsStore";
import { useQueryStore } from "../store/queryStore";
import { useFileStore } from "../store/fileStore";
import { useConnectionStore } from "../store/connectionStore";
import { serialize, writeToFile } from "../lib/dataSerializer";

const AUTOSAVE_DEBOUNCE = 800;

export function useAutoSave() {
  const queries = useQueryStore((s) => s.queries);
  const folders = useQueryStore((s) => s.folders);
  const history = useQueryStore((s) => s.history);
  const connections = useConnectionStore((s) => s.connections);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const activeStepId = useEditorStore((s) => s.activeStepId);
  const bottomTab = useEditorStore((s) => s.bottomTab);
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const panelSizes = useEditorStore((s) => s.panelSizes);
  const folderExpansion = useEditorStore((s) => s.folderExpansion);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const previewLimit = useSettingsStore((s) => s.previewLimit);
  const autoRun = useSettingsStore((s) => s.autoRun);
  const autoSaveSetting = useSettingsStore((s) => s.autoSave);
  const status = useFileStore((s) => s.status);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnected = useRef(false);

  useEffect(() => {
    if (status !== "connected") {
      wasConnected.current = false;
      return;
    }

    if (!wasConnected.current) {
      wasConnected.current = true;
      return;
    }

    if (!autoSaveSetting) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const uiState = useEditorStore.getState();
      const settingsState = useSettingsStore.getState();
      const queryState = useQueryStore.getState();
      const connectionState = useConnectionStore.getState();
      try {
        const data = serialize(queryState.queries, queryState.folders, uiState, settingsState, queryState.history, connectionState.connections);
        await writeToFile(data);
      } catch (e) {
        console.warn("Autosave failed:", e);
      }
    }, AUTOSAVE_DEBOUNCE);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    queries, folders, history, connections,
    activeQueryId, activeStepId, bottomTab,
    leftCollapsed, rightCollapsed, panelSizes, folderExpansion,
    theme, language, previewLimit, autoRun, autoSaveSetting,
    status,
  ]);
}