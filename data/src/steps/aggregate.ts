// "Aggregate" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (group_aggregate) into a typed
// StepDef. buildSql emits SQL that references the previous step via the
// literal token `prev` (resolved to the prior CTE name by engine/cteBuilder).

import type { StepDef } from "./types";
import { qIdent } from "./helpers";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

interface Aggregation {
  fn?: string;
  column?: string;
  alias?: string;
}

interface GroupAggregateConfig {
  /** New shape: explicit group-column list. */
  groupColumns?: string[];
  /** Legacy shape (original catalog). */
  groupBy?: string[];
  aggregations?: Aggregation[];
}

// --- step definitions -------------------------------------------------------

export const aggregateSteps: StepDef[] = [
  {
    kind: "group_aggregate",
    category: "aggregate",
    name: "Group & total",
    description: "Group and aggregate values",
    defaultConfig: { groupColumns: [], aggregations: [] },
    buildSql(config) {
      const cfg = config as GroupAggregateConfig;
      const groupCols = (cfg.groupColumns?.length ? cfg.groupColumns : cfg.groupBy) || [];
      const groupSql = groupCols.map(qIdent).join(", ");
      // Track output column names (case-insensitive) so aggregations never
      // collide with a group-by column or with each other.
      const usedLower = new Set<string>(
        groupCols.map((c) => String(c).toLowerCase()),
      );

      function pickAlias(a: Aggregation): string {
        let base = String(a.alias || "").trim();
        if (!base) {
          base = String((a.fn || "").toUpperCase()) === "COUNT_ROWS"
            ? "row_count"
            : (a.column || "value");
        }
        let candidate = base;
        let n = 2;
        while (usedLower.has(candidate.toLowerCase())) {
          candidate = `${base}_${n}`;
          n += 1;
        }
        usedLower.add(candidate.toLowerCase());
        return candidate;
      }

      const aggs = (cfg.aggregations || [])
        .filter(
          (a) => a.column || String(a.fn || "").toUpperCase() === "COUNT_ROWS",
        )
        .map((a) => {
          const fn = String(a.fn || "SUM").toUpperCase();
          const alias = pickAlias(a);
          let expr: string;
          if (fn === "COUNT_ROWS") expr = "COUNT(*)";
          else if (fn === "COUNT_DISTINCT")
            expr = `COUNT(DISTINCT ${qIdent(a.column)})`;
          else expr = `${fn}(${qIdent(a.column)})`;
          return `${expr} AS ${qIdent(alias)}`;
        })
        .join(", ");

      if (!groupCols.length)
        return `SELECT ${aggs || "COUNT(*) AS row_count"} FROM prev`;
      return `SELECT ${groupSql}${aggs ? ", " + aggs : ""} FROM prev GROUP BY ${groupSql}`;
    },
  },
];