// Config dialogs for the "columns" category. Each is a controlled form bound to
// the step's config via StepDialogProps.onChange; the store regenerates SQL.

import { useEffect, useState } from "react";
import type { StepDialogProps } from "../../steps/types";
import {
  Field,
  TextInput,
  Select,
  NumberInput,
  ColumnMultiSelect,
  cfg,
} from "./controls";
import { withConnection } from "../../lib/duckdb";

const TYPE_OPTIONS = [
  "TEXT", "VARCHAR", "INTEGER", "BIGINT", "HUGEINT", "DOUBLE", "FLOAT", "DECIMAL", "BOOLEAN",
  "DATE", "TIMESTAMP", "TIME", "BLOB",
].map((t) => ({ value: t, label: t }));

export function PromoteHeadersDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const mode = cfg<string>(config, "mode", "custom");
  const headerRow = cfg(config, "headerRow", 1);
  const customNames = cfg<string[]>(config, "customNames", []);
  const allColumns = cfg<string[]>(config, "allColumns", prevColumns ?? []);

  // Auto-populate columns when in custom mode and prevColumns are available
  useEffect(() => {
    if (mode === "custom" && prevColumns?.length && !allColumns.length) {
      onChange({ ...config, mode: "custom", allColumns: prevColumns, customNames: [...prevColumns] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prevColumns?.join(",")]);

  const setMode = (m: string) => {
    if (m === "custom" && !allColumns.length && prevColumns?.length) {
      onChange({ ...config, mode: m, allColumns: prevColumns, customNames: [...prevColumns] });
    } else {
      onChange({ ...config, mode: m });
    }
  };

  const setCustomName = (i: number, v: string) => {
    const next = [...customNames];
    next[i] = v;
    onChange({ ...config, customNames: next });
  };

  return (
    <div className="step-dialog-body">
      <Field label="Mode">
        <Select
          value={mode}
          onChange={setMode}
          options={[
            { value: "custom", label: "Set custom column names" },
            { value: "promote", label: "Promote row N to headers" },
            { value: "demote", label: "Demote headers to a data row" },
          ]}
        />
      </Field>
      {mode === "promote" && (
        <Field label="Header row number" hint="1 = first row">
          <NumberInput value={headerRow} min={1} onChange={(v) => onChange({ ...config, headerRow: v })} />
        </Field>
      )}
      {mode === "custom" && (
        <>
          <Field label="Columns" hint="Names from the previous step">
            <ColumnMultiSelect
              columns={prevColumns ?? []}
              selected={allColumns}
              onChange={(next) => onChange({
                ...config,
                allColumns: next,
                customNames: next.map((c, i) => customNames[i] ?? c),
              })}
            />
          </Field>
          {allColumns.map((col, i) => (
            <Field key={col} label={`"${col}" →`}>
              <TextInput value={customNames[i] ?? col} onChange={(v) => setCustomName(i, v)} />
            </Field>
          ))}
        </>
      )}
    </div>
  );
}

export function PickColumnsDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const mode = cfg(config, "mode", "keep");
  const columns = cfg<string[]>(config, "columns", []);
  return (
    <div className="step-dialog-body">
      <Field label="Action">
        <Select
          value={mode}
          onChange={(v) => onChange({ ...config, mode: v })}
          options={[
            { value: "keep", label: "Keep selected columns" },
            { value: "remove", label: "Remove selected columns" },
          ]}
        />
      </Field>
      <Field label="Columns">
        <ColumnMultiSelect
          columns={prevColumns ?? []}
          selected={columns}
          onChange={(next) => onChange({ ...config, columns: next })}
        />
      </Field>
    </div>
  );
}


export function ChangeTypeDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const columns: Array<{ column: string; type: string }> = cfg(config, "columns", []);
  const [detecting, setDetecting] = useState(false);

  // If the dialog has no rows yet but we know the previous columns, seed the list
  // with every column and a sensible default type based on its Arrow type name.
  useEffect(() => {
    if (columns.length || !prevColumns?.length) return;
    const seeded = prevColumns.map((c) => ({
      column: c,
      type: suggestType(c),
    }));
    onChange({ ...config, columns: seeded });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevColumns?.join(",")]);

  const setRow = (i: number, patch: Partial<{ column: string; type: string }>) => {
    const next = columns.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange({ ...config, columns: next });
  };
  const addRow = () => onChange({ ...config, columns: [...columns, { column: "", type: "TEXT" }] });
  const removeRow = (i: number) => onChange({ ...config, columns: columns.filter((_, j) => j !== i) });

  const detectTypes = async () => {
    if (!prevColumns?.length) return;
    setDetecting(true);
    try {
      // Run DESCRIBE on the previous step to get actual DuckDB types
      const sql = `DESCRIBE SELECT * FROM prev`;
      const result = await withConnection(async (conn) => {
        const table = await conn.query(sql);
        const rows: Array<{ column_name: string; column_type: string }> = [];
        for (const row of table) {
          const r = row as Record<string, unknown>;
          rows.push({
            column_name: String(r.column_name ?? ""),
            column_type: String(r.column_type ?? ""),
          });
        }
        return rows;
      });

      // Map DuckDB types to our type options
      const typeMap: Record<string, string> = {
        VARCHAR: "TEXT",
        TEXT: "TEXT",
        STRING: "TEXT",
        INTEGER: "INTEGER",
        BIGINT: "BIGINT",
        HUGEINT: "HUGEINT",
        SMALLINT: "INTEGER",
        TINYINT: "INTEGER",
        DOUBLE: "DOUBLE",
        FLOAT: "FLOAT",
        REAL: "FLOAT",
        DECIMAL: "DECIMAL",
        NUMERIC: "DECIMAL",
        BOOLEAN: "BOOLEAN",
        BOOL: "BOOLEAN",
        DATE: "DATE",
        TIMESTAMP: "TIMESTAMP",
        TIMESTAMPTZ: "TIMESTAMP",
        TIME: "TIME",
        BLOB: "BLOB",
      };

      const detected = result
        .filter((r) => prevColumns.includes(r.column_name))
        .map((r) => ({
          column: r.column_name,
          type: typeMap[r.column_type.toUpperCase()] || "TEXT",
        }));

      if (detected.length > 0) {
        onChange({ ...config, columns: detected });
      }
    } catch {
      // Fallback: keep existing types
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="step-dialog-body">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {columns.length} column{columns.length !== 1 ? "s" : ""}
        </span>
        <button onClick={detectTypes} disabled={detecting || !prevColumns?.length} style={{ fontSize: 11 }}>
          {detecting ? "Detecting..." : "Detect types"}
        </button>
      </div>
      <div className="step-rows">
        {columns.map((row, i) => (
          <div key={i} className="step-row">
            <Select
              value={row.column}
              onChange={(v) => setRow(i, { column: v })}
              options={(prevColumns ?? []).map((c) => ({ value: c, label: c }))}
            />
            <Select value={row.type} onChange={(v) => setRow(i, { type: v })} options={TYPE_OPTIONS} />
            <button className="step-icon-btn" title="Remove" onClick={() => removeRow(i)}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={addRow}>+ Add column</button>
    </div>
  );
}

function suggestType(columnName: string): string {
  const lower = columnName.toLowerCase();
  if (lower.includes("date")) return "DATE";
  if (lower.includes("time") && !lower.includes("timeout")) return "TIMESTAMP";
  if (lower.includes("id") || lower.includes("count") || lower.includes("age")) return "INTEGER";
  if (lower.includes("amount") || lower.includes("price") || lower.includes("value") || lower.includes("qty")) return "DOUBLE";
  return "TEXT";
}

export function DuplicateColumnDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const duplicates = cfg<Array<{ column: string; newName: string }>>(config, "duplicates", []);

  const selectedColumns = duplicates.map((d) => d.column);
  const available = prevColumns ?? [];

  const rename = (col: string, newName: string) => {
    onChange({
      ...config,
      duplicates: duplicates.map((d) => (d.column === col ? { ...d, newName } : d)),
    });
  };

  return (
    <div className="step-dialog-body">
      <Field label="Columns to duplicate">
        <ColumnMultiSelect
          columns={available}
          selected={selectedColumns}
          onChange={(next) => {
            const nextSet = new Set(next);
            const added = next.filter((c) => !duplicates.some((d) => d.column === c));
            const removed = duplicates.filter((d) => !nextSet.has(d.column));
            const kept = duplicates.filter((d) => nextSet.has(d.column));
            const newDups = [
              ...kept,
              ...added.map((col) => ({ column: col, newName: uniqueCopyName(col, kept.concat(removed)) })),
            ];
            onChange({ ...config, duplicates: newDups });
          }}
        />
      </Field>
      {duplicates.length > 0 && (
        <div className="step-rows">
          {duplicates.map((d) => (
            <div key={d.column} className="step-row" style={{ alignItems: "center" }}>
              <span style={{ minWidth: 120, fontSize: 13 }}>{d.column}</span>
              <span style={{ color: "var(--text-muted)", padding: "0 6px" }}>→</span>
              <TextInput
                value={d.newName}
                onChange={(v) => rename(d.column, v)}
                placeholder="New column name"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function uniqueCopyName(column: string, existing: Array<{ newName: string }>): string {
  const base = `${column}_copy`;
  const names = new Set(existing.map((d) => d.newName));
  let name = base;
  let i = 2;
  while (names.has(name)) {
    name = `${base}_${i}`;
    i++;
  }
  return name;
}