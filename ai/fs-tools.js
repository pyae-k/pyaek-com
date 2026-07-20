// fs-tools.js — File System Access API wrapper for OpenChatbox.
// Connects a folder, persists the handle in IndexedDB, and exposes read/write/search/ patch helpers.
// Only works in Chromium desktop browsers with a secure origin (https / localhost).

import { openDB, FS_HANDLES_STORE as HANDLE_STORE } from "./db.js";

const MAX_READ_SIZE = 1024 * 1024; // 1 MB text-file cap

async function getStore(mode) {
  const db = await openDB();
  return db.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE);
}

export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export class FileSystemManager {
  constructor() {
    this.handle = null; // FileSystemDirectoryHandle
    this.fileHandle = null; // FileSystemFileHandle for single-file linking
    this.filePath = null;
    this.name = null;
    this.id = null;
    this.mode = null; // "folder" | "file"
  }

  get connected() { return !!this.handle || !!this.fileHandle; }

  // Persist a directory or file handle in IndexedDB.
  async persist(id, name, dirHandle, fileHandle, filePath, mode) {
    const store = await getStore("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put({ id, name, handle: dirHandle, fileHandle, filePath, mode });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Load a previously persisted handle.
  async loadPersisted() {
    const store = await getStore("readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result?.[0] || null);
      req.onerror = () => reject(req.error);
    });
  }

  // Remove persisted handle.
  async clearPersisted() {
    const store = await getStore("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Open picker and connect a folder.
  async connectFolder() {
    if (!isFileSystemAccessSupported()) throw new Error("File System Access API not available");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!handle) throw new Error("No folder selected");
    this.handle = handle;
    this.fileHandle = null;
    this.filePath = null;
    this.name = handle.name;
    this.mode = "folder";
    this.id = "fs_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await this.persist(this.id, this.name, handle, null, null, "folder");
    return { id: this.id, name: this.name, mode: "folder" };
  }

  // Open picker and connect a single file for agentic read/write.
  async connectFile() {
    if (!isFileSystemAccessSupported()) throw new Error("File System Access API not available");
    if (!("showOpenFilePicker" in window)) throw new Error("File picker not available in this browser");
    const handles = await window.showOpenFilePicker({ multiple: false });
    const handle = handles?.[0];
    if (!handle) throw new Error("No file selected");
    this.fileHandle = handle;
    this.handle = null;
    this.name = handle.name;
    this.filePath = handle.name;
    this.mode = "file";
    this.id = "fs_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await this.persist(this.id, this.name, null, handle, handle.name, "file");
    return { id: this.id, name: handle.name, mode: "file" };
  }

  // Try to restore a previously connected folder or file; may throw if permission was revoked.
  async restoreFolder() {
    const stored = await this.loadPersisted();
    if (!stored?.handle && !stored?.fileHandle) return null;
    this.handle = stored.handle || null;
    this.fileHandle = stored.fileHandle || null;
    this.filePath = stored.filePath || null;
    this.name = stored.name;
    this.id = stored.id;
    this.mode = stored.mode || (this.handle ? "folder" : "file");
    return { id: this.id, name: this.name, mode: this.mode };
  }

  // Request permission again (call after restore if needed).
  async requestPermission() {
    if (this.handle) {
      return await this.handle.requestPermission({ mode: "readwrite" });
    }
    if (this.fileHandle) {
      return await this.fileHandle.requestPermission({ mode: "readwrite" });
    }
    return "denied";
  }

  disconnect() {
    this.handle = null;
    this.fileHandle = null;
    this.filePath = null;
    this.name = null;
    this.id = null;
    this.mode = null;
    return this.clearPersisted();
  }

  // Resolve a relative path string (using "/" separators) to a FileSystemHandle.
  async getEntry(path) {
    if (!this.handle) throw new Error("No folder connected");
    const parts = normalizePathParts(path);
    if (parts.length === 0) return this.handle;
    let current = this.handle;
    for (let i = 0; i < parts.length; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    return current;
  }

  async getFileHandle(path) {
    if (!this.handle) throw new Error("No folder connected");
    const parts = normalizePathParts(path);
    if (parts.length === 0) throw new Error("Path is empty");
    let dir = this.handle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    return dir.getFileHandle(parts[parts.length - 1]);
  }

  async getDirectoryHandle(path) {
    if (!this.handle) throw new Error("No folder connected");
    const parts = normalizePathParts(path);
    if (parts.length === 0) return this.handle;
    let dir = this.handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    return dir;
  }

  // List directory contents recursively.
  async list(path = ".", recursive = true) {
    if (this.fileHandle) {
      const file = await this.fileHandle.getFile();
      return [{ name: this.fileHandle.name, kind: "file", path: this.filePath || this.fileHandle.name, size: file.size }];
    }
    const dir = await this.getDirectoryHandle(path);
    const entries = [];
    const prefix = (path === "." || !path) ? "" : path + "/";
    for await (const [name, handle] of dir.entries()) {
      const kind = handle.kind;
      // Skip entries with invalid/empty names that could break downstream calls.
      if (!name || name === "." || name === "..") continue;
      const entryPath = prefix + name;
      let size = null;
      if (kind === "file") {
        try { size = (await handle.getFile()).size; } catch {}
      }
      const item = { name, kind, path: entryPath, size };
      if (recursive && kind === "directory") {
        item.children = await this.list(entryPath, true);
      }
      entries.push(item);
    }
    entries.sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === "directory" ? -1 : 1;
    });
    return entries;
  }

  // Read text file; returns content as a string.
  async readText(path) {
    let fh;
    if (this.fileHandle && (!path || path === this.filePath || path === ".")) {
      fh = this.fileHandle;
    } else {
      fh = await this.getFileHandle(path);
    }
    const file = await fh.getFile();
    if (file.size > MAX_READ_SIZE) {
      throw new Error(`File too large (${file.size} bytes > ${MAX_READ_SIZE} bytes limit)`);
    }
    return file.text();
  }

  // Write text to a file, creating parent directories as needed.
  async writeText(path, content) {
    let fh;
    if (this.fileHandle && (!path || path === this.filePath || path === ".")) {
      fh = this.fileHandle;
    } else {
      if (!this.handle) throw new Error("No folder connected");
      const parts = normalizePathParts(path);
      if (parts.length === 0) throw new Error("Empty path");
      let dir = this.handle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    }
    const writer = await fh.createWritable();
    await writer.write(content);
    await writer.close();
  }

  // Apply a unified-diff patch to a text file.
  async applyPatch(path, diff) {
    const original = await this.readText(path);
    const patched = applyUnifiedDiff(original, diff);
    await this.writeText(path, patched);
    return patched;
  }

  // Recursively search file contents for a query (substring or /regex/).`
  async search(path = ".", query) {
    const regex = queryToRegex(query);
    const hits = [];
    if (this.fileHandle) {
      try {
        const text = await this.readText(this.filePath);
        const lines = text.split("\n");
        const matches = [];
        lines.forEach((line, idx) => {
          const m = line.match(regex);
          if (m) matches.push({ line: idx + 1, text: line.trim() });
        });
        if (matches.length) hits.push({ path: this.filePath, matches });
      } catch (err) {
        // Binary or unreadable: skip.
      }
      return hits;
    }
    const entries = await this.list(path, true);
    const files = flattenFiles(entries);
    for (const f of files) {
      try {
        const text = await this.readText(f.path);
        const lines = text.split("\n");
        const matches = [];
        lines.forEach((line, idx) => {
          const m = line.match(regex);
          if (m) matches.push({ line: idx + 1, text: line.trim() });
        });
        if (matches.length) hits.push({ path: f.path, matches });
      } catch (err) {
        // Binary or unreadable: skip.
      }
    }
    return hits;
  }
}

function flattenFiles(entries) {
  const out = [];
  for (const e of entries || []) {
    if (e.kind === "file") out.push(e);
    if (e.children) out.push(...flattenFiles(e.children));
  }
  return out;
}

function queryToRegex(query) {
  if (typeof query === "string" && query.startsWith("/") && query.lastIndexOf("/") > 0) {
    const last = query.lastIndexOf("/");
    const pattern = query.slice(1, last);
    const flags = query.slice(last + 1);
    return new RegExp(pattern, flags || "i");
  }
  return new RegExp(escapeRegex(String(query)), "i");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalize path segments: remove empties, ".", "..", and invalid names that
// would throw "Name is not allowed" in FileSystemDirectoryHandle.
function normalizePathParts(path) {
  if (typeof path !== "string") return [];
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== ".." && !/[\x00-\x1f]/g.test(p));
}

// Minimal unified diff applier. Handles context lines and +/- lines.
function applyUnifiedDiff(original, diff) {
  const lines = original.split("\n");
  const hunks = parseHunks(diff);
  if (!hunks.length) return original;

  // Apply hunks from bottom to top so line numbers remain valid.
  const sorted = hunks.slice().sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of sorted) {
    // Convert 1-based start to 0-based index.
    let idx = hunk.oldStart - 1;
    let consumed = 0;
    for (const line of hunk.lines) {
      const op = line[0];
      const content = line.slice(1);
      if (op === " ") {
        // Context line must match.
        if (lines[idx] !== content) {
          throw new Error(`Patch context mismatch at line ${idx + 1}: expected "${content}", found "${lines[idx]}"`);
        }
        idx++;
        consumed++;
      } else if (op === "-") {
        if (lines[idx] !== content) {
          throw new Error(`Patch removal mismatch at line ${idx + 1}: expected "${content}", found "${lines[idx]}"`);
        }
        lines.splice(idx, 1);
        consumed++;
      } else if (op === "+") {
        lines.splice(idx, 0, content);
        idx++;
      }
    }
    // Validate old length if provided.
    if (hunk.oldLength != null && consumed !== hunk.oldLength) {
      // Be tolerant; not throwing here because trailing newlines can be tricky.
    }
  }
  return lines.join("\n");
}

function parseHunks(diff) {
  const hunks = [];
  const lines = diff.split("\n");
  let current = null;
  for (const line of lines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(header[1], 10),
        oldLength: header[2] != null ? parseInt(header[2], 10) : null,
        newStart: parseInt(header[3], 10),
        newLength: header[4] != null ? parseInt(header[4], 10) : null,
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\ ")) continue; // "\ No newline at end of file"
    if (line.length === 0 && current.lines.length > 0 && current.lines[current.lines.length - 1][0] === " ") {
      // Empty context line; preserve as context.
      current.lines.push(" ");
      continue;
    }
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}
