// Config dialogs for the "rows" category.

import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, ColumnMultiSelect, cfg } from "./controls";

const FILTER_OPERATORS = [
  "equals", "not_equals", "greater", "greater_or_equal",
  "less", "less_or_equal", "is_null", "is_not_null",
  "contains", "starts_with", "ends_with", "in",
].map((o) => ({ value: o, label: o.replace(/_/g, " ") }));

const COLUMN_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

interface FilterRule {
  column: string;
  operator: string;
  value: string;
  columnType: string;
}

interface FilterGroup {
  logic: string;
  rules: FilterRule[];
}

const GROUP_BOX_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px 10px 8px",
  background: "rgba(0,0,0,0.08)",
};

export function FilterRowsDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const mode = cfg<string>(config, "mode", "rules");
  const groups: FilterGroup[] = cfg(config, "groups", []);
  const topLogic = cfg(config, "logic", "AND");
  const condition = cfg(config, "condition", "");

  const setGroup = (gi: number, patch: Partial<FilterGroup>) => {
    const next = groups.map((g, j) => (j === gi ? { ...g, ...patch } : g));
    onChange({ ...config, groups: next });
  };

  const setGroupRule = (gi: number, ri: number, patch: Partial<FilterRule>) => {
    const next = groups.map((g, j) => {
      if (j !== gi) return g;
      const rules = g.rules.map((r, k) => (k === ri ? { ...r, ...patch } : r));
      return { ...g, rules };
    });
    onChange({ ...config, groups: next });
  };

  const addGroup = () => onChange({
    ...config,
    groups: [...groups, { logic: "AND", rules: [{ column: "", operator: "equals", value: "", columnType: "text" }] }],
  });

  const removeGroup = (gi: number) => onChange({
    ...config,
    groups: groups.filter((_, j) => j !== gi),
  });

  const addRuleToGroup = (gi: number) => {
    const next = groups.map((g, j) => {
      if (j !== gi) return g;
      return { ...g, rules: [...g.rules, { column: "", operator: "equals", value: "", columnType: "text" }] };
    });
    onChange({ ...config, groups: next });
  };

  const removeRuleFromGroup = (gi: number, ri: number) => {
    const next = groups.map((g, j) => {
      if (j !== gi) return g;
      return { ...g, rules: g.rules.filter((_, k) => k !== ri) };
    });
    onChange({ ...config, groups: next });
  };

  if (mode === "sql") {
    return (
      <div className="step-dialog-body">
        <Field label="Mode">
          <Select value={mode} onChange={(v) => onChange({ ...config, mode: v })}
            options={[{ value: "rules", label: "Rule builder" }, { value: "sql", label: "Custom SQL" }]} />
        </Field>
        <Field label="WHERE clause (raw SQL)" hint="e.g. amount > 100 AND region = 'US'">
          <TextInput value={condition} onChange={(v) => onChange({ ...config, condition: v })} />
        </Field>
      </div>
    );
  }

  return (
    <div className="step-dialog-body">
      <Field label="Mode">
        <Select value={mode} onChange={(v) => onChange({ ...config, mode: v })}
          options={[{ value: "rules", label: "Rule builder" }, { value: "sql", label: "Custom SQL" }]} />
      </Field>

      {/* Top-level logic toggle */}
      {groups.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Match</span>
          <Select
            value={topLogic}
            onChange={(v) => onChange({ ...config, logic: v })}
            options={[
              { value: "AND", label: "all groups" },
              { value: "OR", label: "any group" },
            ]}
          />
        </div>
      )}

      {/* Groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((group, gi) => (
          <div key={gi} style={GROUP_BOX_STYLE}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Group {gi + 1}</span>
              <select
                className="step-input"
                value={group.logic}
                onChange={(e) => setGroup(gi, { logic: e.target.value })}
                style={{ width: 80 }}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
              <div style={{ flex: 1 }} />
              {groups.length > 1 && (
                <button className="step-icon-btn" title="Remove group" onClick={() => removeGroup(gi)}>✕</button>
              )}
            </div>

            <div className="step-rows">
              {group.rules.map((r, ri) => (
                <div key={ri} className="step-row">
                  <Select value={r.column} onChange={(v) => setGroupRule(gi, ri, { column: v })}
                    options={[{ value: "", label: "(col)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
                  <Select value={r.operator} onChange={(v) => setGroupRule(gi, ri, { operator: v })} options={FILTER_OPERATORS} />
                  {!["is_null", "is_not_null"].includes(r.operator) && (
                    <TextInput value={r.value} onChange={(v) => setGroupRule(gi, ri, { value: v })} placeholder="value" />
                  )}
                  <Select value={r.columnType} onChange={(v) => setGroupRule(gi, ri, { columnType: v })} options={COLUMN_TYPES} />
                  <button className="step-icon-btn" title="Remove rule" onClick={() => removeRuleFromGroup(gi, ri)}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => addRuleToGroup(gi)} style={{ marginTop: 6, fontSize: 12 }}>+ Add rule</button>
          </div>
        ))}
      </div>

      <button onClick={addGroup}>+ Add group</button>
    </div>
  );
}

export function SortRowsDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const sorts: Array<{ column: string; direction: "ASC" | "DESC" }> = cfg(config, "sorts", cfg(config, "orderBy", []));
  const setSort = (i: number, patch: Partial<{ column: string; direction: "ASC" | "DESC" }>) => {
    const next = sorts.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onChange({ ...config, sorts: next });
  };
  const addSort = () => onChange({ ...config, sorts: [...sorts, { column: "", direction: "ASC" }] });
  const removeSort = (i: number) => onChange({ ...config, sorts: sorts.filter((_, j) => j !== i) });

  return (
    <div className="step-dialog-body">
      <div className="step-rows">
        {sorts.map((s, i) => (
          <div key={i} className="step-row">
            <Select value={s.column} onChange={(v) => setSort(i, { column: v })}
              options={[{ value: "", label: "(col)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
            <Select value={s.direction} onChange={(v) => setSort(i, { direction: v as "ASC" | "DESC" })}
              options={[{ value: "ASC", label: "Ascending" }, { value: "DESC", label: "Descending" }]} />
            <button className="step-icon-btn" title="Remove" onClick={() => removeSort(i)}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={addSort}>+ Add sort</button>
    </div>
  );
}

export function RemoveDuplicatesDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const columns = cfg<string[]>(config, "columns", []);
  return (
    <div className="step-dialog-body">
      <Field label="Deduplicate by columns" hint="Leave empty to deduplicate whole rows">
        <ColumnMultiSelect
          columns={prevColumns ?? []}
          selected={columns}
          onChange={(next) => onChange({ ...config, columns: next })}
        />
      </Field>
    </div>
  );
}

export function FillNullDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const column = cfg(config, "column", "");
  const value = cfg(config, "value", "");
  const columnType = cfg(config, "columnType", "text");
  return (
    <div className="step-dialog-body">
      <Field label="Column">
        <Select value={column} onChange={(v) => onChange({ ...config, column: v })}
          options={[{ value: "", label: "(select)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
      </Field>
      <Field label="Fill value">
        <TextInput value={value} onChange={(v) => onChange({ ...config, value: v })} />
      </Field>
      <Field label="Value type">
        <Select value={columnType} onChange={(v) => onChange({ ...config, columnType: v })} options={COLUMN_TYPES} />
      </Field>
    </div>
  );
}