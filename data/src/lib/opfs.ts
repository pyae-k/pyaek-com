// OPFS-backed persistence for saved DuckDB tables. Chrome/Edge support OPFS
// (navigator.storage.getDirectory); Safari/Firefox do not — callers must gate
// on isOpfsSupported() and fall back to a clear message.
//
// Persistence model: a saved table is round-tripped as Parquet bytes in OPFS.
// On save, COPY the table to a virtual Parquet file, pull it via copyFileToBuffer,
// and write the bytes to OPFS as <name>.parquet. On load, register the OPFS
// buffer and CREATE TABLE AS SELECT * FROM read_parquet(...). This survives
// reloads without requiring DuckDB-Wasm to natively back its virtual FS by OPFS.

import { copyFileToBuffer, createTableFromSql, dropFile, registerFileBuffer, runSetup } from "./duckdb";
import { sanitizeVirtualName } from "./fileReaders";

const OPFS_DIR = "duckdb_etl_saved_tables";

export function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && "storage" in navigator && "getDirectory" in navigator.storage;
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

function opfsFileName(tableName: string): string {
  return `${sanitizeVirtualName(tableName)}.parquet`;
}

export async function opfsWrite(name: string, bytes: Uint8Array): Promise<void> {
  if (!isOpfsSupported()) throw new Error("OPFS is not supported in this browser");
  const dir = await getOpfsRoot();
  const handle = await dir.getFileHandle(opfsFileName(name), { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes.buffer as ArrayBuffer);
  await writable.close();
}

export async function opfsRead(name: string): Promise<Uint8Array | null> {
  if (!isOpfsSupported()) return null;
  try {
    const dir = await getOpfsRoot();
    const handle = await dir.getFileHandle(opfsFileName(name));
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

export async function opfsList(): Promise<string[]> {
  if (!isOpfsSupported()) return [];
  const dir = await getOpfsRoot();
  const names: string[] = [];
  for await (const entry of dir.entries()) {
    if (entry[1].kind === "file") names.push(entry[0]);
  }
  return names.sort();
}

export async function opfsDelete(name: string): Promise<void> {
  if (!isOpfsSupported()) return;
  const dir = await getOpfsRoot();
  await dir.removeEntry(opfsFileName(name)).catch(() => {});
}

/** Persist a DuckDB table (must already exist in the engine) to OPFS as Parquet. */
export async function saveTableToOpfs(tableName: string, schema = "main"): Promise<void> {
  if (!isOpfsSupported()) throw new Error("OPFS persistence is not supported in this browser");
  const stamp = `opfs_${tableName}_${Date.now()}.parquet`;
  await runSetup(
    `COPY (SELECT * FROM ${schema}.${`"${tableName.replace(/"/g, '""')}"`}) TO '${stamp}' (FORMAT PARQUET)`,
  );
  const buffer = await copyFileToBuffer(stamp);
  await opfsWrite(tableName, buffer);
  await dropFile(stamp).catch(() => {});
}

/** Restore a previously persisted table from OPFS into the engine. Returns true if restored. */
export async function loadTableFromOpfs(tableName: string, schema = "main"): Promise<boolean> {
  const buffer = await opfsRead(tableName);
  if (!buffer) return false;
  const virtualName = sanitizeVirtualName(`opfs_${tableName}.parquet`);
  await registerFileBuffer(virtualName, buffer);
  await createTableFromSql(tableName, `SELECT * FROM read_parquet('${virtualName}')`, schema);
  await dropFile(virtualName).catch(() => {});
  return true;
}

/** Restore every persisted table from OPFS. Used on app/project load. */
export async function restoreAllOpfsTables(): Promise<string[]> {
  if (!isOpfsSupported()) return [];
  const restored: string[] = [];
  for (const file of await opfsList()) {
    const tableName = file.replace(/\.parquet$/i, "");
    try {
      if (await loadTableFromOpfs(tableName)) restored.push(tableName);
    } catch {
      /* skip broken files */
    }
  }
  return restored;
}