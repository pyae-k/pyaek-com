// DuckDB-Wasm engine: lazy singleton, pooled connections, file registration,
// copyFileToBuffer wrapper, and ATTACH helpers. Ported and extended from
// pwa_duckdb's duckdb-file.js + duckdb-engine.js, using pwa_etl's self-hosted
// wasm (public/duckdb/) via the base-path-aware assetUrl so subpath deploys work.

import { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { assetUrl } from "./basePath";

const POOL_SIZE = 4;

let dbInstance: AsyncDuckDB | null = null;
/** Primary connection (back-compat with getDuckDB). */
let primaryConn: AsyncDuckDBConnection | null = null;
const pool: AsyncDuckDBConnection[] = [];
const poolWaiters: Array<(c: AsyncDuckDBConnection) => void> = [];
let initPromise: Promise<AsyncDuckDBConnection> | null = null;
let initError: string | null = null;

const attachedAliases = new Set<string>();

class VoidLogger {
  log() {}
}

function workerUrl(): string {
  return assetUrl("duckdb/duckdb-browser-eh.worker.js");
}
function wasmUrl(): string {
  return assetUrl("duckdb/duckdb-eh.wasm");
}

/** Primary connection (shared). Use withConnection for borrowed pooled connections. */
export async function getDuckDB(): Promise<AsyncDuckDBConnection> {
  if (primaryConn) return primaryConn;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const worker = new Worker(new URL(workerUrl(), window.location.origin));
    dbInstance = new AsyncDuckDB(new VoidLogger() as never, worker);
    await dbInstance.instantiate(wasmUrl());
    await dbInstance.open({ path: ":memory:" });
    primaryConn = await dbInstance.connect();
    for (let i = 0; i < POOL_SIZE; i++) pool.push(await dbInstance.connect());
    initError = null;
    return primaryConn;
  })().catch((e) => {
    initError = e instanceof Error ? e.message : String(e);
    initPromise = null;
    throw e;
  });
  return initPromise;
}

export async function getDuckDBInstance(): Promise<AsyncDuckDB> {
  await getDuckDB();
  return dbInstance!;
}

/** Borrow a pooled connection, run `fn`, and return it to the pool. */
export async function withConnection<T>(
  fn: (conn: AsyncDuckDBConnection) => Promise<T>,
): Promise<T> {
  await getDuckDB();
  const conn = await acquire();
  try {
    return await fn(conn);
  } finally {
    release(conn);
  }
}

function acquire(): Promise<AsyncDuckDBConnection> {
  const c = pool.pop();
  if (c) return Promise.resolve(c);
  return new Promise<AsyncDuckDBConnection>((resolve) => poolWaiters.push(resolve));
}

function release(conn: AsyncDuckDBConnection): void {
  const waiter = poolWaiters.shift();
  if (waiter) waiter(conn);
  else pool.push(conn);
}

export function isDuckDBReady(): boolean {
  return primaryConn !== null;
}

export function getDuckDBError(): string | null {
  return initError;
}

/** Clear the ATTACH alias tracking (e.g. on project load / reconnect). */
export function resetEngineSession(): void {
  attachedAliases.clear();
}

// --- file registration (operate on the AsyncDuckDB instance) -----------------

export async function registerFileBuffer(name: string, bytes: Uint8Array): Promise<void> {
  const db = await getDuckDBInstance();
  await db.registerFileBuffer(name, bytes);
}

export async function registerFileText(name: string, text: string): Promise<void> {
  const db = await getDuckDBInstance();
  await db.registerFileText(name, text);
}

export async function copyFileToBuffer(name: string): Promise<Uint8Array> {
  const db = await getDuckDBInstance();
  return db.copyFileToBuffer(name);
}

export async function dropFile(name: string): Promise<void> {
  const db = await getDuckDBInstance();
  await db.dropFile(name);
}

// --- ATTACH helpers ---------------------------------------------------------

function safeAlias(alias: string): string {
  return alias.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function hasAlias(alias: string): boolean {
  return attachedAliases.has(safeAlias(alias));
}

/**
 * Run an ATTACH (or any setup SQL) once per alias, deduping across the session.
 * Returns true if the SQL was actually executed, false if the alias was already attached.
 */
export async function attachAlias(alias: string, sql: string): Promise<boolean> {
  const a = safeAlias(alias);
  if (attachedAliases.has(a)) return false;
  await withConnection((c) => c.query(sql));
  attachedAliases.add(a);
  return true;
}

export async function runSetup(sql: string): Promise<void> {
  await withConnection((c) => c.query(sql));
}

// --- table helpers ----------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function singleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function tableExists(schema: string, tableName: string): Promise<boolean> {
  return withConnection(async (c) => {
    const result = await c.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = ${singleQuote(schema || "main")}
        AND table_name = ${singleQuote(tableName)}
    `);
    const rows = result.toArray();
    return Number(rows[0]?.cnt) > 0;
  });
}

export async function getTableColumns(
  schema: string,
  tableName: string,
): Promise<{ name: string; type: string }[]> {
  return withConnection(async (c) => {
    const result = await c.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = ${singleQuote(schema)} AND table_name = ${singleQuote(tableName)}
      ORDER BY ordinal_position
    `);
    return result.toArray().map((r) => ({
      name: String(r.column_name),
      type: String(r.data_type),
    }));
  });
}

export async function listSessionTables(): Promise<
  { schema: string; name: string; type: string }[]
> {
  return withConnection(async (c) => {
    const result = await c.query(`
      SELECT table_schema AS schema_name, table_name AS object_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_schema, table_name
    `);
    return result.toArray().map((r) => ({
      schema: String(r.schema_name),
      name: String(r.object_name),
      type: String(r.table_type),
    }));
  });
}

export async function createTableFromSql(
  tableName: string,
  sql: string,
  schema = "main",
): Promise<void> {
  const cleaned = sql.trim().replace(/;\s*$/, "");
  await withConnection((c) =>
    c.query(`CREATE OR REPLACE TABLE ${schema}.${quoteIdent(tableName)} AS ${cleaned}`),
  );
}

export async function dropTableIfExists(tableName: string, schema = "main"): Promise<void> {
  await withConnection((c) => c.query(`DROP TABLE IF EXISTS ${schema}.${quoteIdent(tableName)}`));
}

const EMPTY_TABLE_SELECT = "SELECT CAST(NULL AS VARCHAR) AS _placeholder WHERE FALSE";

export async function createEmptyTable(tableName: string, schema = "main"): Promise<void> {
  await createTableFromSql(tableName, EMPTY_TABLE_SELECT, schema);
}

/** List base tables in an ATTACHed DuckDB file alias. */
export async function listAttachedDuckdbTables(
  virtualName: string,
  alias: string,
): Promise<{ schema: string; table: string; sql: string }[]> {
  const a = safeAlias(alias);
  await attachAlias(a, `ATTACH '${virtualName}' AS ${a} (READ_ONLY)`);
  return withConnection(async (c) => {
    const result = await c.query(`
      SELECT table_schema, table_name
      FROM ${a}.information_schema.tables
      WHERE table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);
    return result.toArray().map((r) => ({
      schema: String(r.table_schema),
      table: String(r.table_name),
      sql: `SELECT * FROM ${a}.${r.table_schema}.${quoteIdent(String(r.table_name))}`,
    }));
  });
}