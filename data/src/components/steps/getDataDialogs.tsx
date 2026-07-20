// Config dialogs for the "get_data" category. File/table picking is handled by
// the Get Data modal (Phase 3); these dialogs let you tweak the registered
// source's virtual name or override the generated query SQL.

import type { StepDialogProps } from "../../steps/types";
import { Field, TextInput, TextArea, cfg } from "./controls";

export function SourceFileDialog({ config, onChange }: StepDialogProps) {
  const sourceVirtual = cfg(config, "sourceVirtual", "");
  const ext = cfg(config, "ext", "csv");
  const querySql = cfg(config, "querySql", "");
  return (
    <div className="step-dialog-body">
      <Field label="Registered virtual name" hint="The file buffer registered with DuckDB">
        <TextInput value={sourceVirtual} onChange={(v) => onChange({ ...config, sourceVirtual: v })} />
      </Field>
      <Field label="File extension">
        <TextInput value={ext} onChange={(v) => onChange({ ...config, ext: v })} />
      </Field>
      <Field label="Override query SQL" hint="Leave empty to auto-build from the file reader">
        <TextArea value={querySql} onChange={(v) => onChange({ ...config, querySql: v })} rows={4} />
      </Field>
    </div>
  );
}

export function SourceTableDialog({ config, onChange }: StepDialogProps) {
  const schema = cfg(config, "schema", "main");
  const table = cfg(config, "table", "");
  return (
    <div className="step-dialog-body">
      <Field label="Schema">
        <TextInput value={schema} onChange={(v) => onChange({ ...config, schema: v })} />
      </Field>
      <Field label="Table name">
        <TextInput value={table} onChange={(v) => onChange({ ...config, table: v })} />
      </Field>
    </div>
  );
}