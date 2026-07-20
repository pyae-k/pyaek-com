// Step catalog picker ("+ Add step"). When the pipeline is empty we show a
// simplified "start step" picker with only three data-source choices:
// From connection, From query (others), and Custom SQL. Once data exists, the
// picker shows every transform/aggregate/output kind grouped by category.
//
// Picking a kind adds a step of that kind to the active query (addStepByKind,
// which generates its SQL from the default config), selects it, and opens that
// step's config dialog so the user configures the transformation step by step
// through the UI. Kinds with a dedicated dialog get it; other non-custom_sql
// kinds fall back to the raw-JSON config editor (ConfigJsonDialog); custom_sql
// is left selected for SQL editing in the bottom panel.
//
// Ported from pwa_duckdb/js/app.js (openStepCatalogModal + renderStepCategories).

import { useEffect, useMemo, useState } from "react";
import { STEPS_BY_CATEGORY } from "../../steps/index";
import { qIdent } from "../../steps/helpers";
import type { StepCategory, StepKind } from "../../types/step";
import { isSourceStep } from "../../types/step";
import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";
import { useStepStore } from "../../store/stepStore";

// Two-letter category badges, echoing pwa_duckdb's step icons.
const CATEGORY_ICON: Record<StepCategory, string> = {
  get_data: "IN",
  columns: "COL",
  rows: "ROW",
  values: "VAL",
  transform: "TX",
  combine: "JOIN",
  aggregate: "AGG",
  advanced: "SQL",
  output: "OUT",
};

export function StepCatalogModal() {
  const open = useEditorStore((s) => s.stepCatalogOpen);
  const close = useEditorStore((s) => s.closeStepCatalog);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const openGetData = useEditorStore((s) => s.openGetData);
  const setActiveStep = useEditorStore((s) => s.setActiveStep);
  const openStepDialog = useEditorStore((s) => s.openStepDialog);
  const addStepByKind = useQueryStore((s) => s.addStepByKind);
  const addStep = useQueryStore((s) => s.addStep);
  const queries = useQueryStore((s) => s.queries);
  const steps = useStepStore((s) => s.steps);
  const [query, setQuery] = useState("");
  const [showQueryPicker, setShowQueryPicker] = useState(false);

  // Whether the enabled pipeline is empty — drives the source-only vs.
  // transform-only split. Falling back to "non-empty" when there's no active
  // query is harmless because the picker is only openable with an active query.
  const pipelineEmpty = activeQueryId
    ? steps.filter((s) => s.enabled).length === 0
    : false;

  // Reset the search, query picker and dismiss on Escape whenever the picker
  // closes, so the next open shows the full fresh catalog.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setShowQueryPicker(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // If the active query already has a source step, hide the Get Data category so
  // users cannot add a second source to the same pipeline.
  const hasSource = activeQueryId
    ? steps.some((s) => s.enabled && isSourceStep(s))
    : false;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STEPS_BY_CATEGORY.map((cat) => ({
      ...cat,
      steps: cat.steps.filter((def) => {
        if (hasSource && def.category === "get_data") return false;
        if (!q) return true;
        return (
          def.name.toLowerCase().includes(q) ||
          def.description.toLowerCase().includes(q) ||
          def.kind.toLowerCase().includes(q)
        );
      }),
    })).filter((cat) => cat.steps.length > 0);
  }, [query, hasSource]);

  if (!open) return null;

  const handlePick = (kind: StepKind) => {
    if (!activeQueryId) return;
    const step = addStepByKind(activeQueryId, kind);
    close();
    setQuery("");
    setShowQueryPicker(false);
    if (!step) return;
    setActiveStep(step.id);
    useStepStore.getState().refresh();
    // Open a config dialog for every kind. custom_sql now gets a dedicated
    // dialog that combines the SQL editor with an AI generate prompt.
    openStepDialog(step.id);
  };

  const handleFromConnection = () => {
    close();
    setShowQueryPicker(false);
    openGetData();
  };

  const handleFromQuery = (sourceQuery: (typeof queries)[number]) => {
    if (!activeQueryId) return;
    const step = addStep(
      activeQueryId,
      "custom_sql",
      `From: ${sourceQuery.name}`,
      `SELECT * FROM ${qIdent(sourceQuery.name)}`,
      { sourceQueryId: sourceQuery.id },
    );
    close();
    setShowQueryPicker(false);
    if (step) {
      setActiveStep(step.id);
      useStepStore.getState().refresh();
    }
  };

  const handleCustomSql = () => {
    handlePick("custom_sql");
  };

  const otherQueries = activeQueryId
    ? queries.filter((q) => q.id !== activeQueryId && q.steps.length > 0)
    : [];

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal step-catalog"
        role="dialog"
        aria-modal="true"
        aria-label="Add step"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {pipelineEmpty && showQueryPicker && (
              <button
                className="step-icon-btn"
                title="Back to start options"
                onClick={() => setShowQueryPicker(false)}
              >
                ←
              </button>
            )}
            {pipelineEmpty
              ? showQueryPicker
                ? "Choose a query to reference"
                : "Start with a data source"
              : "Add step"}
          </span>
          <button className="step-icon-btn" title="Close" onClick={close}>✕</button>
        </div>
        {!pipelineEmpty && (
          <div className="step-catalog-search">
            <input
              className="step-input"
              type="text"
              placeholder="Search steps…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        <div className="step-catalog-body">
          {pipelineEmpty ? (
            showQueryPicker ? (
              <div className="start-step-query-list">
                {otherQueries.length === 0 && (
                  <div className="start-step-empty">
                    No other queries with steps yet. Create another query first.
                  </div>
                )}
                {otherQueries.map((q) => (
                  <button
                    key={q.id}
                    className="start-step-query-item"
                    onClick={() => handleFromQuery(q)}
                  >
                    <span>📄</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {q.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="start-step-picker">
                <button className="start-step-option" onClick={handleFromConnection}>
                  <span className="start-step-option-icon">🌐</span>
                  <span className="start-step-option-text">
                    <span className="start-step-option-name">From connection</span>
                    <span className="start-step-option-desc">
                      Load data from a linked folder or a saved server connection.
                    </span>
                  </span>
                </button>
                <button
                  className="start-step-option"
                  onClick={() => setShowQueryPicker(true)}
                  disabled={otherQueries.length === 0}
                  title={otherQueries.length === 0 ? "Create another query with steps first" : "Reference another query"}
                >
                  <span className="start-step-option-icon">📄</span>
                  <span className="start-step-option-text">
                    <span className="start-step-option-name">From query (others)</span>
                    <span className="start-step-option-desc">
                      Use the result of another existing query as your starting point.
                    </span>
                  </span>
                </button>
                <button className="start-step-option" onClick={handleCustomSql}>
                  <span className="start-step-option-icon">⌨️</span>
                  <span className="start-step-option-text">
                    <span className="start-step-option-name">Custom SQL</span>
                    <span className="start-step-option-desc">
                      Write a DuckDB SQL SELECT statement from scratch.
                    </span>
                  </span>
                </button>
              </div>
            )
          ) : (
            <>
              {grouped.length === 0 && (
                <p className="step-field-hint">No steps match “{query}”.</p>
              )}
              {grouped.map((cat) => (
                <div key={cat.id} className="step-category">
                  <div className="step-category-label">{cat.label}</div>
                  <div className="step-category-items">
                    {cat.steps.map((def) => (
                      <button
                        key={def.kind}
                        type="button"
                        className="step-category-item"
                        title={def.description}
                        onClick={() => handlePick(def.kind)}
                      >
                        <span className="step-icon">{CATEGORY_ICON[def.category]}</span>
                        <span className="step-category-item-text">
                          <span className="step-category-item-name">{def.name}</span>
                          <span className="step-category-item-desc">{def.description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
