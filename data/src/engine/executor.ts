import { getDuckDB } from "../lib/duckdb";
import type { ArrowResult, PlanNode } from "../types/engine";
import type { Query } from "../types/query";
import { buildFull } from "./cteBuilder";
import { createQueryResolver } from "./references";
import type { QueryRunStatus } from "../store/previewStore";

export interface ExecuteResult {
  data: ArrowResult | null;
  error: string | null;
  durationMs: number;
}

export async function executeSQL(sql: string, limit: number): Promise<ExecuteResult> {
  const start = performance.now();
  try {
    const conn = await getDuckDB();
    const table = await conn.query(sql);

    const columns = table.schema.fields.map((f) => ({
      name: f.name,
      type: String(f.type),
    }));

    const rows: unknown[][] = [];
    let count = 0;
    for (const row of table) {
      if (count >= limit) break;
      const arr: unknown[] = [];
      for (const col of columns) {
        const val = (row as Record<string, unknown>)[col.name];
        arr.push(typeof val === "bigint" ? Number(val) : val);
      }
      rows.push(arr);
      count++;
    }

    return {
      data: { columns, rows, rowCount: table.numRows },
      error: null,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Math.round(performance.now() - start),
    };
  }
}

/**
 * Run `EXPLAIN` and parse the indented text plan into a tree of PlanNodes.
 * DuckDB returns a single-column text plan with tree indentation; we split on
 * newlines and nest by leading `┆`/space depth. On any parse issue we fall back
 * to a single node holding the raw text so the plan still renders.
 */
export async function explainSql(sql: string): Promise<PlanNode> {
  const conn = await getDuckDB();
  const table = await conn.query(`EXPLAIN ${sql}`);
  const rows = table.toArray();
  let raw = "";
  for (const row of rows) {
    const val = (row as Record<string, unknown>)[
      Object.keys(row as Record<string, unknown>).pop() ?? ""
    ];
    if (typeof val === "string") raw += val + "\n";
  }
  if (!raw.trim()) {
    return { name: "EXPLAIN", description: "(empty plan)", children: [] };
  }
  return parseExplainTree(raw);
}

/**
 * Execute all enabled queries in batch and return their run statuses.
 * Each query runs its full pipeline sequentially.
 */
export async function executeBatch(
  queries: Query[],
  allQueries: Query[],
  onProgress?: (queryId: string, status: Partial<QueryRunStatus>) => void,
): Promise<QueryRunStatus[]> {
  const enabled = queries.filter((q) => q.enabled && q.steps.length > 0);
  const results: QueryRunStatus[] = enabled.map((q) => ({
    queryId: q.id,
    queryName: q.name,
    status: "pending" as const,
  }));

  for (let i = 0; i < enabled.length; i++) {
    const query = enabled[i];
    results[i].status = "running";
    onProgress?.(query.id, { status: "running" });

    try {
      const resolveQuery = createQueryResolver(allQueries);
      const compiled = buildFull(query.steps, resolveQuery);
      const start = performance.now();
      const conn = await getDuckDB();
      const table = await conn.query(compiled.fullSQL);
      const durationMs = Math.round(performance.now() - start);

      results[i] = {
        queryId: query.id,
        queryName: query.name,
        status: "completed",
        rowCount: table.numRows,
        durationMs,
      };
      onProgress?.(query.id, { status: "completed", rowCount: table.numRows, durationMs });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results[i] = {
        queryId: query.id,
        queryName: query.name,
        status: "failed",
        error,
      };
      onProgress?.(query.id, { status: "failed", error });
    }
  }

  return results;
}

function parseExplainTree(raw: string): PlanNode {
  const lines = raw.split(/\r?\n/).filter((l) => l.length);
  const root: PlanNode = { name: "plan", description: "", children: [] };
  const stack: { depth: number; node: PlanNode }[] = [{ depth: -1, node: root }];

  for (const line of lines) {
    // Depth = count of leading box-drawing/whitespace characters.
    const match = line.match(/^([\s┆│├└─┌┐┴┬┤├└─]*)(.*)$/);
    const indent = match ? match[1].length : 0;
    const text = (match ? match[2] : line).trim();
    if (!text) continue;
    const node: PlanNode = { name: text.split(/[:\s]/)[0] || text, description: text, children: [] };
    while (stack.length > 1 && indent <= stack[stack.length - 1].depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: indent, node });
  }
  return root;
}