// History panel: shows action history (queryStore.history) and run history
// (previewStore.runHistory — row count / duration / timestamp per execution).

import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";
import { usePreviewStore } from "../../store/previewStore";

export function HistoryPanel() {
  const open = useEditorStore((s) => s.historyOpen);
  const close = useEditorStore((s) => s.closeHistory);
  const history = useQueryStore((s) => s.history);
  const runHistory = usePreviewStore((s) => s.runHistory);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ width: "min(640px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>History</span>
          <button className="step-icon-btn" title="Close" onClick={close}>✕</button>
        </div>
        <div className="step-dialog-body">
          <h4 style={{ margin: 0 }}>Run history</h4>
          {runHistory.length === 0 ? (
            <p className="step-field-hint">No runs yet.</p>
          ) : (
            <div className="step-rows" style={{ maxHeight: 220, overflowY: "auto" }}>
              {runHistory.map((r, i) => (
                <div key={i} className="step-row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                  <span>{new Date(r.timestamp).toLocaleTimeString()}</span>
                  <span>{r.rowCount} rows</span>
                  <span>{r.durationMs}ms</span>
                </div>
              ))}
            </div>
          )}
          <h4 style={{ margin: "12px 0 0" }}>Action history</h4>
          {history.length === 0 ? (
            <p className="step-field-hint">No actions recorded.</p>
          ) : (
            <div className="step-rows" style={{ maxHeight: 220, overflowY: "auto" }}>
              {[...history].reverse().map((h, i) => (
                <div key={i} className="step-row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                  <span>{h.action}</span>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(h.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}