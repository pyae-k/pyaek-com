// Modal host that renders the config dialog for the step currently being edited
// (editorStore.editingStepId). Maps step kind -> dialog component, falling back
// to the generic JSON config editor for kinds without a dedicated dialog.
//
// Loads the previous step's column names so dialogs can populate column pickers,
// filters, formulas, joins, etc. Runs the pipeline up to the previous step with a
// LIMIT 1 query to obtain the schema.

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { StepKind } from "../../types/step";
import type { StepDialogProps } from "../../steps/types";
import { useEditorStore } from "../../store/editorStore";
import { useQueryStore } from "../../store/queryStore";
import { useConnectionStore } from "../../store/connectionStore";
import { buildUpTo } from "../../engine/cteBuilder";
import { createQueryResolver } from "../../engine/references";
import { executeSQL } from "../../engine/executor";
import { prepareSourceSteps } from "../../lib/datasetFiles";

import { ConfigJsonDialog } from "./ConfigJsonDialog";
import { PromoteHeadersDialog, PickColumnsDialog, ChangeTypeDialog, DuplicateColumnDialog } from "./columnsDialogs";
import { FilterRowsDialog, SortRowsDialog, RemoveDuplicatesDialog, FillNullDialog } from "./rowsDialogs";
import { GroupAggregateDialog } from "./aggregateDialogs";
import { AddIndexDialog, FormulaColumnDialog, PivotDialog, UnpivotDialog, CleanTextDialog } from "./transformDialogs";
import { ReplaceValuesDialog, RemoveErrorsDialog, FixErrorsDialog } from "./valuesDialogs";
import { AppendTablesDialog, JoinTablesDialog } from "./combineDialogs";
import { SourceFileDialog, SourceTableDialog } from "./getDataDialogs";
import { ExportFileDialog } from "./outputDialogs";
import { CustomSqlDialog } from "./CustomSqlDialog";

const DIALOGS: Partial<Record<StepKind, ComponentType<StepDialogProps>>> = {
  promote_headers: PromoteHeadersDialog,
  pick_columns: PickColumnsDialog,
  change_type: ChangeTypeDialog,
  duplicate_column: DuplicateColumnDialog,
  filter_rows: FilterRowsDialog,
  sort_rows: SortRowsDialog,
  remove_duplicates: RemoveDuplicatesDialog,
  fill_null: FillNullDialog,
  group_aggregate: GroupAggregateDialog,
  add_index: AddIndexDialog,
  formula_column: FormulaColumnDialog,
  pivot: PivotDialog,
  unpivot: UnpivotDialog,
  clean_text: CleanTextDialog,
  replace_values: ReplaceValuesDialog,
  remove_errors: RemoveErrorsDialog,
  fix_errors: FixErrorsDialog,
  append_tables: AppendTablesDialog,
  join_tables: JoinTablesDialog,
  source_file: SourceFileDialog,
  source_table: SourceTableDialog,
  export_file: ExportFileDialog,
  custom_sql: CustomSqlDialog,
};

/** Step kinds that have a dedicated config dialog (auto-opened after adding). */
export const STEP_DIALOG_KINDS: ReadonlySet<StepKind> = new Set(Object.keys(DIALOGS) as StepKind[]);

/** True when this step kind has a dedicated UI config dialog (not the raw JSON fallback). */
export function hasStepDialog(kind: StepKind): boolean {
  return STEP_DIALOG_KINDS.has(kind);
}

export function StepDialogHost() {
  const editingStepId = useEditorStore((s) => s.editingStepId);
  const closeStepDialog = useEditorStore((s) => s.closeStepDialog);
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const updateStepConfig = useQueryStore((s) => s.updateStepConfig);

  const [prevColumns, setPrevColumns] = useState<string[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);

  // Load the previous enabled step's column names whenever a different step dialog opens.
  useEffect(() => {
    if (!editingStepId || !activeQueryId) {
      setPrevColumns([]);
      setLoadingColumns(false);
      return;
    }

    const query = useQueryStore.getState().queries.find((q) => q.id === activeQueryId);
    const step = query?.steps.find((s) => s.id === editingStepId);
    if (!query || !step) {
      setPrevColumns([]);
      setLoadingColumns(false);
      return;
    }

    const enabledSteps = query.steps
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order);
    const index = enabledSteps.findIndex((s) => s.id === step.id);
    if (index <= 0) {
      setPrevColumns([]);
      setLoadingColumns(false);
      return;
    }

    let cancelled = false;
    setLoadingColumns(true);
    setPrevColumns([]);

    (async () => {
      try {
        const prevIndex = index - 1;
        const queries = useQueryStore.getState().queries;
        const resolveQuery = createQueryResolver(queries);
        const compiled = buildUpTo(query.steps, prevIndex, resolveQuery);
        const stepsToPreflight = enabledSteps.slice(0, prevIndex + 1);
        const connections = useConnectionStore.getState().connections;
        await prepareSourceSteps(stepsToPreflight, connections);
        const result = await executeSQL(compiled.fullSQL, 1);
        if (cancelled) return;
        setPrevColumns(result.data?.columns.map((c) => c.name) ?? []);
      } catch (e) {
        console.error("Failed to load previous step columns:", e);
        if (!cancelled) setPrevColumns([]);
      } finally {
        if (!cancelled) setLoadingColumns(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editingStepId, activeQueryId]);

  if (!editingStepId || !activeQueryId) return null;

  const query = useQueryStore.getState().queries.find((q) => q.id === activeQueryId);
  const step = query?.steps.find((s) => s.id === editingStepId);
  if (!step) return null;

  const Dialog = DIALOGS[step.stepKind] ?? ConfigJsonDialog;

  return (
    <div className="modal-overlay" onClick={closeStepDialog}>
      <div
        className="modal step-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span id="step-dialog-title">{step.name}</span>
          {loadingColumns && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto", marginRight: 8 }}>
              Loading columns…
            </span>
          )}
          <button className="step-icon-btn" title="Close" onClick={closeStepDialog}>✕</button>
        </div>
        <Dialog
          config={step.config}
          onChange={(config) => updateStepConfig(activeQueryId, step.id, config)}
          onClose={closeStepDialog}
          prevColumns={prevColumns}
        />
      </div>
    </div>
  );
}