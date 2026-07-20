// "Transform" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (clean_text, add_index,
// formula_column, pivot, unpivot, expand_list, expand_struct) into typed
// StepDefs. buildSql emits SQL that references the previous step via the
// literal token `prev` (resolved to the prior CTE name by engine/cteBuilder).

import type { StepDef } from "./types";
import { qIdent, qLit, normalizePivotConfig } from "./helpers";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

interface CleanTextConfig {
  column?: string;
  /** New multi-op shape: compose outer-to-inner, e.g. ["trim","lower"] → TRIM(LOWER(col)). */
  operations?: string[];
  /** Legacy single-op shape: one of trim/lower/upper/regex. */
  operation?: string;
  pattern?: string;
  replacement?: string;
}

interface AddIndexConfig {
  /** New field name (task spec). */
  newColumnName?: string;
  /** Legacy field name from pwa_duckdb. */
  columnName?: string;
  /** Optional sort column for deterministic ordering. */
  sortColumn?: string;
  sortDirection?: string;
}

interface FormulaColumnConfig {
  newName?: string;
  /** DuckDB SQL expression for the new column. */
  expressionSql?: string;
}

interface PivotConfig {
  indexCols?: string[];
  indexCol?: string;
  pivotCol?: string;
  pivotValues?: string[];
  useAllValues?: boolean;
  aggregations?: { column?: string; fn?: string; alias?: string }[];
  valueCol?: string;
  agg?: string;
}

interface UnpivotConfig {
  idCols?: string[];
  valueCols?: string[];
  nameCol?: string;
  valueCol?: string;
}

interface ExpandListConfig {
  column?: string;
}

interface ExpandStructConfig {
  column?: string;
  fields?: string[];
}

// --- helpers ----------------------------------------------------------------

/** Apply a single text op to an expression (no CAST wrapper, for composition). */
function applyCleanOp(op: string, expr: string, cfg: CleanTextConfig): string {
  switch (op) {
    case "upper":
      return `UPPER(${expr})`;
    case "lower":
      return `LOWER(${expr})`;
    case "trim":
      return `TRIM(${expr})`;
    case "clean":
      // Strip non-printable characters, then collapse internal whitespace.
      return `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(${expr}, '[^\\x20-\\x7E]+', ''), '\\s+', ' '))`;
    case "regex":
      return `REGEXP_REPLACE(${expr}, ${qLit(cfg.pattern || "")}, ${qLit(cfg.replacement || "")})`;
    default:
      return `TRIM(${expr})`;
  }
}

// --- step definitions -------------------------------------------------------

export const transformSteps: StepDef[] = [
  {
    kind: "clean_text",
    category: "transform",
    name: "Clean text",
    description: "Trim, change case, or regex replace text",
    hidden: true,
    defaultConfig: { column: "", operations: [], operation: "trim", pattern: "", replacement: "" },
    buildSql(config) {
      const cfg = config as CleanTextConfig;
      if (!cfg.column) return `SELECT * FROM prev`;
      const col = qIdent(cfg.column);

      // New multi-op composition: ["trim","lower"] → TRIM(LOWER(col)).
      // Operations compose outer-to-inner (first element is the outermost
      // wrap), so we fold from the right, applying the last op first.
      if (Array.isArray(cfg.operations) && cfg.operations.length) {
        let expr = col;
        for (let i = cfg.operations.length - 1; i >= 0; i -= 1) {
          expr = applyCleanOp(cfg.operations[i], expr, cfg);
        }
        return `SELECT * REPLACE (${expr} AS ${col}) FROM prev`;
      }

      // Legacy single-op shape (matches the original catalog exactly).
      let expr: string;
      switch (cfg.operation) {
        case "upper":
          expr = `UPPER(CAST(${col} AS VARCHAR))`;
          break;
        case "lower":
          expr = `LOWER(CAST(${col} AS VARCHAR))`;
          break;
        case "trim":
          expr = `TRIM(CAST(${col} AS VARCHAR))`;
          break;
        case "regex":
          expr = `REGEXP_REPLACE(CAST(${col} AS VARCHAR), ${qLit(cfg.pattern || "")}, ${qLit(cfg.replacement || "")})`;
          break;
        default:
          expr = `TRIM(CAST(${col} AS VARCHAR))`;
      }
      return `SELECT * REPLACE (${expr} AS ${col}) FROM prev`;
    },
  },

  {
    kind: "add_index",
    category: "transform",
    name: "Index",
    description: "Add a row number / index column",
    defaultConfig: { newColumnName: "row_index", sortColumn: "", sortDirection: "ASC" },
    buildSql(config) {
      const cfg = config as AddIndexConfig;
      const col = cfg.newColumnName || cfg.columnName || "row_index";
      const over = cfg.sortColumn
        ? `OVER (ORDER BY ${qIdent(cfg.sortColumn)} ${String(cfg.sortDirection || "ASC").toUpperCase()})`
        : "OVER ()";
      return `SELECT *, ROW_NUMBER() ${over} AS ${qIdent(col)} FROM prev`;
    },
  },

  {
    kind: "formula_column",
    category: "transform",
    name: "Formula column (SQL)",
    description: "Add a column with a DuckDB SQL expression",
    defaultConfig: { newName: "result", expressionSql: "" },
    buildSql(config) {
      const cfg = config as FormulaColumnConfig;
      const name = cfg.newName || "result";
      const rawExpr = String(cfg.expressionSql || "").trim();
      if (rawExpr) {
        return `SELECT *, ${rawExpr} AS ${qIdent(name)} FROM prev`;
      }
      // No expression — emit a NULL column.
      return `SELECT *, (NULL) AS ${qIdent(name)} FROM prev`;
    },
  },

  {
    kind: "pivot",
    category: "transform",
    name: "Pivot",
    description: "Turn unique values into columns (Power Query–style)",
    defaultConfig: {
      indexCols: [],
      pivotCol: "",
      pivotValues: [],
      useAllValues: true,
      aggregations: [{ column: "", fn: "SUM", alias: "" }],
      // Legacy fields kept for older projects
      indexCol: "",
      valueCol: "",
      agg: "sum",
    },
    buildSql(config) {
      const cfg = normalizePivotConfig(config as PivotConfig);
      if (!cfg.pivotCol || !cfg.aggregations.length) {
        return `SELECT * FROM prev`;
      }

      const onClause =
        !cfg.useAllValues && cfg.pivotValues.length
          ? `${qIdent(cfg.pivotCol)} IN (${cfg.pivotValues.map(qLit).join(", ")})`
          : qIdent(cfg.pivotCol);

      const usingClause = cfg.aggregations
        .map((a) => {
          const fn = String(a.fn || "SUM").toUpperCase();
          const col = qIdent(a.column || "");
          let expr: string;
          if (fn === "COUNT_DISTINCT") expr = `COUNT(DISTINCT ${col})`;
          else if (fn === "FIRST") expr = `FIRST(${col})`;
          else if (fn === "ANY_VALUE") expr = `ANY_VALUE(${col})`;
          else if (fn === "MEDIAN") expr = `MEDIAN(${col})`;
          else expr = `${fn}(${col})`;
          if (a.alias) expr += ` AS ${qIdent(a.alias)}`;
          return expr;
        })
        .join(", ");

      const groupClause = cfg.indexCols.length
        ? `\nGROUP BY ${cfg.indexCols.map(qIdent).join(", ")}`
        : "";

      return `PIVOT prev\nON ${onClause}\nUSING ${usingClause}${groupClause}`;
    },
  },

  {
    kind: "unpivot",
    category: "transform",
    name: "Unpivot",
    description: "Turn columns into rows",
    defaultConfig: { idCols: [], valueCols: [], nameCol: "attribute", valueCol: "value" },
    buildSql(config) {
      const cfg = config as UnpivotConfig;
      const idClause = (cfg.idCols || []).map(qIdent).join(", ");
      const unpivotCols = (cfg.valueCols || []).map(qIdent).join(", ");
      if (!unpivotCols) return `SELECT * FROM prev`;
      const byClause = idClause ? `\nBY ${idClause}` : "";
      return `UNPIVOT prev\nON ${unpivotCols}\nINTO NAME ${qIdent(cfg.nameCol || "attribute")} VALUE ${qIdent(cfg.valueCol || "value")}${byClause}`;
    },
  },

  {
    kind: "expand_list",
    category: "transform",
    name: "Expand nested data",
    description: "Expand list/struct column into rows",
    hidden: true,
    defaultConfig: { column: "" },
    buildSql(config) {
      const cfg = config as ExpandListConfig;
      if (!cfg.column) return `SELECT * FROM prev`;
      const col = qIdent(cfg.column);
      return `SELECT * EXCLUDE (${col}), UNNEST(${col}) AS ${qIdent(cfg.column + "_item")}\nFROM prev`;
    },
  },

  {
    kind: "expand_struct",
    category: "transform",
    name: "Expand struct fields",
    description: "Pull struct fields into separate columns",
    hidden: true,
    defaultConfig: { column: "", fields: [] },
    buildSql(config) {
      const cfg = config as ExpandStructConfig;
      if (!cfg.column || !cfg.fields?.length) return `SELECT * FROM prev`;
      const col = qIdent(cfg.column);
      const extras = cfg.fields
        .map((f) => `struct_extract(${col}, ${qLit(f)}) AS ${qIdent(f)}`)
        .join(", ");
      return `SELECT *, ${extras} FROM prev`;
    },
  },
];