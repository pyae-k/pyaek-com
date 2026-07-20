import { create } from "zustand";
import {
  DEFAULT_UI_STATE,
  type UIState,
  type MobilePanel,
  type PanelSizes,
  type BottomTab,
} from "../types/ui";
import { useStepStore } from "./stepStore";
import { useQueryStore } from "./queryStore";

interface EditorState extends UIState {
  /** id of the step whose config dialog is open, or null. */
  editingStepId: string | null;
  /** Step catalog ("+ Add step" picker) open state. */
  stepCatalogOpen: boolean;
  /** Get Data modal open state. */
  getDataOpen: boolean;
  /** Profile / History modal open state. */
  profileOpen: boolean;
  historyOpen: boolean;
  /** AI panel open state. */
  aiOpen: boolean;
  setActiveQuery: (id: string | null) => void;
  setActiveStep: (id: string | null) => void;
  openStepDialog: (stepId: string) => void;
  closeStepDialog: () => void;
  openStepCatalog: () => void;
  closeStepCatalog: () => void;
  openGetData: () => void;
  closeGetData: () => void;
  openProfile: () => void;
  closeProfile: () => void;
  openHistory: () => void;
  closeHistory: () => void;
  openAi: () => void;
  closeAi: () => void;
  setBottomTab: (tab: BottomTab) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  setPanelSizes: (sizes: PanelSizes) => void;
  setSelectedQueryIds: (ids: string[]) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setFolderExpansion: (id: string, expanded: boolean) => void;
  applyFromData: (ui: Partial<UIState>) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  ...DEFAULT_UI_STATE,
  editingStepId: null,
  stepCatalogOpen: false,
  getDataOpen: false,
  profileOpen: false,
  historyOpen: false,
  aiOpen: false,

  setActiveQuery: (id) => {
    set({ activeQueryId: id, activeStepId: null });
    if (id) {
      const { loadSteps } = useStepStore.getState();
      loadSteps(id);
      const steps = useQueryStore.getState().getSteps(id);
      const firstEnabled = steps.find((s) => s.enabled);
      if (firstEnabled) set({ activeStepId: firstEnabled.id });
    } else {
      useStepStore.getState().loadSteps("");
    }
  },

  setActiveStep: (id) => set({ activeStepId: id }),

  openStepDialog: (stepId) => set({ editingStepId: stepId }),
  closeStepDialog: () => set({ editingStepId: null }),

  openStepCatalog: () => set({ stepCatalogOpen: true }),
  closeStepCatalog: () => set({ stepCatalogOpen: false }),

  openGetData: () => set({ getDataOpen: true }),
  closeGetData: () => set({ getDataOpen: false }),

  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
  openAi: () => set({ aiOpen: true }),
  closeAi: () => set({ aiOpen: false }),

  setBottomTab: (tab) => set({ bottomTab: tab }),

  setMobilePanel: (panel) => set({ mobilePanel: panel }),

  setPanelSizes: (sizes) => set({ panelSizes: sizes }),

  toggleLeftPanel: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

  setSelectedQueryIds: (ids) => set({ selectedQueryIds: ids }),

  setFolderExpansion: (id, expanded) =>
    set((s) => ({ folderExpansion: { ...s.folderExpansion, [id]: expanded } })),

  applyFromData: (ui) => set({ ...ui }),
}));