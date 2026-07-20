// Higher-level dataset helpers built on the DuckDB engine: register a File
// (with SheetJS conversion for xlsx), resolve sqlite/duckdb file sources to a
// concrete table query, check whether a source file is still registered, and
// pre-flight validation of source steps before running a pipeline.
// Ported from pwa_duckdb/js/duckdb-engine.js.

import * as XLSX from "xlsx";
import type { Step } from "../types/query";
import type { Connection, FolderFileManifestEntry } from "../types/connection";
import { isFolderConnectionKind } from "../types/connection";
import {
  attachAlias,
  copyFileToBuffer,
  getDuckDB,
  withConnection,
  tableExists,
  listAttachedDuckdbTables,
} from "./duckdb";
import { SourceRelinkRequiredError, SessionTableMissingError } from "./errors";
import {
  buildFileSourceMeta,
  minBytesForExt,
  sanitizeVirtualName,
  getExt,
  type FileSourceMeta,
} from "./fileReaders";
import { listSupportedFiles, resolveFileByRelPath, loadFolderHandle } from "./fileAccess";
import { buildFolderFileManifestEntries } from "./folderSources";

/** Register a File's bytes under `virtualName`. Returns the bytes. */
export async function registerFileFromFile(file: File, virtualName: string): Promise<Uint8Array> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { registerFileBuffer } = await import("./duckdb");
  await registerFileBuffer(virtualName, buffer);
  return buffer;
}

export interface RegisteredDataset {
  virtualName: string;
  jsonVirtualName: string | null;
  ext: string;
}

/**
 * Register a dataset File, converting xlsx/xls to JSON via SheetJS (npm xlsx)
 * so DuckDB can read it with read_json_auto. Returns the virtual names.
 */
export async function registerDatasetFile(file: File, virtualName: string, ext: string): Promise<RegisteredDataset> {
  const buffer = await registerFileFromFile(file, virtualName);
  let jsonVirtualName: string | null = null;

  if (ext === "xlsx" || ext === "xls") {
    const wb = XLSX.read(buffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    jsonVirtualName = `${virtualName}.json`;
    const { registerFileText } = await import("./duckdb");
    await registerFileText(jsonVirtualName, JSON.stringify(json));
  }

  return { virtualName, jsonVirtualName, ext };
}

/** Build meta + register a File, resolving sqlite/duckdb to a concrete table query. */
export async function buildFileSourceMetaFromFile(file: File): Promise<FileSourceMeta> {
  const meta = buildFileSourceMeta(file.name);
  await registerDatasetFile(file, meta.sourceVirtual, meta.ext);
  meta.sql = await resolveFileSourceSql(meta);
  return meta;
}

/** For sqlite/db/duckdb files, ATTACH and pick the first table; otherwise keep the reader SQL. */
export async function resolveFileSourceSql(meta: FileSourceMeta): Promise<string> {
  const { ext, sourceVirtual } = meta;

  if (ext === "duckdb") {
    const tables = await listAttachedDuckdbTables(sourceVirtual, "_folder_src");
    if (!tables.length) throw new Error("No tables found in DuckDB file");
    return tables[0].sql;
  }

  if (ext === "sqlite" || ext === "db") {
    const alias = "_sqlite_src";
    await attachAlias(alias, `ATTACH '${sourceVirtual.replace(/'/g, "''")}' AS ${alias} (TYPE SQLITE)`);
    return withConnection(async (c) => {
      const result = await c.query(
        `SELECT name FROM ${alias}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1`,
      );
      const rows = result.toArray();
      if (!rows.length) throw new Error("No tables found in SQLite file");
      const tableName = String(rows[0].name);
      return `SELECT * FROM ${alias}.main."${tableName.replace(/"/g, '""')}"`;
    });
  }

  return meta.sql;
}

/** Check whether a virtual file is registered with enough bytes. */
export async function isVirtualFileRegistered(virtualName: string, ext?: string): Promise<boolean> {
  if (!virtualName) return false;
  try {
    const existing = await copyFileToBuffer(virtualName);
    const byteLength = existing?.byteLength ?? 0;
    if (byteLength < minBytesForExt(ext ?? "")) return false;
    return true;
  } catch {
    return false;
  }
}

/** Is a source_file step's file still registered with enough bytes? */
export async function isSourceFileRegistered(step: Step): Promise<boolean> {
  if (step.stepKind !== "source_file") return true;
  const cfg = step.config as { sourceVirtual?: string; ext?: string } | undefined;
  return isVirtualFileRegistered(cfg?.sourceVirtual ?? "", cfg?.ext);
}

/** Build a manifest of supported files inside a linked folder. */
export async function buildFolderFileManifest(
  dir: FileSystemDirectoryHandle,
): Promise<FolderFileManifestEntry[]> {
  const files = await listSupportedFiles(dir);
  return buildFolderFileManifestEntries(files);
}

/** Register a single folder file with DuckDB under the manifest's virtual name. */
export async function registerFolderFile(
  dir: FileSystemDirectoryHandle,
  entry: Pick<FolderFileManifestEntry, "relPath" | "virtualName" | "ext">,
): Promise<void> {
  const handle = await resolveFileByRelPath(dir, entry.relPath);
  if (!handle) throw new Error(`File not found in linked folder: ${entry.relPath}`);
  const file = await handle.getFile();
  await registerDatasetFile(file, entry.virtualName, entry.ext);
}

interface FileSourceConfig {
  sourceVirtual?: string;
  sourceName?: string;
  relPath?: string;
  ext?: string;
  connectionId?: string;
}

/** Register a folder file referenced by a source config, honoring the stored virtual name. */
export async function registerFolderFileByConfig(
  dir: FileSystemDirectoryHandle,
  cfg: FileSourceConfig,
): Promise<void> {
  const relPath = cfg.relPath || cfg.sourceName;
  if (!relPath) throw new Error("Source has no relative path to resolve");
  const handle = await resolveFileByRelPath(dir, relPath);
  if (!handle) throw new Error(`File not found in linked folder: ${relPath}`);
  const file = await handle.getFile();
  const virtualName = cfg.sourceVirtual || sanitizeVirtualName(file.name);
  const ext = cfg.ext || getExt(file.name);
  await registerDatasetFile(file, virtualName, ext);
}

/** Ensure a single file source is registered, re-reading from its linked folder if needed. */
export async function ensureFileSourceReady(
  cfg: FileSourceConfig,
  connections: Connection[],
  label?: string,
): Promise<void> {
  const sourceVirtual = cfg.sourceVirtual || "";
  const ext = cfg.ext || "";
  if (sourceVirtual && (await isVirtualFileRegistered(sourceVirtual, ext))) return;

  const sourceLabel = label || cfg.sourceName || cfg.relPath || sourceVirtual || "file";
  if (!cfg.connectionId) {
    throw new SourceRelinkRequiredError(undefined, `Source file "${sourceLabel}" is not loaded — re-link the file.`);
  }
  const conn = connections.find((c) => c.id === cfg.connectionId);
  if (!conn || !isFolderConnectionKind(conn.kind) || conn.linkStatus !== "linked") {
    throw new SourceRelinkRequiredError(undefined, `Folder connection for "${sourceLabel}" is not linked.`);
  }
  const dir = await loadFolderHandle(conn.id);
  if (!dir) {
    throw new SourceRelinkRequiredError(undefined, `Folder connection for "${sourceLabel}" could not be opened.`);
  }
  await registerFolderFileByConfig(dir, cfg);
}

/**
 * Pre-flight check that all source steps in a pipeline are ready to run.
 * Re-registers folder files when the connection is still linked but the DuckDB
 * buffer was lost (e.g. after a hard refresh). Throws SourceRelinkRequiredError /
 * SessionTableMissingError on failure.
 */
export async function prepareSourceSteps(steps: Step[], connections: Connection[]): Promise<void> {
  for (const step of steps) {
    if (step.stepKind === "source_file") {
      const cfg = step.config as FileSourceConfig;
      await ensureFileSourceReady(cfg, connections, step.name);
      continue;
    }
    if (step.stepKind === "source_table") {
      const cfg = step.config as { schema?: string; table?: string } | undefined;
      const schema = cfg?.schema || "main";
      const table = cfg?.table;
      if (table && !(await tableExists(schema, table))) throw new SessionTableMissingError(table);
      continue;
    }
    if (step.stepKind === "append_tables") {
      const cfg = step.config as {
        sources?: Array<{
          type?: string;
          sourceVirtual?: string;
          ext?: string;
          sourceName?: string;
          relPath?: string;
          connectionId?: string;
        }>;
      };
      for (const src of cfg?.sources ?? []) {
        if (!src || src.type !== "file") continue;
        await ensureFileSourceReady(src, connections, src.sourceName ?? src.relPath ?? "append file");
      }
    }
  }
}

export { sanitizeVirtualName, getDuckDB };