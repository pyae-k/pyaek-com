// Config dialogs for the "values" category. replace_values has a simple form;
// remove_errors and fix_errors show a data preview with error highlighting.

import { useState } from "react";
import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, cfg } from "./controls";
import { useQueryStore } from "../../store/queryStore";
import { useEditorStore } from "../../store/editorStore";
import { useConnectionStore } from "../../store/connectionStore";
import { buildUpTo } from "../../engine/cteBuilder";
import { createQueryResolver } from "../../engine/references";
import { executeSQL } from "../../engine/executor";
import { prepareSourceSteps } from "../../lib/datasetFiles";

const COLUMN_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

const TYPE_MAP: Record<string, string> = {
  text: "VARCHAR",
  number: "DOUBLE",
  integer: "BIGINT",
  date: "DATE",
  timestamp: "TIMESTAMP",
  boolean: "BOOLEAN",
};

interface ReplacePair { find: string; replace: string }

export function ReplaceValuesDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const column = cfg(config, "column", "");
  const columnType = cfg(config, "columnType", "text");
  const operator = cfg(config, "operator", cfg(config, "matchMode", "equals"));
  const pairs: ReplacePair[] = cfg(config, "pairs", cfg(config, "replacements", []));

  const setPair = (i: number, patch: Partial<ReplacePair>) => {
    const next = pairs.map((p, j) => (j === i ? { ...p, ...patch } : p));
    onChange({ ...config, pairs: next });
  };
  const addPair = () => onChange({ ...config, pairs: [...pairs, { find: "", replace: "" }] });
  const removePair = (i: number) => onChange({ ...config, pairs: pairs.filter((_, j) => j !== i) });

  return (
    <div className="step-dialog-body">
      <Field label="Column">
        <Select value={column} onChange={(v) => onChange({ ...config, column: v })}
          options={[{ value: "", label: "(select)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Match">
        <Select value={operator} onChange={(v) => onChange({ ...config, operator: v })}
          options={[
            { value: "equals", label: "equals" },
            { value: "contains", label: "contains" },
          ]} />
      </Field>
      <Field label="Value type">
        <Select value={columnType} onChange={(v) => onChange({ ...config, columnType: v })} options={COLUMN_TYPES} />
      </Field>
      <Field label="Find → Replace">
        <div className="step-rows">
          {pairs.map((p, i) => (
            <div key={i} className="step-row">
              <TextInput value={p.find} onChange={(v) => setPair(i, { find: v })} placeholder="find" />
              <TextInput value={p.replace} onChange={(v) => setPair(i, { replace: v })} placeholder="replace" />
              <button className="step-icon-btn" title="Remove" onClick={() => removePair(i)}>✕</button>
            </div>
          ))}
        </div>
      </Field>
      <button onClick={addPair}>+ Add replacement</button>
    </div>
  );
}

// --- Error preview helpers ---------------------------------------------------

interface PreviewRow {
  __rn: number;
  [key: string]: unknown;
}

function useErrorPreview(column: string) {
  const [data, setData] = useState<{ columns: string[]; rows: PreviewRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const queries = useQueryStore((s) => s.queries);

  const load = async () => {
    if (!activeQueryId || !column) return;
    setLoading(true);
    setError(null);
    try {
      const query = queries.find((q) => q.id === activeQueryId);
      if (!query) return;
      const enabledSteps = query.steps.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
      const resolveQuery = createQueryResolver(queries);
      const compiled = buildUpTo(query.steps, enabledSteps.length - 1, resolveQuery);
      const connections = useConnectionStore.getState().connections;
      await prepareSourceSteps(enabledSteps, connections);
      const result = await executeSQL(compiled.fullSQL, 200);
      if (result.data) {
        const cols = result.data.columns.map((c) => c.name);
        const rows = result.data.rows.map((r, i) => {
          const row: PreviewRow = { __rn: i + 1 };
          cols.forEach((c, j) => { row[c] = r[j]; });
          return row;
        });
        setData({ columns: cols, rows });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, load };
}

function isErrorCell(value: unknown, targetType: string): boolean {
  if (value === null || value === undefined) return true;
  const duckType = TYPE_MAP[targetType] || "DOUBLE";
  if (duckType === "VARCHAR") return false;
  if (duckType === "DOUBLE" || duckType === "BIGINT") {
    if (typeof value === "number") return false;
    const n = Number(value);
    return !Number.isFinite(n);
  }
  if (duckType === "DATE" || duckType === "TIMESTAMP") {
    if (value instanceof Date) return false;
    const d = new Date(String(value));
    return isNaN(d.getTime());
  }
  if (duckType === "BOOLEAN") {
    const s = String(value).toLowerCase();
    return !["true", "false", "1", "0", "yes", "no"].includes(s);
  }
  return false;
}

// --- RemoveErrorsDialog ------------------------------------------------------

export function RemoveErrorsDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const column = cfg(config, "column", "");
  const targetType = cfg(config, "targetType", "number");
  const fixes = cfg<Array<{ row: number; newValue: string }>>(config, "fixes", []);
  const { data, loading, error, load } = useErrorPreview(column);

  const setFix = (rowNum: number, val: string) => {
    const existing = fixes.find((f) => f.row === rowNum);
    const next = existing
      ? fixes.map((f) => (f.row === rowNum ? { ...f, newValue: val } : f))
      : [...fixes, { row: rowNum, newValue: val }];
    onChange({ ...config, fixes: next });
  };

  return (
    <div className="step-dialog-body">
      <Field label="Column">
        <Select value={column} onChange={(v) => onChange({ ...config, column: v, fixes: [] })}
          options={[{ value: "", label: "(select)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Target type">
        <Select value={targetType} onChange={(v) => onChange({ ...config, targetType: v })}
          options={[
            { value: "number", label: "Number" },
            { value: "integer", label: "Integer" },
            { value: "date", label: "Date" },
            { value: "boolean", label: "Boolean" },
          ]} />
      </Field>

      {column && (
        <button onClick={load} disabled={loading} style={{ alignSelf: "flex-start" }}>
          {loading ? "Loading preview..." : "Preview errors"}
        </button>
      )}

      {error && <div className="step-error">{error}</div>}

      {data && column && (
        <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--bg-tertiary)" }}>
                <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>#</th>
                {data.columns.map((c) => (
                  <th key={c} style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>{c}</th>
                ))}
                <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Fix</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const val = row[column];
                const isErr = isErrorCell(val, targetType);
                const fix = fixes.find((f) => f.row === row.__rn);
                return (
                  <tr key={row.__rn} style={{ background: isErr ? "rgba(239,68,68,0.08)" : "transparent" }}>
                    <td style={{ padding: "2px 8px", color: "var(--text-muted)" }}>{row.__rn}</td>
                    {data.columns.map((c) => (
                      <td key={c} style={{
                        padding: "2px 8px",
                        color: c === column && isErr ? "var(--error)" : "var(--text-primary)",
                        fontWeight: c === column && isErr ? 600 : 400,
                      }}>
                        {row[c] === null || row[c] === undefined
                          ? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>NULL</span>
                          : String(row[c])}
                      </td>
                    ))}
                    <td style={{ padding: "2px 8px" }}>
                      {isErr ? (
                        <input
                          style={{ width: "100%", fontSize: 11, padding: "2px 4px" }}
                          value={fix?.newValue ?? ""}
                          placeholder="new value"
                          onChange={(e) => setFix(row.__rn, e.target.value)}
                        />
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- FixErrorsDialog ---------------------------------------------------------

export function FixErrorsDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const column = cfg(config, "column", "");
  const targetType = cfg(config, "targetType", "number");
  const defaultValue = cfg(config, "defaultValue", "");
  const fixes = cfg<Array<{ row: number; newValue: string }>>(config, "fixes", []);
  const { data, loading, error, load } = useErrorPreview(column);

  const setFix = (rowNum: number, val: string) => {
    const existing = fixes.find((f) => f.row === rowNum);
    const next = existing
      ? fixes.map((f) => (f.row === rowNum ? { ...f, newValue: val } : f))
      : [...fixes, { row: rowNum, newValue: val }];
    onChange({ ...config, fixes: next });
  };

  return (
    <div className="step-dialog-body">
      <Field label="Column">
        <Select value={column} onChange={(v) => onChange({ ...config, column: v, fixes: [] })}
          options={[{ value: "", label: "(select)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Target type">
        <Select value={targetType} onChange={(v) => onChange({ ...config, targetType: v })}
          options={[
            { value: "number", label: "Number" },
            { value: "integer", label: "Integer" },
            { value: "date", label: "Date" },
            { value: "boolean", label: "Boolean" },
          ]} />
      </Field>
      <Field label="Default value for errors" hint="Value to use when a cell can't be cast">
        <TextInput value={defaultValue} onChange={(v) => onChange({ ...config, defaultValue: v })} placeholder="e.g. 0 or 'N/A'" />
      </Field>

      {column && (
        <button onClick={load} disabled={loading} style={{ alignSelf: "flex-start" }}>
          {loading ? "Loading preview..." : "Preview errors"}
        </button>
      )}

      {error && <div className="step-error">{error}</div>}

      {data && column && (
        <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--bg-tertiary)" }}>
                <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>#</th>
                {data.columns.map((c) => (
                  <th key={c} style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>{c}</th>
                ))}
                <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Override</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const val = row[column];
                const isErr = isErrorCell(val, targetType);
                const fix = fixes.find((f) => f.row === row.__rn);
                return (
                  <tr key={row.__rn} style={{ background: isErr ? "rgba(239,68,68,0.08)" : "transparent" }}>
                    <td style={{ padding: "2px 8px", color: "var(--text-muted)" }}>{row.__rn}</td>
                    {data.columns.map((c) => (
                      <td key={c} style={{
                        padding: "2px 8px",
                        color: c === column && isErr ? "var(--error)" : "var(--text-primary)",
                        fontWeight: c === column && isErr ? 600 : 400,
                      }}>
                        {row[c] === null || row[c] === undefined
                          ? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>NULL</span>
                          : String(row[c])}
                      </td>
                    ))}
                    <td style={{ padding: "2px 8px" }}>
                      {isErr ? (
                        <input
                          style={{ width: "100%", fontSize: 11, padding: "2px 4px" }}
                          value={fix?.newValue ?? ""}
                          placeholder="override"
                          onChange={(e) => setFix(row.__rn, e.target.value)}
                        />
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
