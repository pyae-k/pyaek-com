import type { Query } from "../types/query";
import { buildFull } from "./cteBuilder";
import type { CompiledQuery, QueryResolver } from "./cteBuilder";

/**
 * Build a query resolver that inlines cross-query references by name. The
 * shared `visited` set is threaded into every nested buildFull so cycles
 * (A→B→A) terminate instead of recursing forever.
 */
export function createQueryResolver(
  queries: Query[],
  portable?: boolean,
): QueryResolver | undefined {
  if (queries.length === 0) return undefined;

  const queryByName = new Map<string, Query>();
  for (const q of queries) queryByName.set(q.name, q);

  const resolver: QueryResolver = (queryName, visited): CompiledQuery | null => {
    if (visited.has(queryName)) return null;
    const q = queryByName.get(queryName);
    if (!q || q.steps.length === 0) return null;
    visited.add(queryName);
    return buildFull(q.steps, resolver, undefined, visited, portable);
  };

  return resolver;
}