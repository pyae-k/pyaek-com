// "Columns" category step definitions.
// Ported from pwa_duckdb/js/step-catalog.js (promote_headers, pick_columns,
// change_type, duplicate_column) into typed StepDefs. buildSql emits SQL that
// references the previous step via the literal token `prev` (resolved to the
// prior CTE name by engine/cteBuilder).

import type { StepDef } from "./types";
import {
  qIdent,
  qLit,
  TYPE_MAP,
  buildNumberCastSql,
} from "./helpers";
import { buildDateTypeReplacementSql } from "../lib/dateType";

// --- config shapes (narrowed with `as` inside buildSql) ---------------------

interface PromoteHeadersConfig {
  mode?: "promote" | "custom" | "demote" | string;
  headerRow?: number | string;
  customNames?: string[];
  mappings?: { from: string; to: string }[];
  allColumns?: string[];
}

interface PickColumnsConfig {
  columns?: string[];
  mode?: "keep" | "remove" | string;
}

interface ChangeTypeConfig {
  /** New shape: explicit per-column type changes. */
  columns?: { column: string; type: string }[];
  /** Legacy shape: { [columnName]: targetType }. */
  types?: Record<string, string>;
  /** Legacy single-column shape. */
  column?: string;
  targetType?: string;
  dateFormats?: Record<string, string>;
}

interface DuplicateColumnConfig {
  duplicates?: { column: string; newName: string }[];
  /** Legacy single-column shape. */
  column?: string;
  newName?: string;
}

// --- step definitions -------------------------------------------------------

export const columnsSteps: StepDef[] = [
  {
    kind: "promote_headers",
    category: "columns",
    name: "Set column names",
    description:
      "Use a row as headers, enter custom names, or demote headers to data",
    defaultConfig: {
      mode: "custom",
      headerRow: 1,
      customNames: [],
      mappings: [],
      allColumns: [],
    },
    buildSql(config) {
      const cfg = config as PromoteHeadersConfig;

      if (cfg.mode === "demote") {
        const cols = cfg.allColumns?.length ? cfg.allColumns : [];
        if (!cols.length) return `SELECT * FROM prev`;
        const unionCols = cols
          .map((c) => `${qLit(c)} AS ${qIdent(c)}`)
          .join(", ");
        const dataCols = cols.map((c) => qIdent(c)).join(", ");
        return `SELECT ${unionCols}\nUNION ALL BY NAME\nSELECT ${dataCols} FROM prev`;
      }

      if (cfg.mappings?.length) {
        const cols = cfg.mappings
          .map((m) => `${qIdent(m.from)} AS ${qIdent(m.to)}`)
          .join(", ");
        const offset =
          cfg.mode === "promote"
            ? Math.max(1, parseInt(String(cfg.headerRow), 10) || 1)
            : 0;
        if (offset > 0) {
          return `SELECT ${cols} FROM (SELECT * FROM prev OFFSET ${offset})`;
        }
        return `SELECT ${cols} FROM prev`;
      }

      if (
        cfg.mode === "custom" &&
        cfg.customNames?.length &&
        cfg.allColumns?.length
      ) {
        const cols = cfg.allColumns
          .map((c, i) => `${qIdent(c)} AS ${qIdent(cfg.customNames![i] || c)}`)
          .join(", ");
        return `SELECT ${cols} FROM prev`;
      }

      if (cfg.allColumns?.length) {
        const offset = Math.max(1, parseInt(String(cfg.headerRow), 10) || 1);
        const cols = cfg.allColumns
          .map((c, i) => `${qIdent(c)} AS ${qIdent("col_" + (i + 1))}`)
          .join(", ");
        return `SELECT ${cols} FROM (SELECT * FROM prev OFFSET ${offset})`;
      }

      const offset = Math.max(1, parseInt(String(cfg.headerRow), 10) || 1);
      return `SELECT * FROM (SELECT * FROM prev OFFSET ${offset})`;
    },
  },

  {
    kind: "pick_columns",
    category: "columns",
    name: "Pick columns",
    description: "Choose columns to keep",
    defaultConfig: { columns: [], mode: "keep" },
    buildSql(config) {
      const cfg = config as PickColumnsConfig;
      if (!cfg.columns?.length) return `SELECT * FROM prev`;
      const cols = cfg.columns.map(qIdent).join(", ");
      if (cfg.mode === "remove") {
        return `SELECT * EXCLUDE (${cols}) FROM prev`;
      }
      return `SELECT ${cols} FROM prev`;
    },
  },

  {
    kind: "change_type",
    category: "columns",
    name: "Change type",
    description: "Change column data types",
    defaultConfig: { columns: [], types: {}, dateFormats: {} },
    buildSql(config) {
      const cfg = config as ChangeTypeConfig;
      const types: Record<string, string> = { ...(cfg.types || {}) };

      // New shape: columns: [{ column, type }].
      if (Array.isArray(cfg.columns)) {
        for (const c of cfg.columns) {
          if (c && c.column && c.type) types[c.column] = c.type;
        }
      }
      // Legacy single-column shape.
      if (!Object.keys(types).length && cfg.column && cfg.targetType) {
        types[cfg.column] = cfg.targetType;
      }

      const changes = Object.entries(types).filter(
        ([col, type]) => col && type,
      );
      if (!changes.length) return `SELECT * FROM prev`;

      const replacements = changes
        .map(([col, type]) => {
          const ident = qIdent(col);
          if (type === "date") {
            const primary = cfg.dateFormats?.[col] || null;
            return `${buildDateTypeReplacementSql(ident, primary)} AS ${ident}`;
          }
          const duckType = TYPE_MAP[type] || "VARCHAR";
          // Use number cleaning for numeric types to handle formatted values
          if (duckType === "DOUBLE" || duckType === "BIGINT" || duckType === "FLOAT" || duckType === "REAL" || duckType.startsWith("DECIMAL")) {
            return `${buildNumberCastSql(ident, duckType)} AS ${ident}`;
          }
          return `TRY_CAST(${ident} AS ${duckType}) AS ${ident}`;
        })
        .join(", ");

      return `SELECT * REPLACE (${replacements}) FROM prev`;
    },
  },

  {
    kind: "duplicate_column",
    category: "columns",
    name: "Duplicate column",
    description: "Copy one or more columns with new names",
    defaultConfig: { duplicates: [] },
    buildSql(config) {
      const cfg = config as DuplicateColumnConfig;
      const duplicates = cfg.duplicates?.length
        ? cfg.duplicates
        : cfg.column && cfg.newName
          ? [{ column: cfg.column, newName: cfg.newName }]
          : [];
      const parts = duplicates
        .filter((d) => d.column && d.newName)
        .map((d) => `${qIdent(d.column)} AS ${qIdent(d.newName)}`);
      if (!parts.length) return `SELECT * FROM prev`;
      return `SELECT *, ${parts.join(", ")} FROM prev`;
    },
  },
];