const IDB_NAME = "pwa_etl_file";
const IDB_STORE = "handles";
const IDB_KEY = "etlstudio_file";

export type FileConnectionStatus = "connected" | "disconnected" | "connecting";

type StatusListener = (status: FileConnectionStatus, name: string | null) => void;

class FileManager {
  private handle: FileSystemFileHandle | null = null;
  private status: FileConnectionStatus = "disconnected";
  private error: string | null = null;
  private listeners: Set<StatusListener> = new Set();

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async saveHandle(handle: FileSystemFileHandle): Promise<void> {
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private setStatus(status: FileConnectionStatus) {
    this.status = status;
    const name = this.handle?.name ?? null;
    this.listeners.forEach((cb) => cb(status, name));
  }

  onStatusChange(cb: StatusListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getStatus(): FileConnectionStatus {
    return this.status;
  }

  getName(): string | null {
    return this.handle?.name ?? null;
  }

  getError(): string | null {
    return this.error;
  }

  clearError(): void {
    this.error = null;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && "showOpenFilePicker" in window;
  }

  /** Try to restore the previously-saved file handle from IndexedDB on startup. */
  async tryRestoreHandle(): Promise<boolean> {
    this.error = null;
    if (!this.isSupported()) {
      this.error = "File System Access API is not supported in this browser. Use Chrome or Edge.";
      return false;
    }
    try {
      const idb = await this.openIDB();
      const handle = await new Promise<FileSystemFileHandle | undefined>((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result as FileSystemFileHandle | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!handle) return false;
      // Verify the handle is still usable (permissions may need re-granting).
      await handle.getFile();
      this.handle = handle;
      this.setStatus("connected");
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === "NotAllowedError") {
        this.error = "Permission expired. Please open your etlstudio.json file again.";
      } else {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.handle = null;
      this.setStatus("disconnected");
      return false;
    }
  }

  async openFile(): Promise<boolean> {
    this.error = null;
    if (!this.isSupported()) {
      this.error = "File System Access API is not supported in this browser. Use Chrome or Edge.";
      return false;
    }
    this.setStatus("connecting");
    try {
      const [handle] = await window.showOpenFilePicker!({
        mode: "readwrite",
        types: [{
          description: "ETL Studio File",
          accept: { "application/json": [".json"] },
        }],
        multiple: false,
      });
      await this.saveHandle(handle);
      this.handle = handle;
      this.setStatus("connected");
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        this.setStatus("disconnected");
        return false;
      }
      this.error = e instanceof Error ? e.message : String(e);
      this.setStatus("disconnected");
      return false;
    }
  }

  async createFile(): Promise<boolean> {
    this.error = null;
    if (!this.isSupported()) {
      this.error = "File System Access API is not supported in this browser. Use Chrome or Edge.";
      return false;
    }
    this.setStatus("connecting");
    try {
      const handle = await window.showSaveFilePicker!({
        types: [{
          description: "ETL Studio File",
          accept: { "application/json": [".json"] },
        }],
        suggestedName: "etlstudio.json",
      });
      await this.saveHandle(handle);
      this.handle = handle;
      this.setStatus("connected");
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        this.setStatus("disconnected");
        return false;
      }
      this.error = e instanceof Error ? e.message : String(e);
      this.setStatus("disconnected");
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.handle = null;
    this.setStatus("disconnected");
  }

  async resetAll(): Promise<void> {
    this.handle = null;
    this.error = null;
    this.setStatus("disconnected");

    // Clear file handle IndexedDB
    try {
      const idb = await this.openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* ignore */
    }

    // Clear all IndexedDB databases
    try {
      const dbs = await indexedDB.databases();
      if (dbs) {
        for (const db of dbs) {
          if (db.name) {
            try { indexedDB.deleteDatabase(db.name); } catch { /* ignore */ }
          }
        }
      }
    } catch {
      // indexedDB.databases() not supported in all browsers — fallback
      const knownDBs = ["pwa_etl_file", "pwa_etl_studio", "pwa_etl_workspace", "pwa_etl"];
      for (const name of knownDBs) {
        try { indexedDB.deleteDatabase(name); } catch { /* ignore */ }
      }
    }

    // Clear localStorage
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }

    // Clear sessionStorage
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }

  async readFile(): Promise<string> {
    if (!this.handle) throw new Error("No file connected");
    const file = await this.handle.getFile();
    return await file.text();
  }

  async writeFile(content: string): Promise<void> {
    if (!this.handle) throw new Error("No file connected");
    const writable = await this.handle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

export const fileManager = new FileManager();