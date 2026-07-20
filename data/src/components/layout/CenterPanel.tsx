import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePreviewStore } from "../../store/previewStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";

const ROW_HEIGHT = 28;

export function CenterPanel() {
  const data = usePreviewStore((s) => s.data);
  const loading = usePreviewStore((s) => s.loading);
  const error = usePreviewStore((s) => s.error);
  const durationMs = usePreviewStore((s) => s.durationMs);
  const autoRun = useSettingsStore((s) => s.autoRun);
  const setAutoRun = useSettingsStore((s) => s.setAutoRun);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const activeStepId = useEditorStore((s) => s.activeStepId);
  const queries = useQueryStore((s) => s.queries);
  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const activeStep = activeQuery?.steps.find((s) => s.id === activeStepId);
  const runAllStatus = usePreviewStore((s) => s.runAllStatus);
  const runAllActive = usePreviewStore((s) => s.runAllActive);
  const clearRunAllStatus = usePreviewStore((s) => s.clearRunAllStatus);
  const setActiveQuery = useEditorStore((s) => s.setActiveQuery);

  // Show run-all results when active
  if (runAllActive && runAllStatus.length > 0) {
    const completed = runAllStatus.filter((r) => r.status === "completed").length;
    const failed = runAllStatus.filter((r) => r.status === "failed").length;
    const total = runAllStatus.length;
    const allDone = completed + failed === total;

    return (
      <div className="center-panel">
        <div className="toolbar">
          <span>Run All Results</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {completed}/{total} completed{failed > 0 ? `, ${failed} failed` : ""}
          </span>
          {allDone && (
            <button onClick={clearRunAllStatus} style={{ fontSize: 11 }}>Clear</button>
          )}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {runAllStatus.map((r) => (
            <div
              key={r.queryId}
              onClick={() => { if (r.status === "completed") { setActiveQuery(r.queryId); clearRunAllStatus(); } }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                cursor: r.status === "completed" ? "pointer" : "default",
                opacity: r.status === "pending" ? 0.6 : 1,
              }}
            >
              {/* Status icon */}
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {r.status === "running" && "⏳"}
                {r.status === "completed" && "✅"}
                {r.status === "failed" && "❌"}
                {r.status === "pending" && "⏸"}
              </span>
              {/* Query name */}
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{r.queryName}</span>
              {/* Details */}
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {r.status === "completed" && `${r.rowCount} rows · ${r.durationMs}ms`}
                {r.status === "failed" && "Error"}
                {r.status === "running" && "Running..."}
              </span>
              {/* Error detail */}
              {r.status === "failed" && r.error && (
                <span style={{ fontSize: 11, color: "var(--error)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.error}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="center-panel">
      <div className="toolbar">
        <span>{activeQuery ? activeQuery.name : "No query selected"}</span>
        {activeStep && (
          <span style={{ color: "var(--text-muted)" }}>
            {" / "}{activeStep.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {loading && <span style={{ color: "var(--accent)" }}>Executing...</span>}
        {!loading && data && (
          <span>{data.rowCount} rows{durationMs > 0 ? ` · ${durationMs}ms` : ""}</span>
        )}
        <label className="step-checkbox" title="Auto-run on change">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
          <span>Auto</span>
        </label>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && <div className="placeholder"><Spinner /> Executing query...</div>}
        {error && (
          <div style={{ padding: 16, overflow: "auto" }}>
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid var(--error)",
              borderRadius: "var(--radius)",
              padding: 12,
              color: "var(--error)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>SQL Error</div>
              {error}
            </div>
          </div>
        )}
        {!loading && !error && !data && (
          <div className="placeholder">
            {activeQuery
              ? (activeStep ? "No preview available. Check your SQL." : "Click a step to preview its result.")
              : "Select or create a query to begin."}
          </div>
        )}
        {!loading && !error && data && data.rows.length > 0 && <VirtualGrid columns={data.columns} rows={data.rows} />}
        {!loading && !error && data && data.rows.length === 0 && (
          <div className="placeholder">Query returned 0 rows</div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid var(--border)",
        borderTopColor: "var(--accent)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        marginRight: 8,
      }}
    />
  );
}

function VirtualGrid({
  columns,
  rows,
}: {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  return (
    <div ref={parentRef} style={{ height: "100%", overflow: "auto" }}>
      <table
        style={{
          minWidth: "100%",
          width: "max-content",
          borderCollapse: "collapse",
          fontSize: 13,
          tableLayout: "auto",
        }}
      >
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--bg-tertiary)", zIndex: 1 }}>
            {columns.map((c) => (
              <th
                key={c.name}
                style={{
                  textAlign: "left",
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border)",
                  whiteSpace: "nowrap",
                  minWidth: 80,
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>{c.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ position: "relative", height: rowVirtualizer.getTotalSize(), display: "block" }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            return (
              <tr
                key={vi.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: vi.size,
                  borderBottom: "1px solid var(--border)",
                  display: "table-row",
                }}
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      padding: "4px 10px",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 80,
                    }}
                  >
                    {cell === null || cell === undefined
                      ? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>NULL</span>
                      : String(cell)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length >= rowVirtualizer.getVirtualItems().length && (
        <div className="step-field-hint" style={{ padding: "6px 10px" }}>
          Showing first {rows.length} rows.
        </div>
      )}
    </div>
  );
}