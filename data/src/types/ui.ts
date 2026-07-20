export type MobilePanel = "explorer" | "preview" | "steps" | "script";
export type BottomTab = "step" | "advanced" | "explain";

export interface PanelSizes {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
}

export interface UIState {
  activeQueryId: string | null;
  activeStepId: string | null;
  bottomTab: BottomTab;
  mobilePanel: MobilePanel;
  panelSizes: PanelSizes;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  selectedQueryIds: string[];
  folderExpansion: Record<string, boolean>;
}

export interface Settings {
  theme: "light" | "dark";
  language: string;
  previewLimit: number;
  autoRun: boolean;
  autoSave: boolean;
}

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  leftWidth: 260,
  rightWidth: 300,
  bottomHeight: 280,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  language: "en",
  previewLimit: 1000,
  autoRun: true,
  autoSave: true,
};

export const DEFAULT_UI_STATE: UIState = {
  activeQueryId: null,
  activeStepId: null,
  bottomTab: "step",
  mobilePanel: "preview",
  panelSizes: DEFAULT_PANEL_SIZES,
  leftCollapsed: false,
  rightCollapsed: false,
  selectedQueryIds: [],
  folderExpansion: {},
};