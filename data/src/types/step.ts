// Unified step model (ported from pwa_duckdb's stepKind + config design).
//
// Every step has a `stepKind` (one of ~30 kinds across 9 categories) and a
// structured `config`. The step's `sql` is generated from the config by the
// step catalog's `buildSql` (see src/steps/*) and is the authoritative string
// executed by the engine — it can also be hand-edited for `custom_sql`. This
// replaces pwa_etl's old `{ type: "source" | "sql"; sql }` model; legacy steps
// are migrated on load (see src/lib/projectSchema.ts).

export type StepCategory =
  | "get_data"
  | "columns"
  | "rows"
  | "values"
  | "transform"
  | "combine"
  | "aggregate"
  | "advanced"
  | "output";

export type StepKind =
  // get_data
  | "source_file"
  | "source_table"
  | "source_postgres"
  | "source_sqlserver"
  | "source_connection"
  | "source_folder_connection"
  | "folder_path"
  // columns
  | "promote_headers"
  | "pick_columns"
  | "change_type"
  | "duplicate_column"
  // rows
  | "filter_rows"
  | "sort_rows"
  | "remove_duplicates"
  | "fill_null"
  // values
  | "replace_values"
  | "remove_errors"
  | "fix_errors"
  // transform
  | "clean_text"
  | "add_index"
  | "formula_column"
  | "pivot"
  | "unpivot"
  | "expand_list"
  | "expand_struct"
  // combine
  | "append_tables"
  | "join_tables"
  // aggregate
  | "group_aggregate"
  // advanced
  | "custom_sql"
  // output
  | "export_file";

export type StepStatus = "ok" | "script-only" | "error" | "pending";

export interface Step {
  id: string;
  name: string;
  stepKind: StepKind;
  config: Record<string, unknown>;
  /** Generated/regenerable SQL, or hand-edited for custom_sql. Authoritative for execution. */
  sql: string;
  enabled: boolean;
  order: number;
  description?: string;
  /** Runtime status, not persisted. */
  status?: StepStatus;
}

// Legacy pwa_etl step type → unified stepKind mapping (used during load).
export type LegacyStepType = "source" | "sql";

export function legacyTypeToStepKind(type: LegacyStepType | string | undefined): StepKind {
  return type === "source" ? "source_file" : "custom_sql";
}

// Step-kind metadata sets (ported from pwa_duckdb/js/pipeline.js).

/** Kinds that cannot run in WASM and are emitted as script for desktop DuckDB. */
export const SCRIPT_ONLY_STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "folder_path",
  "source_postgres",
  "source_sqlserver",
  "source_connection",
]);

/** Output kinds excluded from the runnable pipeline CTE chain. */
export const OUTPUT_STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "export_file",
]);

/** Source kinds that begin a pipeline. */
export const SOURCE_STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "source_file",
  "source_table",
  "source_postgres",
  "source_sqlserver",
  "source_connection",
]);

/** Kinds hidden from the step picker (legacy aliases / niche transforms). */
export const HIDDEN_STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "add_conditional" as StepKind,
  "add_custom" as StepKind,
  "clean_text",
  "expand_list",
  "expand_struct",
]);

export function isScriptOnlyStep(step: Step): boolean {
  return SCRIPT_ONLY_STEP_KINDS.has(step.stepKind);
}

export function isOutputStep(step: Step): boolean {
  return OUTPUT_STEP_KINDS.has(step.stepKind);
}

export function isSourceStep(step: Step): boolean {
  return SOURCE_STEP_KINDS.has(step.stepKind);
}

export const STEP_CATEGORIES: { id: StepCategory; label: string }[] = [
  { id: "get_data", label: "Get Data" },
  { id: "columns", label: "Columns" },
  { id: "rows", label: "Rows" },
  { id: "values", label: "Values" },
  { id: "transform", label: "Transform" },
  { id: "combine", label: "Combine" },
  { id: "aggregate", label: "Aggregate" },
  { id: "advanced", label: "Advanced" },
  { id: "output", label: "Output" },
];