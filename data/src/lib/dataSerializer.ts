import { fileManager } from "./fileManager";
import type { Query, Folder } from "../types/query";
import type { UIState, Settings } from "../types/ui";
import type { Connection } from "../types/connection";
import type { ETLStudioFile, FolderData, HistoryEntry, QueryData, ConnectionData } from "../types/etlstudio";
import { FILE_VERSION, DEFAULT_SETTINGS, DEFAULT_UI_LAYOUT, DEFAULT_SESSION, MAX_HISTORY } from "../types/etlstudio";
import { migrateStepRecords } from "./projectSchema";

export function serialize(
  queries: Query[],
  folders: Folder[],
  ui: UIState,
  settings: Settings,
  history: HistoryEntry[],
  connections: ConnectionData[] = [],
): ETLStudioFile {
  return {
    version: FILE_VERSION,
    settings: {
      theme: settings.theme,
      language: settings.language,
      previewLimit: settings.previewLimit,
      autoRun: settings.autoRun,
      autoSave: settings.autoSave,
    },
    uiLayout: {
      leftPanelWidth: ui.panelSizes.leftWidth,
      rightPanelWidth: ui.panelSizes.rightWidth,
      bottomPanelHeight: ui.panelSizes.bottomHeight,
      leftCollapsed: ui.leftCollapsed,
      rightCollapsed: ui.rightCollapsed,
      bottomTab: ui.bottomTab,
      folderExpansion: ui.folderExpansion,
    },
    folders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
    queries: queries.map(q => ({
      id: q.id,
      name: q.name,
      enabled: q.enabled,
      folderId: q.folderId,
      order: q.order,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      steps: q.steps.map(s => ({
        id: s.id,
        name: s.name,
        stepKind: s.stepKind,
        config: s.config,
        description: s.description,
        enabled: s.enabled,
        order: s.order,
        sql: s.sql,
      })),
    })),
    history: history.slice(-MAX_HISTORY),
    connections: connections.map((c) => ({
      id: c.id,
      kind: c.kind,
      displayName: c.displayName,
      config: c.config,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    session: {
      selectedQueryId: ui.activeQueryId,
      selectedStepId: ui.activeStepId,
    },
  };
}

export function deserialize(data: unknown): ETLStudioFile | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!obj.version || !Array.isArray(obj.queries)) return null;

  return {
    version: String(obj.version),
    settings: { ...DEFAULT_SETTINGS, ...(obj.settings as Partial<typeof DEFAULT_SETTINGS>) },
    uiLayout: { ...DEFAULT_UI_LAYOUT, ...(obj.uiLayout as Partial<typeof DEFAULT_UI_LAYOUT>) },
    folders: Array.isArray(obj.folders) ? (obj.folders as FolderData[]) : [],
    queries: Array.isArray(obj.queries) ? (obj.queries as QueryData[]) : [],
    connections: Array.isArray(obj.connections) ? (obj.connections as ConnectionData[]) : [],
    history: Array.isArray(obj.history) ? (obj.history as HistoryEntry[]) : [],
    session: { ...DEFAULT_SESSION, ...(obj.session as Partial<typeof DEFAULT_SESSION>) },
  };
}

export function fileToState(data: ETLStudioFile): {
  queries: Query[];
  folders: Folder[];
  connections: Connection[];
  ui: Partial<UIState>;
  settings: Partial<Settings>;
  history: HistoryEntry[];
} {
  const queries: Query[] = data.queries.map(q => ({
    id: q.id,
    name: q.name,
    enabled: q.enabled,
    folderId: q.folderId,
    order: q.order,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    steps: migrateStepRecords((q.steps || []) as unknown as Array<Record<string, unknown> & { type?: string }>),
  }));

  const folders: Folder[] = data.folders.map(f => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
  }));

  const connections: Connection[] = (data.connections ?? []).map((c) => ({
    id: c.id,
    kind: c.kind,
    displayName: c.displayName,
    config: c.config,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    // linkStatus is runtime-only; resolved on load via fileAccess re-link.
  }));

  const ui: Partial<UIState> = {
    activeQueryId: data.session.selectedQueryId,
    activeStepId: data.session.selectedStepId,
    bottomTab: data.uiLayout.bottomTab,
    leftCollapsed: data.uiLayout.leftCollapsed,
    rightCollapsed: data.uiLayout.rightCollapsed,
    panelSizes: {
      leftWidth: data.uiLayout.leftPanelWidth,
      rightWidth: data.uiLayout.rightPanelWidth,
      bottomHeight: data.uiLayout.bottomPanelHeight,
    },
    folderExpansion: data.uiLayout.folderExpansion,
  };

  const settings: Partial<Settings> = {
    theme: data.settings.theme,
    language: data.settings.language,
    previewLimit: data.settings.previewLimit,
    autoRun: data.settings.autoRun,
    autoSave: data.settings.autoSave,
  };

  return { queries, folders, connections, ui, settings, history: data.history };
}

export interface ReadResult {
  data: ETLStudioFile | null;
  error: string | null;
}

export async function readFromFile(): Promise<ReadResult> {
  if (fileManager.getStatus() !== "connected") {
    return { data: null, error: "No file connected" };
  }
  try {
    const content = await fileManager.readFile();
    if (!content.trim()) {
      return { data: null, error: "File is empty" };
    }
    const parsed = JSON.parse(content);
    const deserialized = deserialize(parsed);
    if (!deserialized) {
      return { data: null, error: "Invalid JSON structure in etlstudio.json" };
    }
    return { data: deserialized, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function writeToFile(data: ETLStudioFile): Promise<void> {
  if (fileManager.getStatus() !== "connected") return;
  await fileManager.writeFile(JSON.stringify(data, null, 2));
}

export function createEmptyFile(): ETLStudioFile {
  return {
    version: FILE_VERSION,
    settings: DEFAULT_SETTINGS,
    uiLayout: DEFAULT_UI_LAYOUT,
    folders: [],
    queries: [],
    connections: [],
    history: [],
    session: DEFAULT_SESSION,
  };
}