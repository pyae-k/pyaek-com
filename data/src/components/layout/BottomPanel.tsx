import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";
import { buildFull } from "../../engine/cteBuilder";
import { createQueryResolver } from "../../engine/references";

export function BottomPanel() {
  const activeStepId = useEditorStore((s) => s.activeStepId);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const bottomTab = useEditorStore((s) => s.bottomTab);
  const setBottomTab = useEditorStore((s) => s.setBottomTab);
  const queries = useQueryStore((s) => s.queries);
  const setStepSQL = useQueryStore((s) => s.setStepSQL);

  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const activeStep = activeQuery?.steps.find((s) => s.id === activeStepId);
  const sql = activeStep?.sql ?? "";

  const resolveQuery = createQueryResolver(queries);
  const fullScript = activeQuery
    ? buildFull(activeQuery.steps, resolveQuery).fullSQL
    : "-- No query selected";

  return (
    <>
      <div className="panel-header">
        <span>SQL Script</span>
        {activeStep && (
          <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-muted)" }}>
            {activeStep.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div className="bottom-tabs">
          <button className={`bottom-tab-btn ${bottomTab === "step" ? "active" : ""}`} onClick={() => setBottomTab("step")} disabled={!activeStep}>Step</button>
          <button className={`bottom-tab-btn ${bottomTab === "advanced" ? "active" : ""}`} onClick={() => setBottomTab("advanced")} disabled={!activeQuery}>Advanced</button>
        </div>
      </div>
      <div className="bottom-panel-content">
        {bottomTab === "step" ? (
          activeStep && activeQueryId ? (
            <div className="codemirror-wrap">
              <CodeMirror
                value={sql}
                height="100%"
                theme="dark"
                extensions={[sqlLang()]}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
                onChange={(val) => setStepSQL(activeQueryId, activeStep.id, val)}
              />
            </div>
          ) : (
            <div className="placeholder">Select a step to edit its SQL script.</div>
          )
        ) : (
          <>
            <pre className="sql-readonly">{fullScript}</pre>
            {queries.length > 1 && (
              <div className="step-field-hint" style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
                Reference another query by name: <code>SELECT * FROM other_query_name</code>.
                Within the same query, use <code>prev</code> for the previous step.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
