import { create } from "zustand";
import { DEFAULT_SETTINGS, type Settings } from "../types/ui";

interface SettingsState extends Settings {
  setTheme: (t: "light" | "dark") => void;
  setLanguage: (l: string) => void;
  setPreviewLimit: (n: number) => void;
  setAutoRun: (b: boolean) => void;
  setAutoSave: (b: boolean) => void;
  applyFromData: (settings: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,

  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setPreviewLimit: (previewLimit) => set({ previewLimit }),
  setAutoRun: (autoRun) => set({ autoRun }),
  setAutoSave: (autoSave) => set({ autoSave }),

  applyFromData: (settings) => set({ ...settings }),
}));