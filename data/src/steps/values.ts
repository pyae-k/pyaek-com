// "Values" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (replace_values, remove_errors,
// fix_errors) into typed StepDefs. buildSql emits SQL that references the
// previous step via the literal token `prev` (resolved to the prior CTE name
// by engine/cteBuilder).

import type { StepDef } from "./types";
import {
  qIdent,
  qLit,
  TYPE_MAP,
  normalizeReplaceValuesConfig,
  buildReplaceMatchCondition,
  quoteFilterValue,
} from "./helpers";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

interface ReplaceValuesConfig {
  column?: string;
  columnType?: string;
  operator?: string;
  find?: string;
  findTo?: string;
  replace?: string;
  replaceScope?: string;
  caseSensitive?: boolean;
  matchMode?: string;
}

interface ErrorFixConfig {
  column?: string;
  targetType?: string;
  defaultValue?: string;
  fixes?: { row: number | string; newValue: string }[];
}

// --- step definitions -------------------------------------------------------

export const valuesSteps: StepDef[] = [
  {
    kind: "replace_values",
    category: "values",
    name: "Replace values",
    description: "Find values in a column and change them",
    defaultConfig: {
      column: "",
      columnType: "text",
      operator: "equals",
      find: "",
      findTo: "",
      replace: "",
      replaceScope: "whole_cell",
      caseSensitive: false,
    },
    buildSql(config) {
      const cfg = config as ReplaceValuesConfig;
      if (!cfg.column) return `SELECT * FROM prev`;

      const normalized = normalizeReplaceValuesConfig(
        config as Record<string, unknown>,
      );
      const col = qIdent(normalized.column);
      const colType = normalized.columnType || "text";
      const find = normalized.find ?? "";
      const replace = normalized.replace ?? "";
      const operator = normalized.operator || "equals";
      const replaceScope = normalized.replaceScope || "whole_cell";
      const caseSensitive = Boolean(normalized.caseSensitive);
      const isTextLike = colType === "text" || colType === "category";

      // Only swap the matching text inside the cell (keep the rest).
      if (
        replaceScope === "matching_text" &&
        isTextLike &&
        operator === "contains"
      ) {
        if (!find) return `SELECT * FROM prev`;
        let expr: string;
        if (caseSensitive) {
          expr = `REPLACE(CAST(${col} AS VARCHAR), ${qLit(find)}, ${qLit(replace)})`;
        } else {
          const pattern = String(find).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          expr = `REGEXP_REPLACE(CAST(${col} AS VARCHAR), ${qLit(pattern)}, ${qLit(replace)}, 'gi')`;
        }
        return `SELECT * REPLACE (${expr} AS ${col}) FROM prev`;
      }

      const condition = buildReplaceMatchCondition(
        normalized as unknown as Record<string, unknown>,
      );
      if (!condition) return `SELECT * FROM prev`;
      const thenVal = quoteFilterValue(replace, colType);
      const expr = `CASE WHEN ${condition} THEN ${thenVal} ELSE ${col} END`;
      return `SELECT * REPLACE (\n  ${expr}\n  AS ${col}\n) FROM prev`;
    },
  },

  {
    kind: "remove_errors",
    category: "values",
    name: "Remove errors",
    description: "Fix or remove cells that fail the expected type",
    defaultConfig: { column: "", targetType: "number", fixes: [] },
    buildSql(config) {
      const cfg = config as ErrorFixConfig;
      if (!cfg.column) return `SELECT * FROM prev`;
      const col = qIdent(cfg.column);
      const duckType = TYPE_MAP[cfg.targetType || ""] || "DOUBLE";
      const fixes = (cfg.fixes || []).filter((f) => {
        const row = Number(f?.row);
        return (
          Number.isFinite(row) &&
          row > 0 &&
          f.newValue != null &&
          String(f.newValue) !== ""
        );
      });

      if (!fixes.length) {
        return `SELECT * FROM prev WHERE TRY_CAST(${col} AS ${duckType}) IS NOT NULL`;
      }

      const whenClauses = fixes
        .map(
          (f) =>
            `WHEN ${Number(f.row)} THEN TRY_CAST(${qLit(f.newValue)} AS ${duckType})`,
        )
        .join("\n      ");

      return `WITH __numbered AS (
  SELECT *, ROW_NUMBER() OVER () AS __rn FROM prev
), __fixed AS (
  SELECT * REPLACE (
    CASE __rn
      ${whenClauses}
      ELSE TRY_CAST(${col} AS ${duckType})
    END AS ${col}
  ) FROM __numbered
)
SELECT * EXCLUDE (__rn) FROM __fixed WHERE ${col} IS NOT NULL`;
    },
  },

  {
    kind: "fix_errors",
    category: "values",
    name: "Fix errors",
    description: "Replace error values cell-by-cell or with a default",
    defaultConfig: {
      column: "",
      targetType: "number",
      defaultValue: "",
      fixes: [],
    },
    buildSql(config) {
      const cfg = config as ErrorFixConfig;
      if (!cfg.column) return `SELECT * FROM prev`;
      const duckType = TYPE_MAP[cfg.targetType || ""] || "DOUBLE";
      const col = qIdent(cfg.column);
      const defaultExpr = `TRY_CAST(${qLit(cfg.defaultValue)} AS ${duckType})`;
      const fixes = (cfg.fixes || []).filter((f) => {
        const row = Number(f?.row);
        return (
          Number.isFinite(row) &&
          row > 0 &&
          f.newValue != null &&
          String(f.newValue) !== ""
        );
      });

      if (!fixes.length) {
        return `SELECT * REPLACE (
  CASE
    WHEN TRY_CAST(${col} AS ${duckType}) IS NULL THEN ${defaultExpr}
    ELSE TRY_CAST(${col} AS ${duckType})
  END AS ${col}
) FROM prev`;
      }

      const whenClauses = fixes
        .map(
          (f) =>
            `WHEN ${Number(f.row)} THEN TRY_CAST(${qLit(f.newValue)} AS ${duckType})`,
        )
        .join("\n      ");

      return `WITH __numbered AS (
  SELECT *, ROW_NUMBER() OVER () AS __rn FROM prev
), __fixed AS (
  SELECT * REPLACE (
    CASE __rn
      ${whenClauses}
      ELSE COALESCE(TRY_CAST(${col} AS ${duckType}), ${defaultExpr})
    END AS ${col}
  ) FROM __numbered
)
SELECT * EXCLUDE (__rn) FROM __fixed`;
    },
  },
];