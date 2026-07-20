// "Rows" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (filter_rows, sort_rows,
// remove_duplicates, fill_null) into typed StepDefs. buildSql emits SQL that
// references the previous step via the literal token `prev` (resolved to the
// prior CTE name by engine/cteBuilder).

import type { StepDef } from "./types";
import {
  qIdent,
  quoteFilterValue,
  buildFilterWhereClause,
  type FilterConfig,
} from "./helpers";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

// FilterConfig already carries mode / logic / condition / rules; this is just
// a type alias used for readability at cast sites.
type FilterRowsConfig = FilterConfig;

interface SortSpec {
  column: string;
  direction?: string;
}

interface SortRowsConfig {
  /** New shape: explicit sort list. */
  sorts?: SortSpec[];
  /** Legacy shape (original catalog): orderBy list. */
  orderBy?: SortSpec[];
}

interface RemoveDuplicatesConfig {
  columns?: string[];
}

interface FillNullConfig {
  column?: string;
  value?: unknown;
  /** Optional column type — text→quoted literal, number/integer→raw. */
  columnType?: string;
}

// --- step definitions -------------------------------------------------------

export const rowsSteps: StepDef[] = [
  {
    kind: "filter_rows",
    category: "rows",
    name: "Filter rows",
    description: "Keep rows matching a condition",
    defaultConfig: {
      mode: "builder",
      logic: "AND",
      groups: [
        { logic: "AND", rules: [{ column: "", operator: "equals", value: "", valueTo: "" }] },
      ],
      rules: [{ column: "", operator: "equals", value: "", valueTo: "" }],
      condition: "1=1",
    },
    buildSql(config) {
      const cfg = config as FilterRowsConfig;
      const where = buildFilterWhereClause(cfg);
      return `SELECT * FROM prev WHERE ${where}`;
    },
  },

  {
    kind: "sort_rows",
    category: "rows",
    name: "Sort rows",
    description: "Sort by columns",
    defaultConfig: { sorts: [] },
    buildSql(config) {
      const cfg = config as SortRowsConfig;
      const sorts = (cfg.sorts?.length ? cfg.sorts : cfg.orderBy) || [];
      if (!sorts.length) return `SELECT * FROM prev`;
      const clause = sorts
        .map((o) => `${qIdent(o.column)} ${o.direction || "ASC"}`)
        .join(", ");
      return `SELECT * FROM prev ORDER BY ${clause}`;
    },
  },

  {
    kind: "remove_duplicates",
    category: "rows",
    name: "Remove duplicates",
    description: "Remove duplicate rows",
    defaultConfig: { columns: [] },
    buildSql(config) {
      const cfg = config as RemoveDuplicatesConfig;
      if (!cfg.columns?.length) {
        return `SELECT DISTINCT * FROM prev`;
      }
      const partition = cfg.columns.map(qIdent).join(", ");
      return `SELECT * FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY 1) AS _rn
  FROM prev
) WHERE _rn = 1`;
    },
  },

  {
    kind: "fill_null",
    category: "rows",
    name: "Fill blanks",
    description: "Replace null values",
    defaultConfig: { column: "", value: "", columnType: "text" },
    buildSql(config) {
      const cfg = config as FillNullConfig;
      if (!cfg.column) return `SELECT * FROM prev`;
      // Value typed via columnType when present: text→quoted, number→raw.
      const valueSql = quoteFilterValue(cfg.value, cfg.columnType || "text");
      return `SELECT * REPLACE (COALESCE(${qIdent(cfg.column)}, ${valueSql}) AS ${qIdent(cfg.column)}) FROM prev`;
    },
  },
];