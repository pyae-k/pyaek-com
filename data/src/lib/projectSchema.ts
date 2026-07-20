// Legacy step migration for etlstudio.json. Ports pwa_duckdb's
// migrateLegacySteps (pipeline.js) so older project files keep working after
// the step-catalog refactor: deprecated step kinds are rewritten to their
// canonical equivalents with their config transformed accordingly.

import type { Step, StepKind } from "../types/query";

const ALIAS_TO_CANONICAL: Record<string, StepKind> = {
  // pwa_etl legacy
  source: "source_file",
  sql: "custom_sql",
  // pwa_duckdb deprecated kinds
  rename_column: "promote_headers",
  add_conditional: "formula_column",
  add_custom: "formula_column",
};

export interface MigratedStep {
  stepKind: StepKind;
  config: Record<string, unknown>;
  name: string;
  description?: string;
}

/** Resolve a (possibly legacy/aliased) step kind + config to the canonical model. */
export function migrateLegacyStep(
  rawStepKind: string,
  config: Record<string, unknown>,
  name: string,
  description?: string,
): MigratedStep {
  const kind = rawStepKind as StepKind;

  if (rawStepKind === "rename_column") {
    const renames = (config.renames as Array<{ from: string; to: string }> | undefined) ?? [];
    const allColumns = (config.allColumns as string[] | undefined)?.length
      ? (config.allColumns as string[])
      : renames.map((r) => r.from);
    const renameMap = Object.fromEntries(renames.map((r) => [r.from, r.to]));
    const customNames = allColumns.map((c) => renameMap[c] || c);
    return {
      stepKind: "promote_headers",
      name: name === "Rename column" ? "Set column names" : name,
      description: "Use a row as headers, enter custom names, or demote headers to data",
      config: {
        mode: "custom",
        headerRow: 1,
        customNames,
        mappings: allColumns.map((c, j) => ({ from: c, to: customNames[j] || c })),
        allColumns,
      },
    };
  }

  if (rawStepKind === "add_conditional" || rawStepKind === "add_custom") {
    let expressionSql = (config.expressionSql as string) || "";
    if (!expressionSql) {
      if (rawStepKind === "add_conditional") {
        const thenV = String(config.thenValue ?? "yes").replace(/'/g, "''");
        const elseV = String(config.elseValue ?? "no").replace(/'/g, "''");
        const cond = (config.condition as string) || "1=1";
        expressionSql = `CASE WHEN ${cond} THEN '${thenV}' ELSE '${elseV}' END`;
      } else {
        expressionSql = (config.expression as string) || "NULL";
      }
    }
    return {
      stepKind: "formula_column",
      name:
        name === "Conditional column" || name === "Custom calculation" ? "Formula column" : name,
      description: "Add a column with a DuckDB SQL expression",
      config: {
        expressionSql,
        newName: (config.newName as string) || (rawStepKind === "add_conditional" ? "flag" : "calc"),
      },
    };
  }

  if (kind === "append_tables") {
    const hasSources = Array.isArray(config.sources) && config.sources.length;
    if (!hasSources && config.table) {
      return {
        stepKind: "append_tables",
        name,
        description,
        config: {
          ...config,
          sources: [
            {
              type: "table",
              schema: (config.schema as string) || "main",
              table: config.table as string,
              label: `${(config.schema as string) || "main"}.${config.table as string}`,
            },
          ],
        },
      };
    }
  }

  const canonical = ALIAS_TO_CANONICAL[rawStepKind] ?? (rawStepKind as StepKind);
  return { stepKind: canonical, config, name, description };
}

/** Migrate an array of raw step records to unified Step objects (with new ids preserved). */
export function migrateStepRecords(
  raws: Array<Record<string, unknown> & { type?: string }>,
): Step[] {
  return raws.map((raw, i) => {
    const rawKind = String(
      (raw.stepKind as string) ?? (raw.type === "source" ? "source_file" : "custom_sql"),
    );
    const config =
      raw.config && typeof raw.config === "object"
        ? (raw.config as Record<string, unknown>)
        : {};
    const migrated = migrateLegacyStep(
      rawKind,
      config,
      String(raw.name ?? "Step"),
      raw.description as string | undefined,
    );
    return {
      id: String(raw.id ?? `step_${i}`),
      name: migrated.name,
      stepKind: migrated.stepKind,
      config: migrated.config,
      description: migrated.description,
      enabled: raw.enabled !== false,
      order: typeof raw.order === "number" ? raw.order : i,
      sql: String(raw.sql ?? ""),
    } satisfies Step;
  });
}