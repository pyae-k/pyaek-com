// "Get Data" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (source_file, source_table,
// source_postgres, source_sqlserver, source_connection, source_folder_connection,
// folder_path) into typed StepDefs. Source steps do not reference `prev`.
//
// scriptOnly kinds (source_postgres, source_sqlserver, source_connection,
// folder_path) cannot run in WASM — their SQL is emitted for Download-SQL export
// against desktop DuckDB. uiOnly source_folder_connection is a placeholder that
// produces a non-runnable comment.

import type { StepDef } from "./types";
import { qIdent } from "./helpers";
import { buildFileReaderSql } from "../lib/fileReaders";
import { buildFolderFileQuerySql } from "../connections/kinds";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

interface SourceFileConfig {
  sourceName?: string;
  sourceVirtual?: string;
  ext?: string;
  jsonVirtualName?: string | null;
  querySql?: string;
  sql?: string;
  /** Folder connection path stored on the step. */
  folderPath?: string;
  /** Folder alias variable name used in portable scripts. */
  folderAlias?: string;
  /** Optional ATTACH SQL for sqlite/duckdb inside a folder. */
  attachSql?: string;
}

interface SourceTableConfig {
  schema?: string;
  table?: string;
}

interface SourcePostgresConfig {
  connectionId?: string;
  schema?: string;
  table?: string;
  querySql?: string;
}

interface SourceSqlserverConfig {
  connectionId?: string;
  schema?: string;
  table?: string;
  querySql?: string;
  scanSql?: string;
}

interface SourceConnectionConfig {
  connectionId?: string;
  connectionKind?: string;
  schema?: string;
  table?: string;
  path?: string;
  url?: string;
  querySql?: string;
}

interface FolderPathConfig {
  folderPath?: string;
  connectionId?: string;
}

// --- step definitions -------------------------------------------------------

export const getDataSteps: StepDef[] = [
  {
    kind: "source_file",
    category: "get_data",
    name: "Source from file",
    description: "Source CSV, Parquet, Excel, or JSON via path-based SQL",
    defaultConfig: { sourceName: "", sourceVirtual: "", ext: "csv" },
    buildSql(config, ctx) {
      const cfg = config as SourceFileConfig;
      const ext = cfg.ext || "csv";
      const virtualName = cfg.sourceVirtual || "";
      const folderPath = cfg.folderPath || "";
      const folderAlias = cfg.folderAlias || "";
      const portable = !!ctx?.portable;

      // Portable mode (desktop Download-SQL export): emit the folder-aware path
      // expression `getvariable('alias') || '/file'` so the script stays
      // portable across machines. Prefer the stored portable querySql, then the
      // folder form, then (last resort) the registered buffer name.
      if (portable) {
        if (cfg.querySql) return String(cfg.querySql);
        if (cfg.sql) return String(cfg.sql);
        if (folderPath) {
          return buildFolderFileQuerySql(folderPath, cfg.sourceName || virtualName, ext, {
            folderAlias: folderAlias || undefined,
          });
        }
        if (virtualName) return buildFileReaderSql(virtualName, ext, cfg.jsonVirtualName ?? null);
        return "SELECT 1 WHERE FALSE";
      }

      // Browser execution: read the registered virtual file buffer directly.
      // The portable querySql (getvariable('alias') || '/file') targets the
      // desktop filesystem and is not resolvable in-browser, so ignore it here
      // unless there is no registered buffer to fall back to.
      if (cfg.sql) return String(cfg.sql);
      if (virtualName) {
        return buildFileReaderSql(virtualName, ext, cfg.jsonVirtualName ?? null);
      }
      if (cfg.querySql) return String(cfg.querySql);
      if (folderPath) {
        return buildFolderFileQuerySql(folderPath, cfg.sourceName || virtualName, ext, {
          folderAlias: folderAlias || undefined,
        });
      }
      return "SELECT 1 WHERE FALSE";
    },
  },

  {
    kind: "source_table",
    category: "get_data",
    name: "Import from table",
    description: "Import from a DuckDB table",
    defaultConfig: { schema: "main", table: "" },
    buildSql(config) {
      const cfg = config as SourceTableConfig;
      const schema = cfg.schema || "main";
      const table = cfg.table || "";
      return `SELECT * FROM ${schema}.${qIdent(table)}`;
    },
  },

  {
    kind: "source_postgres",
    category: "get_data",
    name: "Import from PostgreSQL",
    description: "Script-only: generates ATTACH SQL for desktop DuckDB",
    scriptOnly: true,
    defaultConfig: {
      connectionId: "",
      schema: "public",
      table: "",
    },
    buildSql(config) {
      const cfg = config as SourcePostgresConfig;
      if (cfg.querySql) return String(cfg.querySql);
      const schema = cfg.schema || "public";
      const table = cfg.table || "table_name";
      return `SELECT * FROM pg.${schema}.${qIdent(table)}`;
    },
  },

  {
    kind: "source_sqlserver",
    category: "get_data",
    name: "Import from SQL Server",
    description: "Script-only: generates ODBC/mssql SQL for desktop DuckDB",
    scriptOnly: true,
    defaultConfig: {
      connectionId: "",
      schema: "dbo",
      table: "",
    },
    buildSql(config) {
      const cfg = config as SourceSqlserverConfig;
      if (cfg.querySql) return String(cfg.querySql);
      const schema = cfg.schema || "dbo";
      const table = cfg.table || "table_name";
      const scan = cfg.scanSql || `-- Configure connection in Connections manager`;
      return scan.includes("mssql_scan")
        ? scan
        : `SELECT * FROM ${schema}.${qIdent(table)}`;
    },
  },

  {
    kind: "source_connection",
    category: "get_data",
    name: "From connection",
    description:
      "Script-only: generates SQL for desktop DuckDB from a saved connection",
    scriptOnly: true,
    defaultConfig: {
      connectionId: "",
      connectionKind: "",
      schema: "public",
      table: "",
      path: "",
      url: "",
    },
    buildSql(config) {
      const cfg = config as SourceConnectionConfig;
      if (cfg.querySql) return String(cfg.querySql);
      const schema = cfg.schema || "public";
      const table = cfg.table || "table_name";
      return `SELECT * FROM ${schema}.${qIdent(table)}`;
    },
  },

  {
    kind: "source_folder_connection",
    category: "get_data",
    name: "From connection",
    description:
      "Pick a file or table from a saved folder or server connection",
    uiOnly: true,
    defaultConfig: {},
    buildSql() {
      return "-- Select a source from a connection";
    },
  },

  {
    kind: "folder_path",
    category: "get_data",
    name: "Set folder path",
    description: "Absolute folder path for SQL scripts",
    scriptOnly: true,
    defaultConfig: { folderPath: "", connectionId: "" },
    buildSql(config) {
      const cfg = config as FolderPathConfig;
      const path = cfg.folderPath || "";
      return path ? `-- Folder: ${path}` : "-- Set folder path";
    },
  },
];