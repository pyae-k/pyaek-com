import type { Step } from "../types/query";
import { makeBuildSqlContext, regenerateStepSql } from "../steps";

export function cteName(index: number): string {
  return `step_${String(index + 1).padStart(2, "0")}`;
}

export interface CompiledCTE {
  name: string;
  stepId: string;
  sql: string;
}

export interface CompiledQuery {
  ctes: CompiledCTE[];
  fullSQL: string;
}

/**
 * Query resolver: given a referenced query name, return its compiled full SQL.
 * The shared `visited` set is threaded through to prevent infinite recursion on
 * cross-query cycles (A→B→A). A name already in `visited` returns null.
 */
export type QueryResolver = (queryName: string, visited: Set<string>) => CompiledQuery | null;

/** Substitute `{{name}}` parameters from a flat params map. Ported from pipeline.js substituteParams. */
export function substituteParams(sql: string, params?: Record<string, unknown>): string {
  if (!params) return sql;
  return sql.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const val = params[key];
    if (val === undefined || val === null) return "";
    if (typeof val === "string") return val.replace(/'/g, "''");
    return String(val);
  });
}

/**
 * Resolve a step's base SQL. By default the step's stored `sql` is used (already
 * generated for in-browser execution). When `portable` is true the SQL is
 * regenerated from the step's config with a portable BuildSqlContext, so folder
 * sources emit `getvariable('alias') || '/file'` path expressions for desktop
 * Download-SQL export. `custom_sql` is always preserved verbatim.
 */
function stepSql(step: Step, index: number, prevRef: string, portable: boolean): string {
  if (!portable) return step.sql || "SELECT 1";
  return regenerateStepSql(step, makeBuildSqlContext(prevRef, index, undefined, true));
}

export function buildUpTo(
  steps: Step[],
  upToIndex: number,
  resolveQuery?: QueryResolver,
  params?: Record<string, unknown>,
  visited?: Set<string>,
  portable?: boolean,
): CompiledQuery {
  const enabled = steps.filter((s) => s.enabled);
  const target = enabled[upToIndex];
  if (!target) return { ctes: [], fullSQL: "SELECT 1 AS placeholder WHERE 1=0" };

  const ctes: CompiledCTE[] = [];
  const vis = visited ?? new Set<string>();

  for (let i = 0; i <= upToIndex; i++) {
    const step = enabled[i];
    if (!step) break;
    const name = cteName(i);
    const prevRef = i > 0 ? cteName(i - 1) : "";
    const rawSQL = substituteParams(stepSql(step, i, prevRef, !!portable) || "SELECT 1", params);
    const resolvedSQL = resolveReferences(rawSQL, i, enabled, resolveQuery, vis);
    ctes.push({ name, stepId: step.id, sql: resolvedSQL });
  }

  const finalName = cteName(upToIndex);
  const cteClause = ctes.map((c) => `${c.name} AS (\n${c.sql}\n)`).join(",\n");
  const fullSQL = `WITH ${cteClause}\nSELECT * FROM ${finalName}`;

  return { ctes, fullSQL };
}

export function buildFull(
  steps: Step[],
  resolveQuery?: QueryResolver,
  params?: Record<string, unknown>,
  visited?: Set<string>,
  portable?: boolean,
): CompiledQuery {
  const enabled = steps.filter((s) => s.enabled);
  if (enabled.length === 0) return { ctes: [], fullSQL: "SELECT 1 AS placeholder WHERE 1=0" };
  return buildUpTo(steps, enabled.length - 1, resolveQuery, params, visited, portable);
}

function resolveReferences(
  sql: string,
  currentIndex: number,
  enabledSteps: Step[],
  resolveQuery: QueryResolver | undefined,
  visited: Set<string>,
): string {
  let resolved = sql;

  // `prev` → previous step's CTE name.
  const prevIndex = currentIndex - 1;
  if (prevIndex >= 0) {
    const prevCTE = cteName(prevIndex);
    resolved = resolved.replace(/\bFROM\s+prev\b/gi, `FROM ${prevCTE}`);
    resolved = resolved.replace(/\bJOIN\s+prev\b/gi, `JOIN ${prevCTE}`);
  }

  // Cross-query references: FROM/JOIN <other_query> → inline compiled subquery.
  const fromQueryMatches = resolved.matchAll(/\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gi);
  const joinQueryMatches = resolved.matchAll(/\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gi);
  const referencedNames = new Set<string>();

  const cteNames = new Set(enabledSteps.map((_, i) => cteName(i)));
  for (const m of [...fromQueryMatches, ...joinQueryMatches]) {
    const refName = m[1];
    if (refName === "prev" || refName.startsWith("step_")) continue;
    if (cteNames.has(refName)) continue;
    referencedNames.add(refName);
  }

  if (referencedNames.size > 0 && resolveQuery) {
    for (const queryName of referencedNames) {
      // The resolver checks `visited` and returns null on a cycle/already-done name.
      const compiled = resolveQuery(queryName, visited);
      if (compiled && compiled.ctes.length > 0) {
        const subquery = `(${compiled.fullSQL})`;
        const reFrom = new RegExp(`\\bFROM\\s+${queryName}\\b`, "gi");
        resolved = resolved.replace(reFrom, `FROM ${subquery} AS ${queryName}`);
        const reJoin = new RegExp(`\\bJOIN\\s+${queryName}\\b`, "gi");
        resolved = resolved.replace(reJoin, `JOIN ${subquery} AS ${queryName}`);
      }
    }
  }

  return resolved;
}