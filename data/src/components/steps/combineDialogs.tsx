// Config dialogs for the "combine" category. Append/join sources are normally
// picked from the Get Data modal; these dialogs allow manual entry/overrides.

import { useState, useEffect } from "react";
import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, cfg } from "./controls";
import { useQueryStore } from "../../store/queryStore";
import { getTableColumns } from "../../lib/duckdb";
import { generateJoinPreviewStatsSql, joinKeepLabel } from "../../steps/helpers";

const JOIN_KINDS = [
  "INNER", "LEFT", "RIGHT", "FULL", "LEFT_ANTI", "RIGHT_ANTI",
].map((k) => ({ value: k, label: k }));

export function AppendTablesDialog({ config, onChange }: StepDialogProps) {
  const queries = useQueryStore((s) => s.queries);
  const sources: Array<{ type: string; schema: string; table: string; label: string; querySql?: string }> =
    cfg(config, "sources", []);

  const addQuery = (queryId: string) => {
    const q = queries.find((qq) => qq.id === queryId);
    if (!q) return;
    onChange({
      ...config,
      sources: [...sources, { type: "query", schema: "", table: q.name, label: q.name, querySql: `SELECT * FROM ${q.name}` }],
    });
  };

  const addTable = () => onChange({
    ...config,
    sources: [...sources, { type: "table", schema: "main", table: "", label: "" }],
  });

  const setSrc = (i: number, patch: Partial<{ schema: string; table: string; label: string }>) => {
    const next = sources.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onChange({ ...config, sources: next });
  };

  const removeSrc = (i: number) => onChange({ ...config, sources: sources.filter((_, j) => j !== i) });

  const otherQueries = queries.filter((q) => q.steps.length > 0);

  return (
    <div className="step-dialog-body">
      <p className="step-field-hint">Appends the previous step with the sources below (UNION ALL BY NAME).</p>

      {otherQueries.length > 0 && (
        <Field label="Add from query">
          <Select
            value=""
            onChange={(v) => { if (v) addQuery(v); }}
            options={[
              { value: "", label: "(select a query)" },
              ...otherQueries.map((q) => ({ value: q.id, label: q.name })),
            ]}
          />
        </Field>
      )}

      <div className="step-rows">
        {sources.map((s, i) => (
          <div key={i} className="step-row" style={{ alignItems: "center" }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              color: "var(--text-muted)",
              minWidth: 40,
            }}>
              {s.type || "table"}
            </span>
            {s.type === "query" ? (
              <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>{s.label}</span>
            ) : (
              <>
                <TextInput value={s.schema} onChange={(v) => setSrc(i, { schema: v })} placeholder="schema" />
                <TextInput value={s.table} onChange={(v) => setSrc(i, { table: v })} placeholder="table" />
              </>
            )}
            <button className="step-icon-btn" title="Remove" onClick={() => removeSrc(i)}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={addTable}>+ Add table</button>
    </div>
  );
}

export function JoinTablesDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const queries = useQueryStore((s) => s.queries);
  const joinType = cfg(config, "joinType", cfg(config, "joinKind", "LEFT"));
  const table = cfg(config, "table", cfg(config, "rightTable", ""));
  const schema = cfg(config, "schema", "main");
  const keys: Array<{ left: string; right: string }> = cfg(config, "keys", []);
  const [rightColumns, setRightColumns] = useState<string[]>([]);
  const [previewStats, setPreviewStats] = useState<{
    left_total?: number;
    right_total?: number;
    left_matched?: number;
    right_matched?: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // When the right table changes, fetch its columns
  useEffect(() => {
    const fetchColumns = async () => {
      if (!table) {
        setRightColumns([]);
        return;
      }
      // Check if it's a query name
      const q = queries.find((qq) => qq.name === table);
      if (q) {
        // For queries, use the last step's output columns if available
        const lastStep = q.steps[q.steps.length - 1];
        if (lastStep?.config?.columns) {
          const cols = (lastStep.config.columns as Array<{ column: string }>)
            .map((c) => c.column)
            .filter(Boolean);
          if (cols.length > 0) {
            setRightColumns(cols);
            return;
          }
        }
        // Fallback: use the query name as a hint
        setRightColumns([]);
        return;
      }
      // Try to introspect from DuckDB
      try {
        const cols = await getTableColumns(schema || "main", table);
        setRightColumns(cols.map((c) => c.name));
      } catch {
        setRightColumns([]);
      }
    };
    fetchColumns();
  }, [table, schema, queries]);

  const setKey = (i: number, patch: Partial<{ left: string; right: string }>) => {
    const next = keys.map((k, j) => (j === i ? { ...k, ...patch } : k));
    onChange({ ...config, keys: next });
  };
  const addKey = () => onChange({ ...config, keys: [...keys, { left: "", right: "" }] });
  const removeKey = (i: number) => onChange({ ...config, keys: keys.filter((_, j) => j !== i) });

  const otherQueries = queries.filter((q) => q.steps.length > 0);
  const tableOptions = [
    { value: "", label: "(select table or query)" },
    ...otherQueries.map((q) => ({ value: q.name, label: `📄 ${q.name} (query)` })),
  ];

  const handleTableSelect = (v: string) => {
    const q = otherQueries.find((qq) => qq.name === v);
    if (q) {
      onChange({ ...config, table: v, schema: "main", joinType });
    } else {
      onChange({ ...config, table: v, schema, joinType });
    }
    setPreviewStats(null);
  };

  const handlePreview = async () => {
    if (!table || keys.length === 0) return;
    setPreviewLoading(true);
    setPreviewStats(null);
    try {
      const sql = generateJoinPreviewStatsSql(
        { joinType, schema, table, keys },
        "prev",
      );
      if (!sql) return;
      // Execute via DuckDB
      const { executeSQL } = await import("../../engine/executor");
      const result = await executeSQL(sql, 1);
      if (result.data && result.data.rows.length > 0) {
        const row = result.data.rows[0] as number[];
        setPreviewStats({
          left_total: Number(row[0]),
          right_total: Number(row[1]),
          left_matched: Number(row[2]),
          right_matched: Number(row[3]),
        });
      }
    } catch {
      // Silently fail
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="step-dialog-body">
      <Field label="Join type">
        <Select value={joinType} onChange={(v) => onChange({ ...config, joinType: v })} options={JOIN_KINDS} />
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {joinKeepLabel(joinType)}
        </div>
      </Field>

      <Field label="Right table / query">
        <div className="step-row">
          <input
            className="step-input"
            value={schema}
            onChange={(e) => onChange({ ...config, schema: e.target.value })}
            placeholder="schema"
            style={{ width: 80 }}
          />
          <Select value={table} onChange={handleTableSelect} options={tableOptions} />
        </div>
      </Field>

      <Field label="Join keys">
        <div className="step-rows">
          {keys.map((k, i) => (
            <div key={i} className="step-row">
              <Select value={k.left} onChange={(v) => setKey(i, { left: v })}
                options={[
                  { value: "", label: "(left col)" },
                  ...(prevColumns ?? []).map((c) => ({ value: c, label: c })),
                ]}
              />
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>=</span>
              <Select value={k.right} onChange={(v) => setKey(i, { right: v })}
                options={[
                  { value: "", label: "(right col)" },
                  ...rightColumns.map((c) => ({ value: c, label: c })),
                ]}
              />
              <button className="step-icon-btn" title="Remove" onClick={() => removeKey(i)}>✕</button>
            </div>
          ))}
        </div>
      </Field>
      <button onClick={addKey}>+ Add key</button>

      {table && keys.some((k) => k.left && k.right) && (
        <div style={{ marginTop: 12 }}>
          <button onClick={handlePreview} disabled={previewLoading} style={{ fontSize: 11 }}>
            {previewLoading ? "Loading..." : "Preview match counts"}
          </button>
          {previewStats && (
            <div style={{
              marginTop: 8,
              padding: "8px 10px",
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 16px",
            }}>
              <span style={{ color: "var(--text-muted)" }}>Left total:</span>
              <span>{previewStats.left_total ?? "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Right total:</span>
              <span>{previewStats.right_total ?? "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Left matched:</span>
              <span>{previewStats.left_matched ?? "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Right matched:</span>
              <span>{previewStats.right_matched ?? "—"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}