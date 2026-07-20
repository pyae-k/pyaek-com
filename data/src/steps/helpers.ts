// Shared, pure SQL-string builder helpers used by every step category.
// Ported from pwa_duckdb/js/step-catalog.js (lines ~1-560). No DOM, no DuckDB,
// no React, no formula/date-type imports — self-contained so each step module
// can depend on it without pulling in the rest of the catalog.

/** Quote a SQL identifier, doubling embedded `"`. */
export function qIdent(name: string | number | null | undefined): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal, doubling embedded `'`. Nullish → `''`. */
export function qLit(value: unknown): string {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/** Strip SQL block/line comments and collapse string/identifier literals to placeholders. */
export function stripSqlStringsAndComments(sql: string): string {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** True when SQL references the previous-step alias `prev` (or legacy `{{prev}}`). */
export function customSqlUsesPrev(sql: string): boolean {
  const raw = String(sql || "");
  if (/\{\{prev\}\}/i.test(raw)) return true;
  return /(^|[^.\w])prev([^.\w]|$)/i.test(stripSqlStringsAndComments(raw));
}

/**
 * Find the index where the actual SQL query starts, skipping leading whitespace
 * and `--` line / `/* *\/` block comments so a leading `WITH` is still detected.
 */
export function leadingQueryStart(s: string): number {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "-" && s[i + 1] === "-") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    return i;
  }
  return 0;
}

/**
 * Compile Custom SQL for the pipeline. The previous step is exposed as CTE
 * `prev` automatically (whenever `prevRef` is given). Works for plain SELECT,
 * WITH (multiple CTEs), and WITH RECURSIVE — the user's CTEs are joined under
 * one WITH clause so `prev` is in scope for all of them. Leading comments are
 * preserved. `{{prev}}` is rewritten to `prev`.
 */
export function generateCustomSql(rawSql: string, prevRef: string): string {
  let sql = String(rawSql || "").trim().replace(/;\s*$/, "");
  if (!sql) {
    return prevRef ? `SELECT * FROM ${prevRef}` : "SELECT 1 WHERE FALSE";
  }

  sql = sql.replace(/\{\{prev\}\}/gi, "prev");
  if (!prevRef) {
    return sql;
  }

  const start = leadingQueryStart(sql);
  const lead = sql.slice(0, start);
  const rest = sql.slice(start);
  const prevCte = `prev AS (\n  SELECT * FROM ${prevRef}\n)`;

  const withMatch = /^WITH\s+(RECURSIVE\s+)?/i.exec(rest);
  if (withMatch) {
    const withKw = withMatch[1] ? "WITH RECURSIVE" : "WITH";
    return `${lead}${withKw} ${prevCte},\n${rest.slice(withMatch[0].length)}`;
  }
  return `${lead}WITH ${prevCte}\n${rest}`;
}

// ---------------------------------------------------------------------------
// Append tables
// ---------------------------------------------------------------------------

export interface AppendSource {
  type?: string;
  schema?: string;
  table?: string;
  querySql?: string;
  previewSql?: string;
  relPath?: string;
  sourceName?: string;
  label?: string;
  path?: string;
  url?: string;
  connectionId?: string;
  connectionName?: string;
  connectionKind?: string;
}

export interface AppendConfig {
  sources?: AppendSource[];
  schema?: string;
  table?: string;
}

export interface AppendBranchOptions {
  preview?: boolean;
}

/** Normalize append sources — supports legacy `{ schema, table }` and new `sources[]`. */
export function normalizeAppendSources(config: AppendConfig = {}): AppendSource[] {
  if (Array.isArray(config.sources) && config.sources.length) {
    return config.sources.filter(
      (s) => s && (s.type || s.table || s.querySql || s.previewSql),
    );
  }
  if (config.table) {
    return [
      {
        type: "table",
        schema: config.schema || "main",
        table: config.table,
        label: `${config.schema || "main"}.${config.table}`,
      },
    ];
  }
  return [];
}

/** Build the SELECT/subquery branch SQL for a single append source. */
export function appendSourceBranchSql(
  src: AppendSource | null | undefined,
  options: AppendBranchOptions = {},
): string | null {
  if (!src) return null;
  const type = src.type || (src.table ? "table" : src.relPath ? "file" : "server");

  if (type === "table") {
    if (!src.table) return null;
    return `SELECT * FROM ${src.schema || "main"}.${qIdent(src.table)}`;
  }

  if (type === "file") {
    const sql = options.preview
      ? src.previewSql || src.querySql
      : src.querySql || src.previewSql;
    if (!sql) return null;
    return `(${String(sql).trim().replace(/;\s*$/, "")})`;
  }

  // server / connection sources — script export only (no browser attach)
  if (options.preview) return null;
  const sql = src.querySql;
  if (!sql) return null;
  return `(${String(sql).trim().replace(/;\s*$/, "")})`;
}

export function generateAppendTablesSql(
  config: AppendConfig,
  prevRef: string,
  options: AppendBranchOptions = {},
): string {
  const sources = normalizeAppendSources(config);
  const branches = [`SELECT * FROM ${prevRef}`];
  for (const src of sources) {
    const branch = appendSourceBranchSql(src, options);
    if (branch) branches.push(branch);
  }
  if (branches.length === 1) return branches[0];
  return branches.join("\nUNION ALL BY NAME\n");
}

/** Short display name for an append source (file basename / table). */
export function appendSourceTitle(src: AppendSource | null | undefined): string {
  if (!src) return "Item";
  const type =
    src.type || (src.table && !src.connectionId ? "table" : src.relPath ? "file" : "server");
  if (type === "file") {
    const path = src.sourceName || src.relPath || src.label || "";
    return String(path).split(/[/\\]/).pop() || path || "File";
  }
  if (type === "table") {
    return src.table || src.label || "Table";
  }
  if (src.table) return src.table;
  if (src.path || src.url) {
    const path = src.path || src.url || "";
    return String(path).split(/[/\\]/).pop() || path;
  }
  if (src.label) {
    const parts = String(src.label).split(/[/\\.]/);
    return parts[parts.length - 1] || src.label;
  }
  return "Item";
}

/** Connection / origin subtitle for an append source. */
export function appendSourceSubtitle(src: AppendSource | null | undefined): string {
  if (!src) return "";
  if (src.connectionName) return src.connectionName;
  const type =
    src.type || (src.table && !src.connectionId ? "table" : src.relPath ? "file" : "server");
  if (type === "table") return "Saved table";
  if (src.connectionKind) return src.connectionKind;
  return "";
}

/** Full tooltip / step-description label. */
export function appendSourceLabel(src: AppendSource | null | undefined): string {
  if (!src) return "Source";
  const title = appendSourceTitle(src);
  const subtitle = appendSourceSubtitle(src);
  if (subtitle) return `${title} · ${subtitle}`;
  if (src.label) return src.label;
  if (src.relPath) return src.relPath;
  if (src.type === "table" || (src.table && !src.connectionId)) {
    return `${src.schema || "main"}.${src.table}`;
  }
  if (src.path || src.url) return src.path || src.url || "";
  return title;
}

// ---------------------------------------------------------------------------
// Joins
// ---------------------------------------------------------------------------

export const JOIN_KIND_OPTIONS = new Set<string>([
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "LEFT_ANTI",
  "RIGHT_ANTI",
]);

export interface JoinKey {
  left: string;
  right: string;
}

export interface JoinConfig {
  joinType?: string;
  schema?: string;
  table?: string;
  keys?: JoinKey[];
  levels?: { keys?: JoinKey[] }[];
  leftKey?: string;
  rightKey?: string;
}

export interface NormalizedJoinConfig {
  joinType: string;
  schema: string;
  table: string;
  leftKey: string;
  rightKey: string;
  keys: JoinKey[];
}

export function normalizeJoinKeyPair(pair: JoinKey | Record<string, unknown> = {}): JoinKey {
  const p = pair as Record<string, unknown>;
  return {
    left: String(p.left ?? p.leftKey ?? "").trim(),
    right: String(p.right ?? p.rightKey ?? "").trim(),
  };
}

/**
 * Normalize join config into a flat Power Query-style merge shape:
 *   { joinType, schema, table, keys: [{ left, right }, ...] }
 * Reads legacy shapes (levels[] with match/threshold, or single leftKey/rightKey)
 * so older project files keep working.
 */
export function normalizeJoinConfig(config: JoinConfig = {}): NormalizedJoinConfig {
  const joinType = JOIN_KIND_OPTIONS.has(String(config.joinType || "").toUpperCase())
    ? String(config.joinType).toUpperCase()
    : "LEFT";
  const schema = config.schema || "main";
  const table = config.table || "";

  let keys: JoinKey[];
  if (Array.isArray(config.keys) && config.keys.length) {
    keys = config.keys.map((k) => normalizeJoinKeyPair(k as JoinKey));
  } else if (Array.isArray(config.levels) && config.levels.length) {
    // Collapse legacy cascade levels into a single key-pair list.
    keys = config.levels.flatMap((lvl) =>
      (lvl.keys || []).map((k) => normalizeJoinKeyPair(k as JoinKey)),
    );
  } else {
    keys = [normalizeJoinKeyPair({ left: config.leftKey, right: config.rightKey })];
  }
  if (!keys.length) keys = [{ left: "", right: "" }];

  const firstFilled = keys.find((k) => k.left && k.right) || keys[0];
  return {
    joinType,
    schema,
    table,
    leftKey: firstFilled.left || "",
    rightKey: firstFilled.right || "",
    keys,
  };
}

export function joinFilledKeys(cfg: NormalizedJoinConfig): JoinKey[] {
  return (cfg.keys || []).filter((k) => k.left && k.right);
}

export function joinPredicate(leftAlias: string, rightAlias: string, keys: JoinKey[]): string {
  return keys
    .filter((k) => k.left && k.right)
    .map((k) => `${leftAlias}.${qIdent(k.left)} = ${rightAlias}.${qIdent(k.right)}`)
    .join(" AND ");
}

/** Distinct right-side key column names (to EXCLUDE them from b.* output). */
export function joinRightKeyCols(keys: JoinKey[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const k of keys) {
    if (!k.right || seen.has(k.right)) continue;
    seen.add(k.right);
    cols.push(k.right);
  }
  return cols;
}

export function joinRightSelectExpr(keys: JoinKey[]): string {
  const exclude = joinRightKeyCols(keys);
  return exclude.length
    ? `b.* EXCLUDE (${exclude.map(qIdent).join(", ")})`
    : "b.*";
}

/**
 * Power Query-style merge: a single join between the current step (left)
 * and another table (right) on one or more key column pairs.
 */
export function generateJoinTablesSql(config: JoinConfig, prevRef: string): string {
  const cfg = normalizeJoinConfig(config);
  if (!cfg.table) return `SELECT * FROM ${prevRef}`;
  const keys = joinFilledKeys(cfg);
  if (!keys.length) return `SELECT * FROM ${prevRef}`;

  const right = `${cfg.schema || "main"}.${qIdent(cfg.table)}`;
  const pred = joinPredicate("a", "b", keys);
  const rightSelect = joinRightSelectExpr(keys);
  const jt = cfg.joinType || "LEFT";

  switch (jt) {
    case "INNER":
      return `SELECT a.*, ${rightSelect} FROM ${prevRef} AS a INNER JOIN ${right} AS b ON ${pred}`;
    case "LEFT":
      return `SELECT a.*, ${rightSelect} FROM ${prevRef} AS a LEFT JOIN ${right} AS b ON ${pred}`;
    case "RIGHT":
      return `SELECT a.*, ${rightSelect} FROM ${prevRef} AS a RIGHT JOIN ${right} AS b ON ${pred}`;
    case "FULL":
      return `SELECT a.*, ${rightSelect} FROM ${prevRef} AS a FULL OUTER JOIN ${right} AS b ON ${pred}`;
    case "LEFT_ANTI":
      return `SELECT a.* FROM ${prevRef} AS a WHERE NOT EXISTS (SELECT 1 FROM ${right} AS b WHERE ${pred})`;
    case "RIGHT_ANTI":
      return `SELECT ${rightSelect} FROM ${right} AS b WHERE NOT EXISTS (SELECT 1 FROM ${prevRef} AS a WHERE ${pred})`;
    default:
      return `SELECT a.*, ${rightSelect} FROM ${prevRef} AS a INNER JOIN ${right} AS b ON ${pred}`;
  }
}

/** Plain-language label for the selected join kind. */
export function joinKeepLabel(joinType: string): string {
  switch (String(joinType || "LEFT").toUpperCase()) {
    case "INNER":
      return "Only matching rows";
    case "RIGHT":
      return "Keep all from right";
    case "FULL":
      return "Keep all from both";
    case "LEFT_ANTI":
      return "Left rows with no match";
    case "RIGHT_ANTI":
      return "Right rows with no match";
    case "LEFT":
    default:
      return "Keep all from left";
  }
}

/**
 * Build SQL that counts matches for the join dialog preview.
 * Returns one row: left_total, right_total, left_matched, right_matched
 * (a row counts as matched if at least one partner exists — no fan-out).
 */
export function generateJoinPreviewStatsSql(
  config: JoinConfig,
  leftRef: string,
): string | null {
  const cfg = normalizeJoinConfig(config);
  if (!cfg.table || !leftRef) return null;
  const keys = joinFilledKeys(cfg);
  if (!keys.length) return null;

  const right = `${cfg.schema || "main"}.${qIdent(cfg.table)}`;
  const pred = joinPredicate("a", "b", keys);
  return `SELECT
  (SELECT COUNT(*) FROM ${leftRef}) AS left_total,
  (SELECT COUNT(*) FROM ${right}) AS right_total,
  (SELECT COUNT(*) FROM ${leftRef} a WHERE EXISTS (SELECT 1 FROM ${right} b WHERE ${pred})) AS left_matched,
  (SELECT COUNT(*) FROM ${right} b WHERE EXISTS (SELECT 1 FROM ${leftRef} a WHERE ${pred})) AS right_matched`;
}

// ---------------------------------------------------------------------------
// Pivot
// ---------------------------------------------------------------------------

export interface PivotAggregation {
  column?: string;
  fn?: string;
  alias?: string;
}

export interface PivotConfig {
  indexCols?: string[];
  indexCol?: string;
  pivotCol?: string;
  pivotValues?: string[];
  useAllValues?: boolean;
  aggregations?: PivotAggregation[];
  valueCol?: string;
  agg?: string;
}

export interface NormalizedPivotConfig {
  indexCols: string[];
  pivotCol: string;
  pivotValues: string[];
  useAllValues: boolean;
  aggregations: PivotAggregation[];
}

/** Normalize pivot config — supports legacy single-field shape and new multi-field shape. */
export function normalizePivotConfig(config: PivotConfig = {}): NormalizedPivotConfig {
  const indexCols =
    Array.isArray(config.indexCols) && config.indexCols.length
      ? config.indexCols.filter(Boolean)
      : config.indexCol
        ? [config.indexCol]
        : [];

  let aggregations = Array.isArray(config.aggregations)
    ? config.aggregations.filter((a) => a && a.column)
    : [];
  if (!aggregations.length && config.valueCol) {
    aggregations = [
      {
        column: config.valueCol,
        fn: String(config.agg || "sum").toUpperCase(),
        alias: "",
      },
    ];
  }

  const pivotValues = Array.isArray(config.pivotValues)
    ? config.pivotValues.map((v) => String(v))
    : [];
  // Default: pivot all distinct values (Power Query default). Explicit false + values = IN filter.
  const useAllValues =
    config.useAllValues === false && pivotValues.length ? false : true;

  return {
    indexCols,
    pivotCol: config.pivotCol || "",
    pivotValues,
    useAllValues,
    aggregations,
  };
}

// ---------------------------------------------------------------------------
// Filter rows
// ---------------------------------------------------------------------------

export const TYPE_MAP: Record<string, string> = {
  text: "VARCHAR",
  number: "DOUBLE",
  integer: "BIGINT",
  date: "DATE",
  timestamp: "TIMESTAMP",
  boolean: "BOOLEAN",
};

/**
 * Build a SQL expression that cleans a formatted number string before casting.
 * Handles commas, currency symbols, percentage signs, and whitespace.
 * For DOUBLE: strips non-numeric chars (except ., -), removes commas, then casts.
 * For BIGINT: same cleaning + ROUND() before casting.
 */
export function buildNumberCastSql(ident: string, duckType: string): string {
  const cleaned = `REGEXP_REPLACE(REGEXP_REPLACE(TRIM(CAST(${ident} AS VARCHAR)), '[^0-9.,\\-]', '', 'g'), ',', '', 'g')`;
  if (duckType === "BIGINT") {
    return `TRY_CAST(ROUND(${cleaned}::DOUBLE) AS BIGINT)`;
  }
  if (duckType === "DOUBLE" || duckType === "FLOAT" || duckType === "REAL") {
    return `TRY_CAST(${cleaned} AS ${duckType})`;
  }
  if (duckType.startsWith("DECIMAL")) {
    return `TRY_CAST(${cleaned} AS ${duckType})`;
  }
  // Fallback: standard TRY_CAST
  return `TRY_CAST(${ident} AS ${duckType})`;
}

export type FilterColumnType =
  | "text"
  | "number"
  | "integer"
  | "date"
  | "timestamp"
  | "boolean"
  | "category";

/** Map DuckDB / Arrow / app type labels to filter UI kinds. */
export function normalizeFilterColumnType(rawType: string): FilterColumnType {
  const t = String(rawType || "").toLowerCase();
  if (!t) return "text";
  if (
    t === "text" ||
    t === "number" ||
    t === "integer" ||
    t === "date" ||
    t === "timestamp" ||
    t === "boolean" ||
    t === "category"
  ) {
    return t;
  }
  if (/\b(bool|boolean|bit)\b/.test(t) || t === "true" || t === "false") return "boolean";
  if (/\b(timestamp|datetime|timestamptz)\b/.test(t)) return "timestamp";
  if (/\bdate\b/.test(t) && !/\bupdate\b/.test(t)) return "date";
  if (
    /\b(int|integer|bigint|smallint|tinyint|hugeint|utinyint|usmallint|uinteger|ubigint|int8|int16|int32|int64|uint)\b/.test(t)
  ) {
    return "integer";
  }
  if (/\b(double|float|real|decimal|numeric|float16|float32|float64)\b/.test(t) || /\bdecimal\s*\(/.test(t)) {
    return "number";
  }
  if (/\b(utf8|string|varchar|char|text|large_string)\b/.test(t)) return "text";
  return "text";
}

export function quoteFilterValue(value: unknown, colType: string): string {
  const kind = normalizeFilterColumnType(colType);
  if (kind === "number" || kind === "integer") {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "NULL";
  }
  if (kind === "boolean") {
    const v = String(value ?? "").toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return "TRUE";
    if (v === "false" || v === "0" || v === "no") return "FALSE";
    return "NULL";
  }
  return qLit(value);
}

export interface FilterRule {
  column?: string;
  operator?: string;
  value?: unknown;
  valueTo?: unknown;
  columnType?: string;
}

export interface FilterGroup {
  logic: string;
  rules: FilterRule[];
}

export interface FilterConfig {
  mode?: string;
  logic?: string;
  condition?: string;
  rules?: FilterRule[];
  groups?: FilterGroup[];
}

export function buildFilterRuleSql(rule: FilterRule): string | null {
  if (!rule?.column) return null;
  const col = qIdent(rule.column);
  const op = rule.operator || "equals";
  const colType = rule.columnType || "text";

  if (op === "is_null") return `${col} IS NULL`;
  if (op === "is_not_null") return `${col} IS NOT NULL`;
  if (op === "is_true") return `${col} IS TRUE`;
  if (op === "is_false") return `${col} IS FALSE`;

  if (op === "between") {
    const a = quoteFilterValue(rule.value, colType);
    const b = quoteFilterValue(rule.valueTo, colType);
    return `${col} BETWEEN ${a} AND ${b}`;
  }

  if (op === "in" || op === "not_in") {
    const parts = String(rule.value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => quoteFilterValue(s, colType));
    if (!parts.length) return null;
    const list = `(${parts.join(", ")})`;
    return op === "in" ? `${col} IN ${list}` : `${col} NOT IN ${list}`;
  }

  const val = quoteFilterValue(rule.value, colType);
  const map: Record<string, string> = {
    equals: `${col} = ${val}`,
    not_equals: `${col} <> ${val}`,
    greater_than: `${col} > ${val}`,
    greater_or_equal: `${col} >= ${val}`,
    less_than: `${col} < ${val}`,
    less_or_equal: `${col} <= ${val}`,
    contains: `${col} ILIKE '%' || ${qLit(rule.value ?? "")} || '%'`,
    not_contains: `${col} NOT ILIKE '%' || ${qLit(rule.value ?? "")} || '%'`,
    starts_with: `${col} ILIKE ${qLit(rule.value ?? "")} || '%'`,
    ends_with: `${col} ILIKE '%' || ${qLit(rule.value ?? "")}`,
  };
  return map[op] || null;
}

export function buildFilterWhereClause(config: FilterConfig): string {
  if (config?.mode === "sql" || (!config?.rules?.length && !config?.groups?.length && config?.condition)) {
    return config.condition || "1=1";
  }

  // Build parts from groups (new structure) or flat rules (legacy).
  const parts: string[] = [];

  if (config?.groups?.length) {
    for (const group of config.groups) {
      const groupParts = (group.rules || [])
        .map((r) => buildFilterRuleSql(r))
        .filter((p): p is string => Boolean(p));
      if (groupParts.length) {
        const groupLogic = String(group.logic || "AND").toUpperCase() === "OR" ? "OR" : "AND";
        parts.push(groupParts.map((p) => `(${p})`).join(` ${groupLogic} `));
      }
    }
  } else {
    const ruleParts = (config?.rules || [])
      .map((r) => buildFilterRuleSql(r))
      .filter((p): p is string => Boolean(p));
    parts.push(...ruleParts);
  }

  if (!parts.length) return config?.condition || "1=1";
  const logic = String(config?.logic || "AND").toUpperCase() === "OR" ? "OR" : "AND";
  return parts.map((p) => `(${p})`).join(` ${logic} `);
}

// ---------------------------------------------------------------------------
// Replace values
// ---------------------------------------------------------------------------

export interface NormalizedReplaceValuesConfig {
  column: string;
  columnType: FilterColumnType;
  operator: string;
  find: string;
  findTo: string;
  replace: string;
  replaceScope: string;
  caseSensitive: boolean;
  [key: string]: unknown;
}

/** Migrate legacy replace_values configs and fill defaults. */
export function normalizeReplaceValuesConfig(
  config: Record<string, unknown> = {},
): NormalizedReplaceValuesConfig {
  const next: Record<string, unknown> = { ...config };
  // Legacy: matchMode exact/contains → operator + replaceScope
  if (!next.operator && next.matchMode) {
    if (next.matchMode === "contains") {
      next.operator = "contains";
      next.replaceScope = next.replaceScope || "matching_text";
    } else {
      next.operator = "equals";
      next.replaceScope = next.replaceScope || "whole_cell";
    }
  }
  next.column = next.column || "";
  next.columnType = normalizeFilterColumnType(String(next.columnType || "text"));
  next.operator = next.operator || "equals";
  next.find = next.find ?? "";
  next.findTo = next.findTo ?? "";
  next.replace = next.replace ?? "";
  next.replaceScope = next.replaceScope || "whole_cell";
  if (next.caseSensitive == null) {
    // Legacy default was true; new default is false (easier for non-tech users).
    next.caseSensitive = next.matchMode != null ? true : false;
  } else {
    next.caseSensitive = Boolean(next.caseSensitive);
  }
  delete next.matchMode;
  return next as NormalizedReplaceValuesConfig;
}

export function buildReplaceTextEquals(
  col: string,
  find: string,
  caseSensitive: boolean,
): string {
  if (caseSensitive) return `${col} = ${qLit(find)}`;
  return `LOWER(CAST(${col} AS VARCHAR)) = LOWER(${qLit(find)})`;
}

export function buildReplaceTextContains(
  col: string,
  find: string,
  caseSensitive: boolean,
): string {
  if (caseSensitive) {
    return `CAST(${col} AS VARCHAR) LIKE '%' || ${qLit(find)} || '%'`;
  }
  return `CAST(${col} AS VARCHAR) ILIKE '%' || ${qLit(find)} || '%'`;
}

/** SQL condition for which cells should be replaced (whole-cell path). */
export function buildReplaceMatchCondition(
  config: Record<string, unknown>,
): string | null {
  const normalized = normalizeReplaceValuesConfig(config);
  if (!normalized.column) return null;
  const col = qIdent(normalized.column);
  const colType = normalized.columnType || "text";
  const op = normalized.operator || "equals";
  const find = normalized.find ?? "";
  const findTo = normalized.findTo ?? "";
  const caseSensitive = Boolean(normalized.caseSensitive);
  const isTextLike = colType === "text" || colType === "category";

  if (op === "is_empty") return `${col} IS NULL OR CAST(${col} AS VARCHAR) = ''`;
  if (op === "is_not_empty") return `${col} IS NOT NULL AND CAST(${col} AS VARCHAR) <> ''`;

  if (op === "between") {
    const a = quoteFilterValue(find, colType);
    const b = quoteFilterValue(findTo, colType);
    if (a === "NULL" || b === "NULL") return null;
    return `${col} BETWEEN ${a} AND ${b}`;
  }

  if (isTextLike) {
    if (op === "equals") return buildReplaceTextEquals(col, find, caseSensitive);
    if (op === "contains") {
      if (!find) return null;
      return buildReplaceTextContains(col, find, caseSensitive);
    }
    if (op === "starts_with") {
      if (!find) return null;
      if (caseSensitive) return `CAST(${col} AS VARCHAR) LIKE ${qLit(find)} || '%'`;
      return `CAST(${col} AS VARCHAR) ILIKE ${qLit(find)} || '%'`;
    }
    if (op === "ends_with") {
      if (!find) return null;
      if (caseSensitive) return `CAST(${col} AS VARCHAR) LIKE '%' || ${qLit(find)}`;
      return `CAST(${col} AS VARCHAR) ILIKE '%' || ${qLit(find)}`;
    }
  }

  // Numbers, dates, timestamps, booleans — typed comparisons
  if (
    ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(
      op,
    )
  ) {
    const val = quoteFilterValue(find, colType);
    if (val === "NULL" && find !== "" && find != null) {
      // keep going — quoteFilterValue returns NULL for bad numbers
    }
    const map: Record<string, string> = {
      equals: `${col} = ${val}`,
      not_equals: `${col} <> ${val}`,
      greater_than: `${col} > ${val}`,
      greater_or_equal: `${col} >= ${val}`,
      less_than: `${col} < ${val}`,
      less_or_equal: `${col} <= ${val}`,
    };
    return map[op] || null;
  }

  // Fallback: treat as text equals
  return buildReplaceTextEquals(col, find, caseSensitive);
}