// Connection store: the list of connections (folder + server kinds) and the
// runtime link status of folder connections. Config is persisted in the project
// JSON via dataSerializer; the FileSystemFileHandle / directory handle for
// folder connections is persisted separately in IndexedDB by lib/fileAccess.
//
// Ported from pwa_duckdb's connections state (app.js + connection-catalog.js).

import { create } from "zustand";
import type { Connection, ConnectionKind, FolderLinkStatus } from "../types/connection";
import { isFolderConnectionKind } from "../types/connection";
import { loadFolderHandle, saveFolderHandle, deleteFolderHandle, hasFolderHandle } from "../lib/fileAccess";
import { buildFolderFileManifest, registerFolderFile } from "../lib/datasetFiles";

interface ConnectionState {
  connections: Connection[];
  /** id of the connection currently being edited/created in the modal, or null. */
  editingId: string | null;
  modalOpen: boolean;

  loadFromData: (connections: Connection[]) => void;
  openModal: (editingId?: string | null) => void;
  closeModal: () => void;

  addConnection: (kind: ConnectionKind, displayName: string, config: Record<string, unknown>) => Connection;
  updateConnection: (id: string, patch: Partial<Pick<Connection, "displayName" | "config">>) => void;
  deleteConnection: (id: string) => Promise<void>;

  /** Link a folder handle (persisted in IDB) and mark the connection linked. */
  linkFolder: (id: string, handle: FileSystemDirectoryHandle) => Promise<void>;
  /** Drop the stored handle and mark the connection missing. */
  unlinkFolder: (id: string) => Promise<void>;
  /** Prompt-style relink: caller passes a freshly-picked handle. */
  relinkFolder: (id: string, handle: FileSystemDirectoryHandle) => Promise<void>;

  /** Re-resolve link status for every folder connection from IDB. */
  relinkAll: () => Promise<void>;
  /** Scan a linked folder and register all supported files with DuckDB. */
  refreshFolderFiles: (id: string) => Promise<void>;
  getFolderHandle: (id: string) => Promise<FileSystemDirectoryHandle | null>;
  getById: (id: string) => Connection | undefined;
}

function uid(): string {
  return crypto.randomUUID();
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  editingId: null,
  modalOpen: false,

  loadFromData: (connections) => {
    // Folder connections start as "missing_handle" until relinkAll resolves them.
    const withStatus = connections.map((c) =>
      isFolderConnectionKind(c.kind) ? { ...c, linkStatus: "missing_handle" as FolderLinkStatus } : c,
    );
    set({ connections: withStatus });
  },

  openModal: (editingId = null) => set({ modalOpen: true, editingId }),
  closeModal: () => set({ modalOpen: false, editingId: null }),

  addConnection: (kind, displayName, config) => {
    const now = Date.now();
    const conn: Connection = {
      id: uid(),
      kind,
      displayName: displayName || kind,
      config,
      createdAt: now,
      updatedAt: now,
      linkStatus: isFolderConnectionKind(kind) ? "missing_handle" : undefined,
    };
    set({ connections: [...get().connections, conn] });
    return conn;
  },

  updateConnection: (id, patch) => {
    set({
      connections: get().connections.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
      ),
    });
  },

  deleteConnection: async (id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (conn && isFolderConnectionKind(conn.kind)) {
      await deleteFolderHandle(id);
    }
    set({ connections: get().connections.filter((c) => c.id !== id) });
  },

  linkFolder: async (id, handle) => {
    await saveFolderHandle(id, handle);
    set({
      connections: get().connections.map((c) =>
        c.id === id ? { ...c, linkStatus: "linked" } : c
      ),
    });
    // Register all supported files in the background so queries can use them immediately.
    await get().refreshFolderFiles(id);
  },

  unlinkFolder: async (id) => {
    await deleteFolderHandle(id);
    set({
      connections: get().connections.map((c) =>
        c.id === id ? { ...c, linkStatus: "missing_handle" } : c
      ),
    });
  },

  relinkFolder: async (id, handle) => {
    await get().linkFolder(id, handle);
  },

  relinkAll: async () => {
    const folderConns = get().connections.filter((c) => isFolderConnectionKind(c.kind));
    await Promise.all(
      folderConns.map(async (c) => {
        const exists = await hasFolderHandle(c.id);
        const linkStatus: FolderLinkStatus = exists ? "linked" : "missing_handle";
        set({
          connections: get().connections.map((cc) =>
            cc.id === c.id ? { ...cc, linkStatus } : cc,
          ),
        });
        if (exists) {
          await get().refreshFolderFiles(c.id);
        }
      }),
    );
  },

  refreshFolderFiles: async (id) => {
    const conn = get().getById(id);
    if (!conn || !isFolderConnectionKind(conn.kind)) return;
    const dir = await loadFolderHandle(id);
    if (!dir) return;
    try {
      const manifest = await buildFolderFileManifest(dir);
      await Promise.all(
        manifest.map((m) =>
          registerFolderFile(dir, m).catch((e) => {
            console.warn(`Failed to register ${m.relPath}:`, e);
          }),
        ),
      );
      get().updateConnection(id, { config: { ...conn.config, fileManifest: manifest } });
    } catch (e) {
      console.warn(`Failed to refresh folder files for ${id}:`, e);
    }
  },

  getFolderHandle: async (id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn || !isFolderConnectionKind(conn.kind)) return null;
    return loadFolderHandle(id);
  },

  getById: (id) => get().connections.find((c) => c.id === id),
}));