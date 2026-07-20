// Pure helpers for mapping a file (by name/extension) to a DuckDB reader SQL
// string and a sanitized virtual name. Ported from pwa_duckdb/js/duckdb-engine.js
// (buildFileReaderSql, buildFileSourceMeta, sanitizeVirtualName, minBytesForExt).
// These are pure so they can be unit-tested without a live DuckDB instance.

export function getExt(filename: string): string {
  const match = filename.match(/\.([^.]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

export function sanitizeVirtualName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Minimum registered-buffer byte length we consider a real file for a given ext. */
export function minBytesForExt(ext: string): number {
  if (ext === "parquet" || ext === "arrow") return 8;
  if (ext === "csv" || ext === "tsv" || ext === "json" || ext === "jsonl") return 1;
  if (ext === "sqlite" || ext === "db" || ext === "duckdb") return 16;
  return 1;
}

export const SUPPORTED_FILE_EXTS = [
  "csv", "tsv", "parquet", "json", "jsonl", "arrow", "orc", "avro",
  "xlsx", "xls", "sqlite", "db", "duckdb",
] as const;

export function isSupportedFileExt(ext: string): boolean {
  return (SUPPORTED_FILE_EXTS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Build the DuckDB reader SQL for a registered virtual file name.
 * For xlsx/xls the reader reads the JSON virtual name produced by SheetJS.
 */
export function buildFileReaderSql(
  virtualName: string,
  ext: string,
  jsonVirtualName: string | null = null,
): string {
  const v = virtualName;
  switch (ext) {
    case "csv":
      return `SELECT * FROM read_csv_auto('${v}')`;
    case "parquet":
      return `SELECT * FROM read_parquet('${v}')`;
    case "json":
    case "jsonl":
      return `SELECT * FROM read_json_auto('${v}')`;
    case "tsv":
      return `SELECT * FROM read_csv_auto('${v}', delim='\\t', header=true)`;
    case "arrow":
      return `SELECT * FROM read_parquet('${v}')`;
    case "orc":
      return `SELECT * FROM read_orc('${v}')`;
    case "avro":
      return `SELECT * FROM read_avro('${v}')`;
    case "sqlite":
    case "db":
      // For sqlite/db the engine ATTACHes and picks the first table; this
      // probe query is used to confirm registration. See resolveFileSourceSql.
      return `SELECT * FROM sqlite_master WHERE type='table' LIMIT 1`;
    case "duckdb":
      return `SELECT * FROM information_schema.tables LIMIT 1`;
    case "xlsx":
    case "xls": {
      const jsonName = jsonVirtualName ?? `${v}.json`;
      return `SELECT * FROM read_json_auto('${jsonName}')`;
    }
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

export interface FileSourceMeta {
  sourceName: string;
  sourceVirtual: string;
  jsonVirtualName: string | null;
  ext: string;
  sql: string;
}

export function buildFileSourceMeta(fileName: string): FileSourceMeta {
  const ext = getExt(fileName);
  const sourceVirtual = sanitizeVirtualName(fileName);
  const jsonVirtualName = ext === "xlsx" || ext === "xls" ? `${sourceVirtual}.json` : null;
  return {
    sourceName: fileName,
    sourceVirtual,
    jsonVirtualName,
    ext,
    sql: buildFileReaderSql(sourceVirtual, ext, jsonVirtualName),
  };
}