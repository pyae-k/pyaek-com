// Column profile panel: renders previewStore.profiles (null/distinct/min/max/
// mean/median) computed by useAutoPreview from the preview result set.

import { usePreviewStore } from "../../store/previewStore";
import { useEditorStore } from "../../store/editorStore";

export function ProfilePanel() {
  const open = useEditorStore((s) => s.profileOpen);
  const close = useEditorStore((s) => s.closeProfile);
  const profiles = usePreviewStore((s) => s.profiles);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: "min(760px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Column profiles</span>
          <button className="step-icon-btn" title="Close" onClick={close}>✕</button>
        </div>
        <div className="step-dialog-body">
          {profiles.length === 0 ? (
            <p className="step-field-hint">No preview data yet. Run a step to compute profiles.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "6px 8px" }}>Column</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Nulls</th>
                  <th style={{ padding: "6px 8px" }}>Distinct</th>
                  <th style={{ padding: "6px 8px" }}>Min</th>
                  <th style={{ padding: "6px 8px" }}>Max</th>
                  <th style={{ padding: "6px 8px" }}>Mean</th>
                  <th style={{ padding: "6px 8px" }}>Median</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 8px", fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{p.type}</td>
                    <td style={{ padding: "4px 8px" }}>{p.nullCount}</td>
                    <td style={{ padding: "4px 8px" }}>{p.distinctCount}</td>
                    <td style={{ padding: "4px 8px" }}>{fmt(p.min)}</td>
                    <td style={{ padding: "4px 8px" }}>{fmt(p.max)}</td>
                    <td style={{ padding: "4px 8px" }}>{p.mean != null ? round(p.mean) : ""}</td>
                    <td style={{ padding: "4px 8px" }}>{p.median != null ? round(p.median) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="step-field-hint">Profiles are computed over the fetched preview rows (a sample).</p>
        </div>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}
function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}