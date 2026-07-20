// Config dialogs for the "transform" category (the user-facing ones).
// formula_column uses the Excel-formula translator; clean_text composes text ops.

import { useState } from "react";
import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, ColumnMultiSelect, SearchableSelect, cfg } from "./controls";
import { withConnection } from "../../lib/duckdb";

export function AddIndexDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const newColumnName = cfg(config, "newColumnName", cfg(config, "columnName", "index"));
  const sortColumn = cfg(config, "sortColumn", "");
  const sortDirection = cfg(config, "sortDirection", "ASC");
  return (
    <div className="step-dialog-body">
      <Field label="New column name">
        <TextInput value={newColumnName} onChange={(v) => onChange({ ...config, newColumnName: v })} />
      </Field>
      <Field label="Order by (optional)" hint="Leave empty for arbitrary row numbers">
        <Select
          value={sortColumn}
          onChange={(v) => onChange({ ...config, sortColumn: v })}
          options={[
            { value: "", label: "(none)" },
            ...(prevColumns ?? []).map((c) => ({ value: c, label: c })),
          ]}
        />
      </Field>
      {sortColumn && (
        <Field label="Direction">
          <Select value={sortDirection} onChange={(v) => onChange({ ...config, sortDirection: v })}
            options={[{ value: "ASC", label: "Ascending" }, { value: "DESC", label: "Descending" }]} />
        </Field>
      )}
    </div>
  );
}

const SQL_FUNCTIONS = [
  { label: "CASE WHEN", insert: "CASE WHEN condition THEN value ELSE value END" },
  { label: "COALESCE", insert: "COALESCE(column, default_value)" },
  { label: "CAST", insert: "CAST(column AS type)" },
  { label: "TRY_CAST", insert: "TRY_CAST(column AS type)" },
  { label: "LEFT", insert: "LEFT(string, count)" },
  { label: "RIGHT", insert: "RIGHT(string, count)" },
  { label: "SUBSTRING", insert: "SUBSTRING(string, start, length)" },
  { label: "LENGTH", insert: "LENGTH(string)" },
  { label: "|| (concat)", insert: " || " },
  { label: "ROUND", insert: "ROUND(number, decimals)" },
  { label: "ABS", insert: "ABS(number)" },
  { label: "DATE_DIFF", insert: "DATE_DIFF('day', start_date, end_date)" },
  { label: "EXTRACT", insert: "EXTRACT(year FROM date_column)" },
  { label: "CURRENT_DATE", insert: "CURRENT_DATE" },
  { label: "CURRENT_TIMESTAMP", insert: "CURRENT_TIMESTAMP" },
  { label: "+", insert: " + " },
  { label: "-", insert: " - " },
  { label: "*", insert: " * " },
  { label: "/", insert: " / " },
];

export function FormulaColumnDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const newName = cfg(config, "newName", "result");
  const expressionSql = cfg(config, "expressionSql", "");
  const [expr, setExpr] = useState(expressionSql);

  const apply = () => {
    onChange({ ...config, expressionSql: expr, newName });
  };

  const insertAtCursor = (text: string) => {
    setExpr((prev) => {
      // Simple append with a space separator for now
      const sep = prev && !prev.endsWith(" ") ? " " : "";
      return prev + sep + text;
    });
  };

  return (
    <div className="step-dialog-body">
      <Field label="New column name">
        <TextInput value={newName} onChange={(v) => onChange({ ...config, newName: v, expressionSql: expr })} />
      </Field>

      <Field label="SQL expression" hint={'Write a DuckDB SQL expression. Use column names directly, quoted as "name".'}>
        <textarea
          className="step-input"
          value={expr}
          rows={4}
          spellCheck={false}
          placeholder={'e.g. "amount" * 1.1 or CASE WHEN "status" = "active" THEN 1 ELSE 0 END'}
          onChange={(e) => setExpr(e.target.value)}
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
        />
      </Field>

      {prevColumns && prevColumns.length > 0 && (
        <Field label="Columns (click to insert)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {prevColumns.map((col) => (
              <button
                key={col}
                type="button"
                className="step-icon-btn"
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  padding: "2px 8px",
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: "pointer",
                }}
                onClick={() => insertAtCursor(`"${col}"`)}
                title={`Insert "${col}"`}
              >
                {col}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="SQL functions (click to insert)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {SQL_FUNCTIONS.map((fn) => (
            <button
              key={fn.label}
              type="button"
              className="step-icon-btn"
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                padding: "2px 8px",
                fontSize: 11,
                borderRadius: 4,
                cursor: "pointer",
              }}
              onClick={() => insertAtCursor(fn.insert)}
              title={`Insert ${fn.label}`}
            >
              {fn.label}
            </button>
          ))}
        </div>
      </Field>

      {expr.trim() && (
        <div style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Preview SQL
          </div>
          SELECT *, {expr.trim()} AS "{newName}" FROM prev
        </div>
      )}

      <div className="step-dialog-actions">
        <button onClick={() => { setExpr(expressionSql); onChange(config); }}>Reset</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

const AGG_FNS = [
  "SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT",
  "MEDIAN", "STDDEV", "VARIANCE", "FIRST", "ANY_VALUE",
].map((f) => ({ value: f, label: f }));

export function PivotDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const indexCols = cfg<string[]>(config, "indexCols", []);
  const pivotCol = cfg(config, "pivotCol", "");
  const useAllValues = cfg(config, "useAllValues", true);
  const pivotValues = cfg<string[]>(config, "pivotValues", []);
  const aggregations: Array<{ column: string; fn: string; alias: string }> = cfg(config, "aggregations", []);
  const [distinctValues, setDistinctValues] = useState<string[]>([]);
  const [loadingDistinct, setLoadingDistinct] = useState(false);

  // Load distinct values when pivot column changes
  const loadDistinctValues = async () => {
    if (!pivotCol) return;
    setLoadingDistinct(true);
    try {
      const sql = `SELECT DISTINCT "${pivotCol}" FROM prev ORDER BY "${pivotCol}" LIMIT 200`;
      const result = await withConnection(async (conn) => {
        const table = await conn.query(sql);
        const vals: string[] = [];
        for (const row of table) {
          const v = (row as Record<string, unknown>)[pivotCol];
          vals.push(v === null || v === undefined ? "(null)" : String(v));
        }
        return vals;
      });
      setDistinctValues(result);
    } catch {
      setDistinctValues([]);
    } finally {
      setLoadingDistinct(false);
    }
  };

  const setAgg = (i: number, patch: Partial<{ column: string; fn: string; alias: string }>) => {
    const next = aggregations.map((a, j) => (j === i ? { ...a, ...patch } : a));
    onChange({ ...config, aggregations: next });
  };
  const addAgg = () => onChange({
    ...config,
    aggregations: [...aggregations, { fn: "SUM", column: "", alias: "" }],
  });
  const removeAgg = (i: number) => onChange({ ...config, aggregations: aggregations.filter((_, j) => j !== i) });

  // Build a preview of the pivot result shape
  const previewCols: string[] = [];
  if (indexCols.length > 0) previewCols.push(...indexCols);
  const displayValues = useAllValues
    ? distinctValues.slice(0, 5)
    : pivotValues.slice(0, 5);
  for (const agg of aggregations) {
    if (!agg.column) continue;
    for (const val of displayValues) {
      const alias = agg.alias || `${agg.fn}_${agg.column}`;
      previewCols.push(`${val}_${alias}`);
    }
  }

  return (
    <div className="step-dialog-body">
      {/* Section: Index Columns */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
          Index Columns
        </div>
        <Field label="Columns that stay as rows (group by)">
          <ColumnMultiSelect
            columns={prevColumns ?? []}
            selected={indexCols}
            onChange={(next) => onChange({ ...config, indexCols: next })}
          />
        </Field>
      </div>

      {/* Section: Pivot Column */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
          Pivot Column
        </div>
        <Field label="Column whose unique values become new columns">
          <Select
            value={pivotCol}
            onChange={(v) => { onChange({ ...config, pivotCol: v }); setDistinctValues([]); }}
            options={[
              { value: "", label: "(select)" },
              ...(prevColumns ?? []).map((c) => ({ value: c, label: c })),
            ]}
          />
        </Field>
        {pivotCol && (
          <div style={{ marginTop: 4 }}>
            <button onClick={loadDistinctValues} disabled={loadingDistinct} style={{ fontSize: 11 }}>
              {loadingDistinct ? "Loading..." : `Show distinct values (${distinctValues.length} loaded)`}
            </button>
            {distinctValues.length > 0 && (
              <div style={{
                marginTop: 6,
                maxHeight: 120,
                overflowY: "auto",
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
                padding: "4px 0",
              }}>
                {distinctValues.map((v) => (
                  <span key={v} style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    color: "var(--text-secondary)",
                  }}>
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section: Pivot Values */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
          Pivot Values
        </div>
        <Field label="">
          <label className="step-checkbox">
            <input
              type="checkbox"
              checked={useAllValues}
              onChange={(e) => onChange({ ...config, useAllValues: e.target.checked })}
            />
            <span>Use all distinct values</span>
          </label>
        </Field>
        {!useAllValues && (
          <Field label="Select specific values">
            <SearchableSelect
              value={pivotValues[0] || ""}
              onChange={(v) => {
                const next = pivotValues.includes(v)
                  ? pivotValues.filter((pv) => pv !== v)
                  : [...pivotValues, v];
                onChange({ ...config, pivotValues: next });
              }}
              options={distinctValues.map((v) => ({ value: v, label: v }))}
              placeholder="Search and select values..."
            />
            {pivotValues.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                {pivotValues.map((v) => (
                  <span key={v} style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    background: "var(--accent)",
                    color: "white",
                    borderRadius: 3,
                    cursor: "pointer",
                  }}
                    onClick={() => onChange({ ...config, pivotValues: pivotValues.filter((pv) => pv !== v) })}
                    title="Click to remove"
                  >
                    {v} ✕
                  </span>
                ))}
              </div>
            )}
          </Field>
        )}
      </div>

      {/* Section: Aggregations */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
          Aggregations
        </div>
        <Field label="Value columns and aggregation functions">
          <div className="step-rows">
            {aggregations.map((a, i) => (
              <div key={i} className="step-row">
                <Select value={a.fn} onChange={(v) => setAgg(i, { fn: v })} options={AGG_FNS} />
                <Select value={a.column} onChange={(v) => setAgg(i, { column: v })}
                  options={[{ value: "", label: "(col)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
                <TextInput value={a.alias} onChange={(v) => setAgg(i, { alias: v })} placeholder="alias" />
                <button className="step-icon-btn" title="Remove" onClick={() => removeAgg(i)}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={addAgg}>+ Add aggregation</button>
        </Field>
      </div>

      {/* Visual preview */}
      {previewCols.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
            Preview (first {displayValues.length} values)
          </div>
          <div style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            overflow: "hidden",
            fontSize: 11,
          }}>
            <div style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-tertiary)",
            }}>
              {previewCols.slice(0, 6).map((col, i) => (
                <div key={i} style={{
                  padding: "4px 8px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  borderRight: i < previewCols.length - 1 ? "1px solid var(--border)" : "none",
                  minWidth: 80,
                }}>
                  {col}
                </div>
              ))}
              {previewCols.length > 6 && (
                <div style={{ padding: "4px 8px", color: "var(--text-muted)" }}>
                  +{previewCols.length - 6} more
                </div>
              )}
            </div>
            <div style={{ padding: "8px", color: "var(--text-muted)", textAlign: "center" }}>
              {aggregations.length > 0 ? "Pivot will create columns for each value × aggregation" : "Add an aggregation to see the result shape"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnpivotDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const idCols = cfg<string[]>(config, "idCols", []);
  const valueCols = cfg<string[]>(config, "valueCols", []);
  const nameCol = cfg(config, "nameCol", "attribute");
  const valueCol = cfg(config, "valueCol", "value");

  return (
    <div className="step-dialog-body">
      <Field label="ID columns (stay as rows)" hint="Columns that remain unchanged">
        <ColumnMultiSelect
          columns={prevColumns ?? []}
          selected={idCols}
          onChange={(next) => onChange({ ...config, idCols: next })}
        />
      </Field>

      <Field label="Value columns (unpivot)" hint="Columns to unpivot into rows">
        <ColumnMultiSelect
          columns={prevColumns ?? []}
          selected={valueCols}
          onChange={(next) => onChange({ ...config, valueCols: next })}
        />
      </Field>

      <Field label="New column names">
        <div className="step-row">
          <TextInput value={nameCol} onChange={(v) => onChange({ ...config, nameCol: v })} placeholder="attribute name" />
          <TextInput value={valueCol} onChange={(v) => onChange({ ...config, valueCol: v })} placeholder="value name" />
        </div>
      </Field>
    </div>
  );
}

export function CleanTextDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const column = cfg(config, "column", "");
  const operations: string[] = cfg(config, "operations", cfg<string[]>(config, "operation", []).length ? [cfg(config, "operation", "trim")] : []);
  const ops = ["trim", "lower", "upper", "clean"];
  const toggle = (op: string) => {
    const next = operations.includes(op) ? operations.filter((o) => o !== op) : [...operations, op];
    onChange({ ...config, operations: next });
  };
  return (
    <div className="step-dialog-body">
      <Field label="Column">
        <Select value={column} onChange={(v) => onChange({ ...config, column: v })}
          options={[{ value: "", label: "(select)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Operations" hint="Applied outer-to-inner in order">
        <div className="column-multiselect">
          {ops.map((op) => (
            <label key={op} className="step-checkbox">
              <input type="checkbox" checked={operations.includes(op)} onChange={() => toggle(op)} />
              <span>{op}</span>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}