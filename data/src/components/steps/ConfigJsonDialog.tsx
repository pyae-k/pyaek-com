// Generic fallback config editor: edits the step's config as JSON. Every step
// kind without a dedicated rich dialog renders this, so the whole catalog is
// editable even before all per-step dialogs are ported. The store regenerates
// the step's SQL from the updated config via the registry's buildSql.

import { useState } from "react";
import type { StepDialogProps } from "../../steps/types";

export function ConfigJsonDialog({ config, onChange, onClose }: StepDialogProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    try {
      const parsed = JSON.parse(draft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Config must be a JSON object");
      }
      onChange(parsed as Record<string, unknown>);
      setError(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="step-dialog-body">
      <p className="step-field-hint">
        Edit this step's raw config (JSON). The SQL is regenerated from the config when you apply.
      </p>
      <textarea
        className="step-input"
        value={draft}
        rows={16}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
      {error && <div className="step-error">{error}</div>}
      <div className="step-dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}