import { create } from "zustand";
import { fileManager, type FileConnectionStatus } from "../lib/fileManager";

interface FileStoreState {
  status: FileConnectionStatus;
  fileName: string | null;
  error: string | null;
  openFile: () => Promise<boolean>;
  createFile: () => Promise<boolean>;
  tryRestore: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  resetAll: () => Promise<void>;
  clearError: () => void;
}

export const useFileStore = create<FileStoreState>((set) => ({
  // The app always starts disconnected. We never auto-connect or auto-reconnect
  // on startup — the user must explicitly create or open an etlstudio.json file
  // from the Welcome/Connection screen.
  status: "disconnected",
  fileName: null,
  error: null,

  tryRestore: async () => {
    const ok = await fileManager.tryRestoreHandle();
    set({
      status: fileManager.getStatus(),
      fileName: fileManager.getName(),
      error: fileManager.getError(),
    });
    return ok;
  },

  openFile: async () => {
    const ok = await fileManager.openFile();
    set({
      status: fileManager.getStatus(),
      fileName: fileManager.getName(),
      error: fileManager.getError(),
    });
    return ok;
  },

  createFile: async () => {
    const ok = await fileManager.createFile();
    set({
      status: fileManager.getStatus(),
      fileName: fileManager.getName(),
      error: fileManager.getError(),
    });
    return ok;
  },

  disconnect: async () => {
    await fileManager.disconnect();
    set({ status: "disconnected", fileName: null, error: null });
  },

  resetAll: async () => {
    await fileManager.resetAll();
    set({ status: "disconnected", fileName: null, error: null });
  },

  clearError: () => {
    fileManager.clearError();
    set({ error: null });
  },
}));