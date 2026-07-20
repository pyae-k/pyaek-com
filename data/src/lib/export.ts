// Export: CSV / Parquet / Excel / JSON / JSONL for a query or bulk set, plus a
// Download-SQL export (one .sql file per query under a dated folder). Writes
// either to a linked folder connection (File System Access) or triggers a
// browser download (fallback for Safari/Firefox).
//
// Ported from pwa_duckdb/js/export.js + pipeline.js Download-SQL, typed.

import * as XLSX from "xlsx";
import { withConnection, copyFileToBuffer, dropFile } from "./duckdb";
import { buildFull } from "../engine/cteBuilder";
import { createQueryResolver } from "../engine/references";
import { aggregateConnectionGlobalSetup } from "../connections/kinds";
import { writeFileToFolder, downloadBytes } from "./fileAccess";
import { getStepDef } from "../steps";
import type { Query } from "../types/query";
import type { Connection } from "../types/connection";

export type ExportFormat = "csv" | "parquet" | "xlsx" | "json" | "jsonl";

export type ExportTarget =
  | { kind: "download" }
  | { kind: "folder"; dir: FileSystemDirectoryHandle; subPath?: string };

export type DatePosition = "start" | "end" | "none";

/** Build an export file name with an optional YYYYMMDD date stamp. Pure. */
export function buildExportFileName(
  baseName: string,
  ext: string,
  opts: { datePosition?: DatePosition; date?: string } = {},
): string {
  const safe = baseName.replace(/[^a-zA-Z0-9_]/g, "_") || "export";
  const date = opts.date ?? yyyymmdd();
  const pos = opts.datePosition ?? "none";
  const dotExt = ext.startsWith(".") ? ext : `.${ext}`;
  if (pos === "start") return `${date}_${safe}${dotExt}`;
  if (pos === "end") return `${safe}_${date}${dotExt}`;
  return `${safe}${dotExt}`;
}

/** Sanitize a query name into a safe .sql file base name. Pure. */
export function sanitizeSqlFileName(name: string): string {
  return (name || "query").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "query";
}

/** De-duplicate a list of base names, suffixing collisions with _2, _3, …. Pure. */
export function uniqueSqlFileNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    let candidate = n;
    let i = 2;
    while (seen.has(candidate)) {
      candidate = `${n}_${i}`;
      i++;
    }
    seen.add(candidate);
    return candidate;
  });
}

/** Assemble the .sql text for one query: global setup + the compiled pipeline. Pure. */
export function buildQuerySqlFile(
  query: Query,
  allQueries: Query[],
  setupSql: string,
): string {
  // Portable mode: folder sources emit `getvariable('alias') || '/file'` path
  // expressions so the downloaded script runs on desktop DuckDB.
  const resolveQuery = createQueryResolver(allQueries, true);
  const steps = executableSteps(query.steps);
  const compiled = buildFull(steps, resolveQuery, undefined, undefined, true);
  const parts: string[] = [];
  if (setupSql.trim()) {
    parts.push("-- Global setup (connections / extensions / folder variables)");
    parts.push(setupSql.trim());
    parts.push("");
  }
  parts.push(`-- Query: ${query.name}`);
  parts.push(compiled.fullSQL.trim());
  if (!compiled.fullSQL.trim().endsWith(";")) parts[parts.length - 1] += ";";
  return parts.join("\n");
}

/** Filter out scriptOnly steps (e.g. export_file) that can't run in WASM. */
function executableSteps(steps: Query["steps"]): Query["steps"] {
  return steps.filter((s) => {
    const def = getStepDef(s.stepKind);
    return !def?.scriptOnly;
  });
}

function yyyymmdd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchRows(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  return withConnection(async (conn) => {
    const table = await conn.query(sql);
    const columns = table.schema.fields.map((f) => f.name);
    const rows: unknown[][] = [];
    for (const row of table) {
      const arr: unknown[] = [];
      const rowObj = row as Record<string, unknown>;
      for (const col of columns) {
        const v = rowObj[col];
        arr.push(typeof v === "bigint" ? Number(v) : v);
      }
      rows.push(arr);
    }
    return { columns, rows };
  });
}

async function writeBytes(
  target: ExportTarget,
  relPath: string,
  bytes: Uint8Array,
  mime: string,
  downloadName: string,
): Promise<void> {
  if (target.kind === "folder") {
    const fullRel = target.subPath ? `${target.subPath}/${relPath}` : relPath;
    await writeFileToFolder(target.dir, fullRel, bytes);
  } else {
    downloadBytes(downloadName, bytes, mime);
  }
}

async function exportTabular(
  query: Query,
  allQueries: Query[],
  format: Exclude<ExportFormat, "xlsx">,
  target: ExportTarget,
  datePosition: DatePosition,
  extraOpts?: { delimiter?: string; compression?: string; includeHeader?: boolean },
): Promise<void> {
  const resolveQuery = createQueryResolver(allQueries);
  const steps = executableSteps(query.steps);
  if (steps.length === 0) throw new Error("No executable steps in this query.");
  const compiled = buildFull(steps, resolveQuery);
  const ext = format === "jsonl" ? "jsonl" : format;
  const fileName = buildExportFileName(query.name, ext, { datePosition });
  const stamp = `export_${Date.now()}.${ext}`;

  const header = extraOpts?.includeHeader !== false;
  const delim = extraOpts?.delimiter || ",";
  const comp = extraOpts?.compression || "none";

  const copyOpts =
    format === "csv"
      ? `(HEADER ${header}, DELIMITER '${delim}')`
    : format === "parquet"
      ? comp !== "none"
        ? `(FORMAT PARQUET, COMPRESSION ${comp.toUpperCase()})`
        : "(FORMAT PARQUET)"
    : format === "json" ? "(FORMAT JSON, ARRAY false)"
    : "(FORMAT JSON, LINES true)";

  await withConnection((conn) => conn.query(`COPY (${compiled.fullSQL}) TO '${stamp}' ${copyOpts}`));
  const bytes = await copyFileToBuffer(stamp);
  await dropFile(stamp).catch(() => {});
  const mime =
    format === "csv" ? "text/csv"
    : format === "json" || format === "jsonl" ? "application/json"
    : "application/octet-stream";
  await writeBytes(target, fileName, bytes, mime, fileName);
}

async function exportXlsx(
  query: Query,
  allQueries: Query[],
  target: ExportTarget,
  datePosition: DatePosition,
): Promise<void> {
  const resolveQuery = createQueryResolver(allQueries);
  const steps = executableSteps(query.steps);
  if (steps.length === 0) throw new Error("No executable steps in this query.");
  const compiled = buildFull(steps, resolveQuery);
  const { columns, rows } = await fetchRows(compiled.fullSQL);
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(query.name));
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const fileName = buildExportFileName(query.name, "xlsx", { datePosition });
  await writeBytes(target, fileName, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
}

function sanitizeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  return (name || "Sheet").replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Sheet";
}

export async function exportQuery(
  query: Query,
  allQueries: Query[],
  format: ExportFormat,
  target: ExportTarget = { kind: "download" },
  datePosition: DatePosition = "none",
  extraOpts?: { delimiter?: string; compression?: string; includeHeader?: boolean },
): Promise<void> {
  if (format === "xlsx") {
    await exportXlsx(query, allQueries, target, datePosition);
  } else {
    await exportTabular(query, allQueries, format, target, datePosition, extraOpts);
  }
}

export async function bulkExport(
  queryIds: string[],
  queries: Query[],
  format: ExportFormat,
  target: ExportTarget = { kind: "download" },
  datePosition: DatePosition = "none",
): Promise<void> {
  if (format === "xlsx" && target.kind === "download") {
    // Single workbook, one sheet per query, one download.
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    for (const id of queryIds) {
      const query = queries.find((q) => q.id === id);
      if (!query || query.steps.length === 0) continue;
      const steps = executableSteps(query.steps);
      if (steps.length === 0) continue;
      const resolveQuery = createQueryResolver(queries);
      const compiled = buildFull(steps, resolveQuery);
      const { columns, rows } = await fetchRows(compiled.fullSQL);
      const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
      let sheetName = sanitizeSheetName(query.name);
      let i = 2;
      while (used.has(sheetName)) { sheetName = `${sanitizeSheetName(query.name).slice(0, 28)}_${i++}`; }
      used.add(sheetName);
      XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    }
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    downloadBytes(buildExportFileName("export", "xlsx", { datePosition }), bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return;
  }
  for (const id of queryIds) {
    const query = queries.find((q) => q.id === id);
    if (!query || query.steps.length === 0) continue;
    await exportQuery(query, queries, format, target, datePosition);
  }
}

/** Download-SQL: one .sql file per non-empty query under a dated `<YYYYMMDD>_export/` folder. */
export async function exportDownloadSql(
  queries: Query[],
  connections: Connection[],
  target: ExportTarget,
): Promise<void> {
  const setup = aggregateConnectionGlobalSetup(connections);
  const folderName = `${yyyymmdd()}_export`;
  const nonEmpty = queries.filter((q) => q.steps.length > 0);
  const baseNames = uniqueSqlFileNames(nonEmpty.map((q) => sanitizeSqlFileName(q.name)));

  for (let i = 0; i < nonEmpty.length; i++) {
    const query = nonEmpty[i];
    const text = buildQuerySqlFile(query, queries, setup.setupSql);
    const bytes = new TextEncoder().encode(text);
    const relPath = `${baseNames[i]}.sql`;
    if (target.kind === "folder") {
      const fullRel = target.subPath ? `${target.subPath}/${folderName}/${relPath}` : `${folderName}/${relPath}`;
      await writeFileToFolder(target.dir, fullRel, bytes);
    } else {
      // Download fallback: prefix each file with the dated folder name.
      downloadBytes(`${folderName}/${relPath}`, bytes, "text/sql");
    }
  }
}