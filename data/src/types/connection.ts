// Connection type model (ported from pwa_duckdb/js/connection-catalog.js).
// A connection is either a `folder` (File System Access API, runnable in WASM)
// or a `server` kind (script-only — emitted for desktop DuckDB). The SQL/ATTACH
// builders live in src/connections/* (Phase 3); this module holds the type
// contracts and kind metadata shared by the engine, stores, and UI.

export type ConnectionCategory = "folder" | "server";

export type ConnectionKind =
  | "folder"
  | "postgres"
  | "mysql"
  | "sqlite"
  | "sqlserver"
  | "odbc"
  | "odbc_dsn"
  | "access"
  | "s3"
  | "http"
  | "https"
  | "gcs"
  | "azure"
  | "hdfs"
  | "iceberg"
  | "delta";

export type ConnectionFieldType = "text" | "password" | "checkbox";

export interface ConnectionField {
  id: string;
  label: string;
  type: ConnectionFieldType;
  placeholder?: string;
  required?: boolean;
}

export interface ConnDef {
  kind: ConnectionKind;
  label: string;
  category: ConnectionCategory;
  description?: string;
  /** Server kinds that cannot run in WASM. */
  scriptOnly?: boolean;
  defaultConfig: Record<string, unknown>;
  fields: ConnectionField[];
}

export interface Connection {
  id: string;
  kind: ConnectionKind;
  displayName: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** Runtime-only link status for folder connections (not persisted). */
  linkStatus?: FolderLinkStatus;
}

export const FOLDER_EXTENSIONS = [
  "csv", "tsv", "parquet", "json", "jsonl", "arrow", "orc", "avro",
  "xlsx", "xls", "sqlite", "db", "duckdb", "sql",
] as const;

export const SERVER_CONNECTION_KINDS: readonly ConnectionKind[] = [
  "postgres", "mysql", "sqlite", "sqlserver", "odbc", "odbc_dsn", "access",
  "s3", "http", "https", "gcs", "azure", "hdfs", "iceberg", "delta",
];

export const ODBC_CONNECTION_KINDS: readonly ConnectionKind[] = ["odbc", "odbc_dsn", "access"];

export function isServerConnectionKind(kind: ConnectionKind): boolean {
  return (SERVER_CONNECTION_KINDS as readonly string[]).includes(kind);
}

export function isOdbcConnectionKind(kind: ConnectionKind): boolean {
  return (ODBC_CONNECTION_KINDS as readonly string[]).includes(kind);
}

export function isFolderConnectionKind(kind: ConnectionKind): boolean {
  return kind === "folder";
}

export type FolderLinkStatus = "linked" | "missing_handle" | "permission_denied" | "unsupported";

export interface RecentSelection {
  kind: "file" | "table";
  connectionId: string;
  label: string;
  /** For file selections: relative path / virtual name. */
  relPath?: string;
  /** For table selections: schema.table */
  schema?: string;
  table?: string;
  ext?: string;
  querySql?: string;
  ts: number;
}

/** Cached manifest of supported files discovered inside a linked folder. */
export interface FolderFileManifestEntry {
  /** Path relative to the folder root. */
  relPath: string;
  /** File basename. */
  name: string;
  /** Lower-case extension. */
  ext: string;
  /** Virtual name registered with DuckDB (deterministic, based on relPath). */
  virtualName: string;
  /** For xlsx/xls, the virtual name of the derived JSON buffer. */
  jsonVirtualName: string | null;
}