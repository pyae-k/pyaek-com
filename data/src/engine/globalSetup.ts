// Engine-facing wrapper around the connection catalog's global-setup
// aggregation. Re-exports the pure builders used by the executor and adds a
// `buildGlobalSetup` alias that the executor calls before running a pipeline.

import type { Connection } from "../types/connection";
import {
  aggregateConnectionGlobalSetup,
  buildFolderPathExpr,
  type GlobalSetupResult,
} from "../connections/kinds";

export { aggregateConnectionGlobalSetup, buildFolderPathExpr, type GlobalSetupResult };

/**
 * Build the global setup SQL + per-connection ATTACH SQL for a pipeline run.
 * Thin alias over `aggregateConnectionGlobalSetup` — kept under the engine/
 * tree so the executor imports it from its own module.
 */
export function buildGlobalSetup(connections: Connection[]): GlobalSetupResult {
  return aggregateConnectionGlobalSetup(connections);
}