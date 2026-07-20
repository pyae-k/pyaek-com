// db.js — shared IndexedDB handle for ChatAI.
// Both conversations and persisted folder handles live in the same database so
// every module agrees on the schema version and avoids VersionError collisions.

export const DB_NAME = "chatai";
export const DB_VERSION = 4;
export const CONVERSATIONS_STORE = "conversations";
export const FS_HANDLES_STORE = "fs-handles";
export const KB_STORE = "knowledge-base";
export const MEMORY_STORE = "agent-memory";

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        db.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FS_HANDLES_STORE)) {
        db.createObjectStore(FS_HANDLES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KB_STORE)) {
        const kb = db.createObjectStore(KB_STORE, { keyPath: "id" });
        kb.createIndex("fileId", "fileId", { unique: false });
      }
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        const mem = db.createObjectStore(MEMORY_STORE, { keyPath: "id" });
        mem.createIndex("scope", "scope", { unique: false });
        mem.createIndex("convId", "convId", { unique: false });
        mem.createIndex("agentId", "agentId", { unique: false });
        mem.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
