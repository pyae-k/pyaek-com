import type { StepKind } from "./query";
import type { ConnectionKind } from "./connection";

export interface ETLStudioFile {
  version: string;
  settings: ETLStudioSettings;
  uiLayout: ETLStudioUILayout;
  folders: FolderData[];
  queries: QueryData[];
  connections: ConnectionData[];
  history: HistoryEntry[];
  session: SessionData;
}

export interface ETLStudioSettings {
  theme: "light" | "dark";
  language: string;
  previewLimit: number;
  autoRun: boolean;
  autoSave: boolean;
}

export interface ETLStudioUILayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomTab: "step" | "advanced" | "explain";
  folderExpansion: Record<string, boolean>;
}

export interface FolderData {
  id: string;
  name: string;
  parentId: string | null;
}

export interface QueryData {
  id: string;
  name: string;
  enabled: boolean;
  folderId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  steps: StepData[];
}

export interface StepData {
  id: string;
  name: string;
  stepKind: StepKind;
  config: Record<string, unknown>;
  description?: string;
  enabled: boolean;
  order: number;
  sql: string;
}

export interface HistoryEntry {
  timestamp: number;
  action: string;
  queryId?: string;
  snapshot?: Partial<QueryData>;
}

export interface SessionData {
  selectedQueryId: string | null;
  selectedStepId: string | null;
}

/** Persisted connection record (config only; the folder handle lives in IDB). */
export interface ConnectionData {
  id: string;
  kind: ConnectionKind;
  displayName: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: ETLStudioSettings = {
  theme: "dark",
  language: "en",
  previewLimit: 1000,
  autoRun: true,
  autoSave: true,
};

export const DEFAULT_UI_LAYOUT: ETLStudioUILayout = {
  leftPanelWidth: 260,
  rightPanelWidth: 300,
  bottomPanelHeight: 280,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomTab: "step",
  folderExpansion: {},
};

export const DEFAULT_SESSION: SessionData = {
  selectedQueryId: null,
  selectedStepId: null,
};

export const FILE_VERSION = "2.0";
export const MAX_HISTORY = 50;