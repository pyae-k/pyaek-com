// File System Access helpers for connections: a separate IndexedDB store holds
// folder directory handles keyed by connection id (the project JSON stores only
// the config). Also provides directory/file pickers, recursive listing of
// supported files, folder write-back, and a download fallback for browsers
// without the File System Access API (Safari/Firefox).
//
// Ported from pwa_duckdb/js/file-handles.js + local-file-connect.js.

import { FOLDER_EXTENSIONS } from "../types/connection";
import { isSupportedFileExt, getExt } from "./fileReaders";

const IDB_NAME = "pwa_etl_folders";
const IDB_STORE = "folder_handles";

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isFileSystemAccessSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** Save a directory handle for a folder connection (persisted across sessions). */
export async function saveFolderHandle(connectionId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, connectionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadFolderHandle(connectionId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const idb = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(connectionId);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function hasFolderHandle(connectionId: string): Promise<boolean> {
  const h = await loadFolderHandle(connectionId);
  return !!h;
}

export async function deleteFolderHandle(connectionId: string): Promise<void> {
  try {
    const idb = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(connectionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Pick a directory (File System Access API). Throws if unsupported/denied. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const w = window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> };
  if (!w.showDirectoryPicker) throw new Error("Directory picking is not supported in this browser");
  return w.showDirectoryPicker({ mode: "readwrite" });
}

/** Pick a single file for a download-fallback source (non-FSA browsers). */
export async function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    // Some browsers fire no event on cancel; resolve on window focus as a fallback.
    input.click();
  });
}

export interface FolderFile {
  name: string;
  /** Path relative to the folder root, using "/" separators. */
  relPath: string;
  ext: string;
  handle: FileSystemFileHandle;
}

/** Recursively list supported files under a directory handle. */
export async function listSupportedFiles(
  dir: FileSystemDirectoryHandle,
  baseRel = "",
): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      const sub = await listSupportedFiles(
        entry as FileSystemDirectoryHandle,
        baseRel ? `${baseRel}/${entry.name}` : entry.name,
      );
      out.push(...sub);
    } else {
      const ext = getExt(entry.name);
      if (isSupportedFileExt(ext)) {
        out.push({
          name: entry.name,
          relPath: baseRel ? `${baseRel}/${entry.name}` : entry.name,
          ext,
          handle: entry as FileSystemFileHandle,
        });
      }
    }
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

/** Resolve a file handle by relative path under a directory. */
export async function resolveFileByRelPath(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileSystemFileHandle | null> {
  const parts = relPath.split("/").filter(Boolean);
  if (!parts.length) return null;
  let current: FileSystemDirectoryHandle = dir;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      current = await current.getDirectoryHandle(parts[i]);
    } catch {
      return null;
    }
  }
  try {
    return await current.getFileHandle(parts[parts.length - 1]);
  } catch {
    return null;
  }
}

/** Read a folder file as bytes via its handle. */
export async function readFolderFileBytes(handle: FileSystemFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/** Write a file into a linked folder connection (write-back). */
export async function writeFileToFolder(
  dir: FileSystemDirectoryHandle,
  relPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const parts = relPath.split("/").filter(Boolean);
  let current: FileSystemDirectoryHandle = dir;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  // Copy into a fresh ArrayBuffer-backed view so the BufferSource type is satisfied
  // (TS 5.7 rejects Uint8Array<ArrayBufferLike> for SharedArrayBuffer reasons).
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  await writable.write(buf.buffer as ArrayBuffer);
  await writable.close();
}

/** Download fallback: trigger a browser download for browsers without FSA. */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime = "application/octet-stream"): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { FOLDER_EXTENSIONS };