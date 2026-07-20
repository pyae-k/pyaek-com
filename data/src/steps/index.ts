// Step registry: assembles every category's StepDefs into a single
// `Record<StepKind, StepDef>` and exposes helpers to look up definitions and
// regenerate a step's SQL from its config. The store calls `regenerateStepSql`
// whenever a step's config changes so the `sql` field stays in sync (except for
// `custom_sql`, whose SQL is hand-edited and therefore preserved).
//
// Ported from pwa_duckdb/js/step-catalog.js (the registry/index side).

import type { Step, StepKind } from "../types/step";
import { STEP_CATEGORIES } from "../types/step";
import type { BuildSqlContext, StepDef, StepRegistry } from "./types";

import { getDataSteps } from "./getData";
import { columnsSteps } from "./columns";
import { rowsSteps } from "./rows";
import { valuesSteps } from "./values";
import { transformSteps } from "./transform";
import { combineSteps } from "./combine";
import { aggregateSteps } from "./aggregate";
import { advancedSteps } from "./advanced";
import { outputSteps } from "./output";

const ALL_CATEGORY_STEPS: StepDef[] = [
  ...getDataSteps,
  ...columnsSteps,
  ...rowsSteps,
  ...valuesSteps,
  ...transformSteps,
  ...combineSteps,
  ...aggregateSteps,
  ...advancedSteps,
  ...outputSteps,
];

/** Every step definition keyed by its kind (total mapping). */
export const STEP_REGISTRY = ALL_CATEGORY_STEPS.reduce<StepRegistry>(
  (acc, def) => {
    acc[def.kind] = def;
    return acc;
  },
  {} as StepRegistry,
);

/** All step definitions, grouped by category in catalog order. */
export const ALL_STEPS: StepDef[] = ALL_CATEGORY_STEPS;

/** Steps visible in the picker (hidden legacy/niche kinds excluded). */
export const PICKABLE_STEPS: StepDef[] = ALL_CATEGORY_STEPS.filter((d) => !d.hidden);

/** Steps grouped by category, in the order shown in the picker. */
export const STEPS_BY_CATEGORY: { id: string; label: string; steps: StepDef[] }[] =
  STEP_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    steps: ALL_CATEGORY_STEPS.filter((d) => d.category === cat.id && !d.hidden),
  }));

export function getStepDef(kind: StepKind): StepDef {
  return STEP_REGISTRY[kind];
}

export function getDefaultConfig(kind: StepKind): Record<string, unknown> {
  const def = STEP_REGISTRY[kind];
  return def ? { ...def.defaultConfig } : {};
}

/** Build the BuildSqlContext for a step at a given position in the enabled pipeline. */
export function makeBuildSqlContext(
  prevRef: string,
  index: number,
  prevColumns?: string[],
  portable?: boolean,
): BuildSqlContext {
  return { prevRef, index, prevColumns, portable };
}

/**
 * Regenerate a step's SQL from its config.
 *
 * For `custom_sql` the SQL is hand-edited, so the existing `step.sql` is
 * returned unchanged. For every other kind the catalog's `buildSql` is invoked.
 * If a definition is missing or buildSql throws, the prior SQL is preserved
 * rather than silently blanking the step.
 */
export function regenerateStepSql(step: Step, ctx: BuildSqlContext): string {
  if (step.stepKind === "custom_sql") {
    return step.sql;
  }
  const def = STEP_REGISTRY[step.stepKind];
  if (!def) {
    return step.sql;
  }
  try {
    return def.buildSql(step.config, ctx);
  } catch {
    return step.sql;
  }
}

export type { StepDef, StepRegistry, BuildSqlContext } from "./types";