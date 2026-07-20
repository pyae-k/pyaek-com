// "Advanced" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (custom_sql) into a typed StepDef.
// buildSql emits the user's SQL body verbatim with `{{prev}}` rewritten to the
// literal token `prev` (resolved to the prior CTE name by engine/cteBuilder).
// NOTE: unlike the legacy generateCustomSql helper, we do NOT inject a
// `prev AS (...)` CTE — the outer CTE-chain compiler already wraps each step in
// its own CTE and resolves `prev`.

import type { StepDef } from "./types";

interface CustomSqlConfig {
  sql?: string;
}

export const advancedSteps: StepDef[] = [
  {
    kind: "custom_sql",
    category: "advanced",
    name: "Custom SQL",
    description:
      "Write a SELECT (CTEs supported); previous step is available as prev",
    defaultConfig: { sql: "SELECT * FROM prev" },
    buildSql(config) {
      const cfg = config as CustomSqlConfig;
      const sql = String(cfg.sql ?? "").trim().replace(/;\s*$/, "");
      if (!sql) {
        // Empty: no-op body. With a prev the engine resolves `prev`; without
        // one, emit an empty result.
        return "SELECT 1 WHERE FALSE";
      }
      return sql.replace(/\{\{prev\}\}/gi, "prev");
    },
  },
];