// Step catalog contract. Each step kind has a StepDef with a pure `buildSql`
// that turns a structured `config` into a DuckDB SQL string referencing the
// previous step as `prev` (resolved to a CTE name by engine/cteBuilder). The
// step's `sql` field is regenerated from `config` via buildSql whenever the
// config changes (see regenerateStepSql); for custom_sql the SQL is hand-edited.
//
// Ported from pwa_duckdb/js/step-catalog.js, adapted to TypeScript.

import type { ComponentType } from "react";
import type { StepCategory, StepKind } from "../types/step";

export interface BuildSqlContext {
  /** CTE name of the previous step, e.g. "step_01". Empty for the first step. */
  prevRef: string;
  /** 0-based index of this step within the enabled pipeline. */
  index: number;
  /** Optional: column names available from the previous step (for formula/autocomplete). */
  prevColumns?: string[];
  /**
   * When true, build SQL for a portable desktop script (e.g. a Download-SQL
   * export) — folder sources emit `getvariable('alias') || '/file'` path
   * expressions. When false/undefined (the default), build SQL for in-browser
   * execution against registered virtual file buffers.
   */
  portable?: boolean;
}

export interface StepDef {
  kind: StepKind;
  category: StepCategory;
  name: string;
  description: string;
  /** Hidden from the step picker (legacy aliases / niche transforms). */
  hidden?: boolean;
  /** Cannot run in WASM; emitted as script for desktop DuckDB. */
  scriptOnly?: boolean;
  /** UI-only placeholder (e.g. source_folder_connection) — produces no runnable SQL. */
  uiOnly?: boolean;
  defaultConfig: Record<string, unknown>;
  /** Pure: config + ctx -> SQL string (references `prev` for non-source steps). */
  buildSql: (config: Record<string, unknown>, ctx: BuildSqlContext) => string;
  /** Optional React dialog for editing this step's config. */
  Dialog?: ComponentType<StepDialogProps>;
}

export interface StepDialogProps {
  config: Record<string, unknown>;
  /** Replace the step's config (the store will regenerate SQL via buildSql). */
  onChange: (config: Record<string, unknown>) => void;
  /** Column names available from the previous step (when known). */
  prevColumns?: string[];
  /** Close the dialog. */
  onClose: () => void;
}

/** A registry of all step definitions keyed by StepKind. */
export type StepRegistry = Record<StepKind, StepDef>;