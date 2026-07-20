import { describe, it, expect } from "vitest";
import { migrateLegacyStep, migrateStepRecords } from "./projectSchema";

describe("projectSchema migration", () => {
  it("rewrites rename_column -> promote_headers (custom mode)", () => {
    const m = migrateLegacyStep(
      "rename_column",
      { renames: [{ from: "a", to: "x" }, { from: "b", to: "y" }] },
      "Rename column",
    );
    expect(m.stepKind).toBe("promote_headers");
    expect(m.name).toBe("Set column names");
    expect((m.config as { mode: string }).mode).toBe("custom");
    expect((m.config as { customNames: string[] }).customNames).toEqual(["x", "y"]);
  });

  it("rewrites add_conditional -> formula_column with a CASE WHEN expression", () => {
    const m = migrateLegacyStep(
      "add_conditional",
      { condition: "[a]>100", thenValue: "yes", elseValue: "no", newName: "flag" },
      "Conditional column",
    );
    expect(m.stepKind).toBe("formula_column");
    expect(m.name).toBe("Formula column");
    expect((m.config as { expressionSql: string }).expressionSql).toBe("CASE WHEN [a]>100 THEN 'yes' ELSE 'no' END");
    expect((m.config as { newName: string }).newName).toBe("flag");
  });

  it("rewrites add_custom -> formula_column with expressionSql", () => {
    const m = migrateLegacyStep("add_custom", { expression: "[a]+[b]" }, "Custom calculation");
    expect(m.stepKind).toBe("formula_column");
    expect((m.config as { expressionSql: string }).expressionSql).toBe("[a]+[b]");
  });

  it("converts legacy append {table} -> sources[]", () => {
    const m = migrateLegacyStep("append_tables", { schema: "main", table: "x" }, "Append");
    expect(m.stepKind).toBe("append_tables");
    const sources = (m.config as { sources: Array<{ type: string; table: string }> }).sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("table");
    expect(sources[0].table).toBe("x");
  });

  it("maps legacy pwa_etl types", () => {
    expect(migrateLegacyStep("source", {}, "S").stepKind).toBe("source_file");
    expect(migrateLegacyStep("sql", {}, "S").stepKind).toBe("custom_sql");
  });

  it("passes through canonical kinds untouched", () => {
    const m = migrateLegacyStep("filter_rows", { rules: [] }, "Filter");
    expect(m.stepKind).toBe("filter_rows");
  });

  it("migrateStepRecords preserves ids/order/enabled/sql", () => {
    const steps = migrateStepRecords([
      { id: "a", name: "S1", type: "sql", enabled: true, order: 0, sql: "SELECT 1" },
      { id: "b", name: "S2", stepKind: "rename_column", config: { renames: [{ from: "a", to: "x" }] }, enabled: false, order: 1, sql: "x" },
    ]);
    expect(steps[0].id).toBe("a");
    expect(steps[0].stepKind).toBe("custom_sql");
    expect(steps[1].id).toBe("b");
    expect(steps[1].stepKind).toBe("promote_headers");
    expect(steps[1].enabled).toBe(false);
  });
});