// Config dialog for the "aggregate" category.

import type { StepDialogProps } from "../../steps/types";
import { Field, Select, TextInput, ColumnMultiSelect, cfg } from "./controls";

const AGG_FNS = [
  "SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_ROWS", "COUNT_DISTINCT",
  "MEDIAN", "STDDEV", "VARIANCE", "STRING_AGG",
].map((f) => ({ value: f, label: f }));

interface Agg {
  fn: string;
  column: string;
  alias: string;
}

export function GroupAggregateDialog({ config, onChange, prevColumns }: StepDialogProps) {
  const groupColumns = cfg<string[]>(config, "groupColumns", cfg(config, "groupBy", []));
  const aggregations: Agg[] = cfg(config, "aggregations", []);

  const setAgg = (i: number, patch: Partial<Agg>) => {
    const next = aggregations.map((a, j) => (j === i ? { ...a, ...patch } : a));
    onChange({ ...config, aggregations: next });
  };
  const addAgg = () => onChange({
    ...config,
    aggregations: [...aggregations, { fn: "SUM", column: "", alias: "" }],
  });
  const removeAgg = (i: number) => onChange({ ...config, aggregations: aggregations.filter((_, j) => j !== i) });

  return (
    <div className="step-dialog-body">
      <Field label="Group by columns">
        <ColumnMultiSelect
          columns={prevColumns ?? []}
          selected={groupColumns}
          onChange={(next) => onChange({ ...config, groupColumns: next })}
        />
      </Field>
      <Field label="Aggregations">
        <div className="step-rows">
          {aggregations.map((a, i) => (
            <div key={i} className="step-row">
              <Select value={a.fn} onChange={(v) => setAgg(i, { fn: v })} options={AGG_FNS} />
              {!["COUNT_ROWS"].includes(a.fn) && (
                <Select value={a.column} onChange={(v) => setAgg(i, { column: v })}
                  options={[{ value: "", label: "(col)" }, ...(prevColumns ?? []).map((c) => ({ value: c, label: c }))]} />
              )}
              <TextInput value={a.alias} onChange={(v) => setAgg(i, { alias: v })} placeholder="alias" />
              <button className="step-icon-btn" title="Remove" onClick={() => removeAgg(i)}>✕</button>
            </div>
          ))}
        </div>
      </Field>
      <button onClick={addAgg}>+ Add aggregation</button>
    </div>
  );
}