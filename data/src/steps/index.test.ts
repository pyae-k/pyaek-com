import { describe, it, expect } from "vitest";
import type { Step, StepKind } from "../types/step";
import {
  STEP_REGISTRY,
  ALL_STEPS,
  PICKABLE_STEPS,
  STEPS_BY_CATEGORY,
  getStepDef,
  getDefaultConfig,
  regenerateStepSql,
  makeBuildSqlContext,
} from "./index";
import type { StepDef } from "./types";

// The full StepKind union — used to assert the registry is a total mapping.
const ALL_KINDS: StepKind[] = [
  "source_file", "source_table", "source_postgres", "source_sqlserver",
  "source_connection", "source_folder_connection", "folder_path",
  "promote_headers", "pick_columns", "change_type", "duplicate_column",
  "filter_rows", "sort_rows", "remove_duplicates", "fill_null",
  "replace_values", "remove_errors", "fix_errors",
  "clean_text", "add_index", "formula_column", "pivot", "unpivot",
  "expand_list", "expand_struct",
  "append_tables", "join_tables",
  "group_aggregate",
  "custom_sql",
  "export_file",
];

describe("step registry", () => {
  it("registers every StepKind (total mapping)", () => {
    for (const kind of ALL_KINDS) {
      const def = STEP_REGISTRY[kind];
      expect(def, `missing def for ${kind}`).toBeDefined();
      expect(def.kind).toBe(kind);
    }
    expect(ALL_KINDS).toHaveLength(30);
    expect(ALL_STEPS).toHaveLength(30);
  });

  it("getStepDef returns the definition for a kind", () => {
    expect(getStepDef("filter_rows").kind).toBe("filter_rows");
  });

  it("getDefaultConfig returns a fresh copy of the default config", () => {
    const a = getDefaultConfig("filter_rows");
    const b = getDefaultConfig("filter_rows");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // independent objects
  });

  it("PICKABLE_STEPS excludes hidden kinds", () => {
    const kinds = PICKABLE_STEPS.map((d) => d.kind);
    expect(kinds).not.toContain("clean_text");
    expect(kinds).not.toContain("expand_list");
    expect(kinds).not.toContain("expand_struct");
    // custom_sql and the common transforms remain pickable
    expect(kinds).toContain("custom_sql");
    expect(kinds).toContain("filter_rows");
  });

  it("STEPS_BY_CATEGORY covers all 9 categories in catalog order", () => {
    expect(STEPS_BY_CATEGORY.map((c) => c.id)).toEqual([
      "get_data", "columns", "rows", "values", "transform",
      "combine", "aggregate", "advanced", "output",
    ]);
    // get_data has 7 kinds total, all of which are non-hidden
    expect(STEPS_BY_CATEGORY[0].steps).toHaveLength(7);
  });

  it("regenerateStepSql preserves custom_sql (hand-edited)", () => {
    const step: Step = {
      id: "s1", name: "S1", stepKind: "custom_sql", config: {},
      sql: "SELECT 1 AS a", enabled: true, order: 0,
    };
    const out = regenerateStepSql(step, makeBuildSqlContext("step_00", 0));
    expect(out).toBe("SELECT 1 AS a");
  });

  it("regenerateStepSql rebuilds filter_rows from its config", () => {
    const step: Step = {
      id: "s2", name: "S2", stepKind: "filter_rows",
      config: { rules: [{ column: "a", operator: "equals", value: "1", columnType: "text" }] },
      sql: "stale", enabled: true, order: 1,
    };
    const out = regenerateStepSql(step, makeBuildSqlContext("step_01", 1));
    expect(out).toContain("FROM prev");
    expect(out).toContain(`"a" = '1'`);
    expect(out).not.toBe("stale");
  });

  it("regenerateStepSql falls back to prior sql if buildSql throws", () => {
    const def = STEP_REGISTRY["filter_rows"] as StepDef;
    const original = def.buildSql;
    def.buildSql = () => {
      throw new Error("boom");
    };
    const step: Step = {
      id: "s3", name: "S3", stepKind: "filter_rows", config: {}, sql: "kept",
      enabled: true, order: 0,
    };
    try {
      expect(regenerateStepSql(step, makeBuildSqlContext("step_00", 0))).toBe("kept");
    } finally {
      def.buildSql = original;
    }
  });

  it("makeBuildSqlContext threads prevColumns through", () => {
    const ctx = makeBuildSqlContext("step_02", 2, ["a", "b"]);
    expect(ctx.prevRef).toBe("step_02");
    expect(ctx.index).toBe(2);
    expect(ctx.prevColumns).toEqual(["a", "b"]);
  });
});