import { describe, it, expect } from "vitest";
import { advancedSteps } from "./advanced";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = advancedSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("advancedSteps", () => {
  it("exposes 1 def in the advanced category", () => {
    expect(advancedSteps).toHaveLength(1);
    expect(advancedSteps[0].category).toBe("advanced");
    expect(advancedSteps.map((s) => s.kind)).toEqual(["custom_sql"]);
  });

  describe("custom_sql", () => {
    it("returns user SQL referencing prev verbatim", () => {
      const sql = build("custom_sql", { sql: "SELECT * FROM prev WHERE x > 1" });
      expect(sql).toBe("SELECT * FROM prev WHERE x > 1");
    });

    it("rewrites {{prev}} to the literal prev token", () => {
      const sql = build("custom_sql", { sql: "SELECT * FROM {{prev}}" });
      expect(sql).toBe("SELECT * FROM prev");
    });

    it("returns an empty result when sql is empty and no prev", () => {
      // ctx.prevRef is "prev" here, but per the spec custom_sql returns the
      // no-prev empty body when the user provided no SQL — the engine wraps
      // the step in a CTE regardless, so we never inject a prev reference.
      const sql = build("custom_sql", {});
      expect(sql).toBe("SELECT 1 WHERE FALSE");
    });

    it("does not inject a prev CTE wrapper", () => {
      const sql = build("custom_sql", { sql: "SELECT * FROM prev" });
      expect(sql).not.toContain("prev AS (");
      expect(sql).not.toMatch(/^WITH\b/i);
    });
  });
});