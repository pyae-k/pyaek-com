// Connection catalog + SQL/ATTACH builders + folder-path helpers, ported from
// pwa_duckdb/js/connection-catalog.js into typed TypeScript.
//
// The catalog describes the `folder` kind plus 15 server kinds. The builders
// produce the DuckDB INSTALL/LOAD/ATTACH/SET SQL each kind needs. The folder
// helpers translate a folder connection + relative file path into a DuckDB
// path expression (`getvariable('alias') || '/rel/file.parquet'`) so a single
// script stays portable across machines.

import {
  FOLDER_EXTENSIONS,
  ODBC_CONNECTION_KINDS,
  isOdbcConnectionKind,
  type ConnectionField,
  type ConnectionKind,
  type ConnDef,
  type Connection,
} from "../types/connection";
import { buildFileReaderSql } from "../lib/fileReaders";
import type { Step } from "../types/query";

// ---------------------------------------------------------------------------
// Small string helpers
// ---------------------------------------------------------------------------

/** Quote a SQL identifier with double quotes, escaping embedded quotes. */
function qIdent(name: string): string {
  return `"${String(name ?? "").replace(/"/g, '""')}"`;
}

/** Escape single quotes for use inside a single-quoted SQL literal. */
function escSingle(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

/** Read a string-valued key from a loose config map (coercing non-strings). */
function cfgStr(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return String(v);
}

// ---------------------------------------------------------------------------
// Connection catalog
// ---------------------------------------------------------------------------

const FOLDER_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", placeholder: "Sales data folder", required: true },
];

const POSTGRES_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", placeholder: "Production PG", required: true },
  { id: "host", label: "Host", type: "text", placeholder: "localhost", required: true },
  { id: "port", label: "Port", type: "text", placeholder: "5432" },
  { id: "database", label: "Database", type: "text", placeholder: "mydb" },
  { id: "user", label: "User", type: "text", placeholder: "postgres" },
  { id: "password", label: "Password", type: "password", placeholder: "" },
];

const MYSQL_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "host", label: "Host", type: "text", placeholder: "localhost", required: true },
  { id: "port", label: "Port", type: "text", placeholder: "3306" },
  { id: "database", label: "Database", type: "text", placeholder: "mydb" },
  { id: "user", label: "User", type: "text", placeholder: "root" },
  { id: "password", label: "Password", type: "password" },
];

const SQLITE_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "path", label: "Database path", type: "text", placeholder: "/path/to/database.db", required: true },
];

const SQLSERVER_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "server", label: "Server", type: "text", placeholder: "localhost", required: true },
  { id: "database", label: "Database", type: "text", placeholder: "master" },
  { id: "user", label: "User", type: "text", placeholder: "sa" },
  { id: "password", label: "Password", type: "password" },
  { id: "driver", label: "ODBC driver", type: "text", placeholder: "ODBC Driver 18 for SQL Server" },
];

const ODBC_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "connectionString", label: "Connection string (override)", type: "text", placeholder: "Driver={...};Server=...;UID=...;PWD=...;" },
  { id: "driver", label: "ODBC driver", type: "text", placeholder: "ODBC Driver 17 for SQL Server" },
  { id: "server", label: "Server", type: "text", placeholder: "hostname" },
  { id: "database", label: "Database (optional)", type: "text", placeholder: "" },
  { id: "user", label: "User", type: "text", placeholder: "" },
  { id: "password", label: "Password", type: "password" },
  { id: "macroName", label: "Macro name (optional)", type: "text", placeholder: "src" },
  { id: "includeHttpfs", label: "Also load httpfs extension", type: "checkbox" },
];

const ODBC_DSN_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "dsn", label: "DSN name", type: "text", placeholder: "anc-active", required: true },
  { id: "macroName", label: "Macro name (optional)", type: "text", placeholder: "" },
];

const ACCESS_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "dbPath", label: "Database path (.accdb)", type: "text", placeholder: "T:/Databases/report.accdb", required: true },
  { id: "password", label: "Password", type: "password" },
  { id: "macroName", label: "Macro name (optional)", type: "text", placeholder: "src_access" },
  { id: "passwordMacroName", label: "Password macro name (optional)", type: "text", placeholder: "access_database_password" },
];

const S3_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "region", label: "Region", type: "text", placeholder: "us-east-1" },
  { id: "endpoint", label: "Endpoint (optional)", type: "text", placeholder: "" },
  { id: "accessKey", label: "Access key", type: "text" },
  { id: "secretKey", label: "Secret key", type: "password" },
  { id: "path", label: "S3 path", type: "text", placeholder: "s3://bucket/data/", required: true },
];

const HTTP_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "baseUrl", label: "Base URL", type: "text", placeholder: "https://example.com/data/", required: true },
];

const GCS_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "bucket", label: "Bucket", type: "text" },
  { id: "path", label: "GCS path", type: "text", placeholder: "gs://bucket/data/", required: true },
  { id: "credentials", label: "Credentials JSON path", type: "text" },
];

const AZURE_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "account", label: "Storage account", type: "text", required: true },
  { id: "container", label: "Container", type: "text" },
  { id: "path", label: "Blob path", type: "text", placeholder: "data/file.parquet" },
  { id: "sasOrKey", label: "SAS token or key", type: "password" },
];

const HDFS_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "host", label: "Host", type: "text", placeholder: "localhost", required: true },
  { id: "port", label: "Port", type: "text", placeholder: "9000" },
  { id: "path", label: "HDFS path", type: "text", placeholder: "/data/" },
];

const ICEBERG_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "catalog", label: "Catalog", type: "text", placeholder: "iceberg" },
  { id: "warehouse", label: "Warehouse path", type: "text", required: true },
  { id: "table", label: "Table", type: "text", placeholder: "schema.table" },
];

const DELTA_FIELDS: ConnectionField[] = [
  { id: "displayName", label: "Display name", type: "text", required: true },
  { id: "path", label: "Delta table path", type: "text", placeholder: "s3://bucket/delta_table/", required: true },
];

export const CONNECTION_CATALOG: ConnDef[] = [
  {
    kind: "folder",
    label: "Local folder",
    category: "folder",
    description: "Read CSV, Parquet, JSON, Excel, SQLite, DuckDB, and more from a folder",
    defaultConfig: {
      folderPath: "",
      folderName: "",
      allowedExtensions: [...FOLDER_EXTENSIONS],
      recentSelections: [],
    },
    fields: FOLDER_FIELDS,
  },
  {
    kind: "postgres",
    label: "PostgreSQL",
    category: "server",
    scriptOnly: true,
    defaultConfig: { host: "localhost", port: "5432", database: "postgres", user: "postgres", password: "", alias: "pg" },
    fields: POSTGRES_FIELDS,
  },
  {
    kind: "mysql",
    label: "MySQL",
    category: "server",
    scriptOnly: true,
    defaultConfig: { host: "localhost", port: "3306", database: "mysql", user: "root", password: "", alias: "mysql" },
    fields: MYSQL_FIELDS,
  },
  {
    kind: "sqlite",
    label: "SQLite",
    category: "server",
    scriptOnly: true,
    defaultConfig: { path: "/path/to/database.db", alias: "sqlite_db" },
    fields: SQLITE_FIELDS,
  },
  {
    kind: "sqlserver",
    label: "SQL Server",
    category: "server",
    scriptOnly: true,
    defaultConfig: {
      server: "localhost",
      database: "master",
      user: "sa",
      password: "",
      driver: "ODBC Driver 18 for SQL Server",
      alias: "mssql",
    },
    fields: SQLSERVER_FIELDS,
  },
  {
    kind: "odbc",
    label: "ODBC (connection string)",
    category: "server",
    scriptOnly: true,
    description: "Generic ODBC via odbc_query() — desktop DuckDB with odbc extension and system ODBC driver",
    defaultConfig: {
      server: "",
      database: "",
      user: "",
      password: "",
      driver: "ODBC Driver 17 for SQL Server",
      connectionString: "",
      macroName: "",
      includeHttpfs: false,
    },
    fields: ODBC_FIELDS,
  },
  {
    kind: "odbc_dsn",
    label: "ODBC (DSN)",
    category: "server",
    scriptOnly: true,
    description: "ODBC via system DSN — desktop DuckDB with odbc extension",
    defaultConfig: { dsn: "", macroName: "" },
    fields: ODBC_DSN_FIELDS,
  },
  {
    kind: "access",
    label: "Microsoft Access",
    category: "server",
    scriptOnly: true,
    description: "Access .mdb/.accdb via ODBC — desktop DuckDB with Microsoft Access ODBC driver",
    defaultConfig: { dbPath: "", password: "", macroName: "", passwordMacroName: "" },
    fields: ACCESS_FIELDS,
  },
  {
    kind: "s3",
    label: "Amazon S3",
    category: "server",
    scriptOnly: true,
    defaultConfig: { region: "us-east-1", endpoint: "", accessKey: "", secretKey: "", path: "s3://bucket/path/" },
    fields: S3_FIELDS,
  },
  {
    kind: "http",
    label: "HTTP",
    category: "server",
    scriptOnly: true,
    defaultConfig: { baseUrl: "https://example.com/data/" },
    fields: HTTP_FIELDS,
  },
  {
    kind: "https",
    label: "HTTPS",
    category: "server",
    scriptOnly: true,
    defaultConfig: { baseUrl: "https://example.com/data/" },
    fields: HTTP_FIELDS,
  },
  {
    kind: "gcs",
    label: "Google Cloud Storage",
    category: "server",
    scriptOnly: true,
    defaultConfig: { bucket: "", path: "gs://bucket/path/", credentials: "" },
    fields: GCS_FIELDS,
  },
  {
    kind: "azure",
    label: "Azure Blob",
    category: "server",
    scriptOnly: true,
    defaultConfig: { account: "", container: "", path: "", sasOrKey: "" },
    fields: AZURE_FIELDS,
  },
  {
    kind: "hdfs",
    label: "HDFS",
    category: "server",
    scriptOnly: true,
    defaultConfig: { host: "localhost", port: "9000", path: "/data/" },
    fields: HDFS_FIELDS,
  },
  {
    kind: "iceberg",
    label: "Iceberg",
    category: "server",
    scriptOnly: true,
    defaultConfig: { catalog: "iceberg", warehouse: "", table: "schema.table" },
    fields: ICEBERG_FIELDS,
  },
  {
    kind: "delta",
    label: "Delta Lake",
    category: "server",
    scriptOnly: true,
    defaultConfig: { path: "s3://bucket/delta_table/" },
    fields: DELTA_FIELDS,
  },
];

export const CONNECTION_BY_KIND: Record<ConnectionKind, ConnDef> = Object.fromEntries(
  CONNECTION_CATALOG.map((def) => [def.kind, def]),
) as Record<ConnectionKind, ConnDef>;

// ---------------------------------------------------------------------------
// SQL / ATTACH builders — server kinds
// ---------------------------------------------------------------------------

/** ATTACH-only fragment for a Postgres connection (no INSTALL/LOAD prefix). */
function postgresAttach(config: Record<string, unknown>): string {
  const host = cfgStr(config, "host") || "localhost";
  const port = cfgStr(config, "port") || "5432";
  const database = cfgStr(config, "database") || "postgres";
  const user = cfgStr(config, "user") || "postgres";
  const password = cfgStr(config, "password");
  const alias = cfgStr(config, "alias") || "pg";
  return `ATTACH 'host=${host} port=${port} dbname=${database} user=${user} password=${password}' AS ${alias} (TYPE POSTGRES);`;
}

export function buildPostgresAttachSql(config: Record<string, unknown>): string {
  return `INSTALL postgres;\nLOAD postgres;\n${postgresAttach(config)}`;
}

export function buildSqlServerSetupSql(): string {
  return "INSTALL mssql;\nLOAD mssql;";
}

/** ATTACH-only fragment for a SQL Server connection (no INSTALL/LOAD prefix). */
function sqlserverAttach(config: Record<string, unknown>): string {
  const server = cfgStr(config, "server") || cfgStr(config, "host") || "localhost";
  const database = cfgStr(config, "database") || "master";
  const user = cfgStr(config, "user") || "sa";
  const password = cfgStr(config, "password");
  const driver = cfgStr(config, "driver") || "ODBC Driver 18 for SQL Server";
  const alias = cfgStr(config, "alias") || "mssql";
  const connStr = `Driver={${driver}};Server=${server};Database=${database};Uid=${user};Pwd=${password}`;
  return `ATTACH '${escSingle(connStr)}' AS ${alias} (TYPE mssql);`;
}

export function buildSqlServerAttachSql(config: Record<string, unknown>): string {
  return `${buildSqlServerSetupSql()}\n${sqlserverAttach(config)}`;
}

/** ATTACH-only fragment for a MySQL connection (no INSTALL/LOAD prefix). */
function mysqlAttach(config: Record<string, unknown>): string {
  const host = cfgStr(config, "host") || "localhost";
  const port = cfgStr(config, "port") || "3306";
  const database = cfgStr(config, "database") || "mysql";
  const user = cfgStr(config, "user") || "root";
  const password = cfgStr(config, "password");
  const alias = cfgStr(config, "alias") || "mysql";
  return `ATTACH 'host=${host} port=${port} user=${user} password=${password} database=${database}' AS ${alias} (TYPE MYSQL);`;
}

export function buildMysqlAttachSql(config: Record<string, unknown>): string {
  return `INSTALL mysql;\nLOAD mysql;\n${mysqlAttach(config)}`;
}

/** ATTACH-only fragment for a SQLite connection (no INSTALL/LOAD prefix). */
function sqliteAttach(config: Record<string, unknown>): string {
  const path = cfgStr(config, "path") || "/path/to/database.db";
  const alias = cfgStr(config, "alias") || "sqlite_db";
  return `ATTACH '${escSingle(path)}' AS ${alias} (TYPE SQLITE);`;
}

export function buildSqliteAttachSql(config: Record<string, unknown>): string {
  return `INSTALL sqlite;\nLOAD sqlite;\n${sqliteAttach(config)}`;
}

/** Per-connection SET lines for an S3 connection (region/endpoint/credentials). */
function s3SetLines(config: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const region = cfgStr(config, "region");
  if (region) lines.push(`SET s3_region='${escSingle(region)}';`);
  const endpoint = cfgStr(config, "endpoint");
  if (endpoint) lines.push(`SET s3_endpoint='${escSingle(endpoint)}';`);
  const accessKey = cfgStr(config, "accessKey");
  if (accessKey) lines.push(`SET s3_access_key_id='${escSingle(accessKey)}';`);
  const secretKey = cfgStr(config, "secretKey");
  if (secretKey) lines.push(`SET s3_secret_access_key='${escSingle(secretKey)}';`);
  return lines;
}

export function buildS3SetupSql(config: Record<string, unknown>): string {
  return ["INSTALL httpfs;", "LOAD httpfs;", ...s3SetLines(config)].join("\n");
}

export function buildHttpSetupSql(): string {
  return "INSTALL httpfs;\nLOAD httpfs;";
}

/** Per-connection SET lines for a GCS connection (credentials). */
function gcsSetLines(config: Record<string, unknown>): string[] {
  const credentials = cfgStr(config, "credentials");
  return credentials ? [`SET gcs_credentials='${escSingle(credentials)}';`] : [];
}

export function buildGcsSetupSql(config: Record<string, unknown>): string {
  return ["INSTALL httpfs;", "LOAD httpfs;", ...gcsSetLines(config)].join("\n");
}

/** Per-connection SET lines for an Azure connection. */
function azureSetLines(config: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const account = cfgStr(config, "account");
  if (account) lines.push(`SET azure_storage_account='${escSingle(account)}';`);
  const sasOrKey = cfgStr(config, "sasOrKey");
  if (sasOrKey) lines.push(`SET azure_storage_connection_string='${escSingle(sasOrKey)}';`);
  return lines;
}

export function buildAzureSetupSql(config: Record<string, unknown>): string {
  return ["INSTALL azure;", "LOAD azure;", ...azureSetLines(config)].join("\n");
}

export function buildHdfsSetupSql(config: Record<string, unknown>): string {
  const host = cfgStr(config, "host") || "localhost";
  const port = cfgStr(config, "port") || "9000";
  return `INSTALL hdfs;\nLOAD hdfs;\n-- HDFS namenode: ${host}:${port}`;
}

/** Per-connection fragment for an Iceberg connection (SECRET + catalog comment). */
function icebergAttach(config: Record<string, unknown>): string {
  const catalog = cfgStr(config, "catalog") || "iceberg";
  const warehouse = cfgStr(config, "warehouse");
  return `CREATE SECRET IF NOT EXISTS iceberg_secret (TYPE ICEBERG, WAREHOUSE '${escSingle(warehouse)}');\n-- Catalog: ${catalog}`;
}

export function buildIcebergSetupSql(config: Record<string, unknown>): string {
  return `INSTALL iceberg;\nLOAD iceberg;\n${icebergAttach(config)}`;
}

export function buildDeltaSetupSql(): string {
  return "INSTALL delta;\nLOAD delta;";
}

// ---------------------------------------------------------------------------
// ODBC helpers (extension load + macro definitions)
// ---------------------------------------------------------------------------

export function buildOdbcExtensionSql(): string {
  return "INSTALL odbc;\nLOAD odbc;";
}

export function buildOdbcConnStr(config: Record<string, unknown>): string {
  const override = cfgStr(config, "connectionString").trim();
  if (override) return override;
  const parts: string[] = [];
  const driver = cfgStr(config, "driver") || "ODBC Driver 17 for SQL Server";
  if (driver) parts.push(`Driver={${driver}}`);
  const server = cfgStr(config, "server");
  if (server) parts.push(`Server=${server}`);
  const database = cfgStr(config, "database");
  if (database) parts.push(`Database=${database}`);
  const user = cfgStr(config, "user");
  if (user) parts.push(`UID=${user}`);
  const password = cfgStr(config, "password");
  if (password) parts.push(`PWD=${password}`);
  return parts.length ? `${parts.join(";")};` : "";
}

export function buildAccessConnStr(config: Record<string, unknown>): string {
  const driver = "Microsoft Access Driver (*.mdb, *.accdb)";
  const dbPath = cfgStr(config, "dbPath");
  let connStr = `Driver={${driver}};DBQ=${dbPath};`;
  const password = cfgStr(config, "password");
  if (password) connStr += `PWD=${password};`;
  return connStr;
}

function buildDsnConnStr(dsn: string): string {
  return `DSN=${dsn ?? ""}`;
}

function buildOdbcMacroSql(macroName: string, connStr: string): string {
  return `CREATE OR REPLACE MACRO ${macroName}(q) AS TABLE (
    SELECT *
    FROM odbc_query(
        '${escSingle(connStr)}',
        q
    )
);`;
}

function buildAccessPasswordMacroSql(macroName: string, password: string): string {
  return `CREATE OR REPLACE MACRO ${macroName}() AS '${escSingle(password)}';`;
}

function buildAccessMacroSql(config: Record<string, unknown>): string {
  const macroName = cfgStr(config, "macroName").trim() || "src_access";
  const dbPath = cfgStr(config, "dbPath");
  const driver = "Microsoft Access Driver (*.mdb, *.accdb)";
  const passwordMacroName = cfgStr(config, "passwordMacroName").trim();

  if (passwordMacroName) {
    return `CREATE OR REPLACE MACRO ${macroName}(q) AS TABLE (
    SELECT *
    FROM odbc_query(
        'Driver={${driver}};DBQ=${escSingle(dbPath)};'
        || CASE
            WHEN ${passwordMacroName}() = '' THEN ''
            ELSE 'PWD=' || ${passwordMacroName}() || ';'
        END,
        q
    )
);`;
  }
  return buildOdbcMacroSql(macroName, buildAccessConnStr(config));
}

interface MacroDef {
  key: string;
  sql: string;
}

/** ODBC/Access macro definitions for a connection (used in global setup). */
function getConnectionMacroDefinitions(kind: ConnectionKind, config: Record<string, unknown>): MacroDef[] {
  const macros: MacroDef[] = [];
  const cfg = config || {};

  if (kind === "odbc") {
    const macroName = cfgStr(cfg, "macroName").trim();
    if (macroName) {
      macros.push({ key: `macro:${macroName}`, sql: buildOdbcMacroSql(macroName, buildOdbcConnStr(cfg)) });
    }
  }

  if (kind === "odbc_dsn") {
    const macroName = cfgStr(cfg, "macroName").trim();
    if (macroName) {
      macros.push({ key: `macro:${macroName}`, sql: buildOdbcMacroSql(macroName, buildDsnConnStr(cfgStr(cfg, "dsn"))) });
    }
  }

  if (kind === "access") {
    const passwordMacroName = cfgStr(cfg, "passwordMacroName").trim();
    if (passwordMacroName) {
      macros.push({
        key: `macro:${passwordMacroName}`,
        sql: buildAccessPasswordMacroSql(passwordMacroName, cfgStr(cfg, "password")),
      });
    }
    const macroName = cfgStr(cfg, "macroName").trim();
    if (macroName) {
      macros.push({ key: `macro:${macroName}`, sql: buildAccessMacroSql(cfg) });
    }
  }

  return macros;
}

// ---------------------------------------------------------------------------
// Folder path helpers
// ---------------------------------------------------------------------------

/** Join a folder path and a relative file name using the path's separator. */
export function joinFolderPath(folderPath: string, fileName: string): string {
  const base = String(folderPath ?? "").replace(/[/\\]+$/, "");
  const name = String(fileName ?? "").replace(/^[/\\]+/, "");
  if (!base) return name;
  if (!name) return base;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${name}`;
}

function sanitizeFolderAlias(name: string): string {
  let s = String(name ?? "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s) return "";
  if (/^[0-9]/.test(s)) s = `folder_${s}`;
  return s.slice(0, 64);
}

/** Short SQL variable name for a folder connection (e.g. folder1, sales). */
export function getFolderConnectionAlias(config: Record<string, unknown> | undefined, fallback = "folder1"): string {
  const cfg = config ?? {};
  const folderAlias = cfgStr(cfg, "folderAlias").trim();
  if (folderAlias) return sanitizeFolderAlias(folderAlias) || fallback;
  const fromName = sanitizeFolderAlias(cfgStr(cfg, "folderName"));
  if (fromName) return fromName;
  const path = cfgStr(cfg, "folderPath").replace(/[/\\]+$/, "");
  const base = path.split(/[/\\]/).pop() ?? "";
  return sanitizeFolderAlias(base) || fallback;
}

/**
 * DuckDB path expression: `getvariable('alias') || '/rel/file.parquet'`.
 * Pass an empty alias to get a plain quoted literal `'/folder/rel/file.parquet'`.
 */
export function buildFolderPathExpr(folderPath: string, fileName: string, alias: string): string {
  const name = String(fileName ?? "").replace(/^[/\\]+/, "");
  const fp = String(folderPath ?? "");
  const sep = fp.includes("\\") && !fp.includes("/") ? "\\\\" : "/";
  if (!alias) return `'${escSingle(joinFolderPath(folderPath, name))}'`;
  if (!name) return `getvariable('${escSingle(alias)}')`;
  return `getvariable('${escSingle(alias)}') || '${sep}${escSingle(name)}'`;
}

/** Folder path recorded on a pipeline's steps (folder_path or source_file). */
export function getFolderPathFromSteps(steps: Step[]): string | null {
  const list = steps ?? [];
  const fp = list.find((s) => s.stepKind === "folder_path");
  const fpPath = fp ? cfgStr(fp.config, "folderPath").trim() : "";
  if (fpPath) return fpPath;
  const src = list.find((s) => s.stepKind === "source_file");
  const srcPath = src ? cfgStr(src.config, "folderPath").trim() : "";
  return srcPath || null;
}

/** Relative path of a source_file step (relPath or sourceName). */
export function getSourceFileRelPath(step: Step | null | undefined): string | null {
  if (!step) return null;
  const rel = cfgStr(step.config, "relPath");
  if (rel) return rel;
  const sourceName = cfgStr(step.config, "sourceName");
  return sourceName || null;
}

export function resolveFolderPathForSource(
  steps: Step[],
  connConfig: Record<string, unknown> | undefined,
  sourceStep: Step | null = null,
): string {
  const cfg = connConfig ?? {};
  // Connection path is authoritative when the step is linked to a folder connection.
  const hasConnectionId = sourceStep
    ? Boolean(cfgStr(sourceStep.config, "connectionId").trim())
    : false;
  const connFolderPath = cfgStr(cfg, "folderPath").trim();
  if (hasConnectionId && connFolderPath) return connFolderPath;
  if (sourceStep) {
    const stepFolderPath = cfgStr(sourceStep.config, "folderPath").trim();
    if (stepFolderPath) return stepFolderPath;
  }
  return getFolderPathFromSteps(steps) ?? connFolderPath ?? cfgStr(cfg, "folderName");
}

// ---------------------------------------------------------------------------
// Folder connection setup + file query builders
// ---------------------------------------------------------------------------

export function buildFolderSetupSql(config: Record<string, unknown> | undefined): string {
  const cfg = config ?? {};
  const path = (cfgStr(cfg, "folderPath") || cfgStr(cfg, "folderName")).replace(/[/\\]+$/, "");
  const alias = getFolderConnectionAlias(cfg);
  if (!path) return "-- Set folder path in Connections manager";
  const header = `-- Folder connection: ${path} as ${alias}`;
  const setVar = `SET VARIABLE ${alias} = '${escSingle(path)}';`;
  if (!cfgStr(cfg, "folderPath") && cfgStr(cfg, "folderName")) {
    return `${header}\n-- Warning: set an explicit folder path in Connections for portable SQL scripts\n${setVar}`;
  }
  return `${header}\n${setVar}`;
}

/**
 * Reader SQL for a path *expression* (not a quoted literal). Used when a
 * folder alias is set: `read_csv_auto(getvariable('folder1') || '/f.csv')`.
 */
function buildFileReaderSqlForPathExpr(
  pathExpr: string,
  ext: string,
  jsonPathExpr: string | null = null,
  sqliteAlias: string | null = null,
): string {
  switch (ext) {
    case "csv":
      return `SELECT * FROM read_csv_auto(${pathExpr})`;
    case "parquet":
      return `SELECT * FROM read_parquet(${pathExpr})`;
    case "json":
    case "jsonl":
      return `SELECT * FROM read_json_auto(${pathExpr})`;
    case "tsv":
      return `SELECT * FROM read_csv_auto(${pathExpr}, delim='\\t', header=true)`;
    case "arrow":
      return `SELECT * FROM read_parquet(${pathExpr})`;
    case "orc":
      return `SELECT * FROM read_orc(${pathExpr})`;
    case "avro":
      return `SELECT * FROM read_avro(${pathExpr})`;
    case "xlsx":
    case "xls": {
      const jsonExpr = jsonPathExpr ?? `(${pathExpr} || '.json')`;
      return `SELECT * FROM read_json_auto(${jsonExpr})`;
    }
    case "sqlite":
    case "db": {
      const alias = sqliteAlias ?? "folder_sqlite";
      return `SELECT * FROM ${alias}.main.sqlite_master WHERE type='table' LIMIT 1`;
    }
    case "duckdb":
      return `SELECT * FROM folder_src.information_schema.tables LIMIT 1`;
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

export function buildFolderSqliteAttachSql(
  folderPath: string,
  fileName: string,
  alias = "folder_sqlite",
  folderAlias: string | null = null,
): string {
  const pathExpr = buildFolderPathExpr(folderPath, fileName, folderAlias ?? "");
  return `INSTALL sqlite;\nLOAD sqlite;\nATTACH ${pathExpr} AS ${alias} (TYPE SQLITE);`;
}

export function buildFolderSqliteQuerySql(tableName: string, alias = "folder_sqlite"): string {
  return `SELECT * FROM ${alias}.main.${qIdent(tableName)}`;
}

export function buildFolderDuckdbAttachSql(
  folderPath: string,
  fileName: string,
  alias = "folder_src",
  folderAlias: string | null = null,
): string {
  const pathExpr = buildFolderPathExpr(folderPath, fileName, folderAlias ?? "");
  return `ATTACH ${pathExpr} AS ${alias} (TYPE DUCKDB, READ_ONLY);`;
}

export function buildFolderDuckdbQuerySql(schema: string, table: string, alias = "folder_src"): string {
  return `SELECT * FROM ${alias}.${schema}.${qIdent(table)}`;
}

export interface FolderFileQueryOptions {
  schema?: string;
  table?: string;
  tableName?: string;
  sqlText?: string;
  folderAlias?: string;
  sqliteAlias?: string;
  duckdbAlias?: string;
}

/** Build the SELECT query for a file inside a folder connection. */
export function buildFolderFileQuerySql(
  folderPath: string,
  fileName: string,
  ext: string,
  options: FolderFileQueryOptions = {},
): string {
  if (ext === "sql") {
    return options.sqlText?.trim() || "-- Empty SQL script";
  }
  const folderAlias = options.folderAlias ?? null;

  if (ext === "sqlite" || ext === "db") {
    const table = options.tableName;
    if (table) return buildFolderSqliteQuerySql(table, options.sqliteAlias ?? "folder_sqlite");
    return buildFileReaderSqlForPathExpr(
      buildFolderPathExpr(folderPath, fileName, folderAlias ?? ""),
      ext,
      null,
      options.sqliteAlias ?? null,
    );
  }

  if (ext === "duckdb") {
    if (options.schema && options.table) {
      return buildFolderDuckdbQuerySql(options.schema, options.table, options.duckdbAlias ?? "folder_src");
    }
    return buildFileReaderSqlForPathExpr(buildFolderPathExpr(folderPath, fileName, folderAlias ?? ""), ext);
  }

  // File-reader extensions (csv/parquet/json/tsv/arrow/orc/avro/xlsx/xls).
  if (folderAlias) {
    return buildFileReaderSqlForPathExpr(buildFolderPathExpr(folderPath, fileName, folderAlias), ext);
  }
  // No folder alias → plain quoted literal; reuse the shared reader builder.
  const joined = joinFolderPath(folderPath, fileName);
  const jsonName = ext === "xlsx" || ext === "xls" ? `${joined}.json` : null;
  return buildFileReaderSql(joined, ext, jsonName);
}

/** ATTACH SQL for a folder-hosted SQLite/DuckDB file (empty for other exts). */
export function buildFolderFileAttachSql(
  folderPath: string,
  fileName: string,
  ext: string,
  options: FolderFileQueryOptions = {},
): string {
  const folderAlias = options.folderAlias ?? null;
  if (ext === "sqlite" || ext === "db") {
    return buildFolderSqliteAttachSql(folderPath, fileName, options.sqliteAlias ?? "folder_sqlite", folderAlias);
  }
  if (ext === "duckdb") {
    return buildFolderDuckdbAttachSql(folderPath, fileName, options.duckdbAlias ?? "folder_src", folderAlias);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Global setup aggregation
// ---------------------------------------------------------------------------

interface ConnectionSetupParts {
  /** INSTALL/LOAD lines that can be deduped globally. */
  globalLines: string[];
  /** Per-connection ATTACH/SET SQL (goes into attachSqlByConnectionId). */
  attachSql: string;
  /** Folder `SET VARIABLE` block (one per folder connection, goes into setupSql). */
  folderSetVar: string | null;
  /** ODBC/Access macro definitions (deduped by key into setupSql). */
  macros: MacroDef[];
}

/** Compute the per-connection setup/attach split for one connection. */
function connectionSetupParts(conn: Connection): ConnectionSetupParts {
  const cfg = conn.config ?? {};
  switch (conn.kind) {
    case "folder":
      return {
        globalLines: [],
        attachSql: "",
        folderSetVar: buildFolderSetupSql(cfg),
        macros: [],
      };
    case "postgres":
      return { globalLines: ["INSTALL postgres;", "LOAD postgres;"], attachSql: postgresAttach(cfg), folderSetVar: null, macros: [] };
    case "mysql":
      return { globalLines: ["INSTALL mysql;", "LOAD mysql;"], attachSql: mysqlAttach(cfg), folderSetVar: null, macros: [] };
    case "sqlite":
      return { globalLines: ["INSTALL sqlite;", "LOAD sqlite;"], attachSql: sqliteAttach(cfg), folderSetVar: null, macros: [] };
    case "sqlserver":
      return { globalLines: ["INSTALL mssql;", "LOAD mssql;"], attachSql: sqlserverAttach(cfg), folderSetVar: null, macros: [] };
    case "s3":
      return { globalLines: ["INSTALL httpfs;", "LOAD httpfs;"], attachSql: s3SetLines(cfg).join("\n"), folderSetVar: null, macros: [] };
    case "http":
    case "https":
      return { globalLines: ["INSTALL httpfs;", "LOAD httpfs;"], attachSql: "", folderSetVar: null, macros: [] };
    case "gcs":
      return { globalLines: ["INSTALL httpfs;", "LOAD httpfs;"], attachSql: gcsSetLines(cfg).join("\n"), folderSetVar: null, macros: [] };
    case "azure":
      return { globalLines: ["INSTALL azure;", "LOAD azure;"], attachSql: azureSetLines(cfg).join("\n"), folderSetVar: null, macros: [] };
    case "hdfs": {
      const host = cfgStr(cfg, "host") || "localhost";
      const port = cfgStr(cfg, "port") || "9000";
      return { globalLines: ["INSTALL hdfs;", "LOAD hdfs;"], attachSql: `-- HDFS namenode: ${host}:${port}`, folderSetVar: null, macros: [] };
    }
    case "iceberg":
      return { globalLines: ["INSTALL iceberg;", "LOAD iceberg;"], attachSql: icebergAttach(cfg), folderSetVar: null, macros: [] };
    case "delta":
      return { globalLines: ["INSTALL delta;", "LOAD delta;"], attachSql: "", folderSetVar: null, macros: [] };
    case "odbc": {
      const lines = ["INSTALL odbc;", "LOAD odbc;"];
      if (cfg.includeHttpfs) lines.push("INSTALL httpfs;", "LOAD httpfs;");
      return { globalLines: lines, attachSql: "", folderSetVar: null, macros: getConnectionMacroDefinitions("odbc", cfg) };
    }
    case "odbc_dsn":
      return { globalLines: ["INSTALL odbc;", "LOAD odbc;"], attachSql: "", folderSetVar: null, macros: getConnectionMacroDefinitions("odbc_dsn", cfg) };
    case "access":
      return { globalLines: ["INSTALL odbc;", "LOAD odbc;"], attachSql: "", folderSetVar: null, macros: getConnectionMacroDefinitions("access", cfg) };
    default:
      return { globalLines: [], attachSql: "", folderSetVar: null, macros: [] };
  }
}

export interface GlobalSetupResult {
  setupSql: string;
  attachSqlByConnectionId: Record<string, string>;
}

/**
 * Aggregate global setup SQL for a list of connections.
 *
 * Builds `SET VARIABLE` statements for folder connections, loads the httpfs
 * (and other) extensions where needed, dedups repeated INSTALL/LOAD lines and
 * ODBC macros, and returns the per-connection ATTACH/SET SQL keyed by
 * connection id. The `setupSql` is run once before any pipeline; each
 * connection's `attachSql` is run when that connection is first used.
 */
export function aggregateConnectionGlobalSetup(connections: Connection[]): GlobalSetupResult {
  const conns = connections ?? [];
  const globalSet = new Set<string>();
  const folderSetVars: string[] = [];
  const macroMap = new Map<string, string>();
  const attachSqlByConnectionId: Record<string, string> = {};

  for (const conn of conns) {
    const parts = connectionSetupParts(conn);
    for (const line of parts.globalLines) globalSet.add(line);
    if (parts.folderSetVar) folderSetVars.push(parts.folderSetVar);
    for (const m of parts.macros) macroMap.set(m.key, m.sql);
    attachSqlByConnectionId[conn.id] = parts.attachSql;
  }

  const setupParts: string[] = [];
  if (globalSet.size) setupParts.push([...globalSet].join("\n"));
  if (folderSetVars.length) setupParts.push(folderSetVars.join("\n"));
  if (macroMap.size) setupParts.push([...macroMap.values()].join("\n\n"));

  const setupSql = setupParts.filter(Boolean).join("\n\n");
  return { setupSql, attachSqlByConnectionId };
}

// Re-export kind predicates so consumers can import everything from here.
export { isOdbcConnectionKind, ODBC_CONNECTION_KINDS };