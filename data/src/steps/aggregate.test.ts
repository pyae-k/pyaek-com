import { describe, it, expect } from "vitest";
import { aggregateSteps } from "./aggregate";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = aggregateSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("aggregateSteps", () => {
  it("exposes 1 def in the aggregate category", () => {
    expect(aggregateSteps).toHaveLength(1);
    expect(aggregateSteps[0].category).toBe("aggregate");
    expect(aggregateSteps[0].kind).toBe("group_aggregate");
  });

  // --- group_aggregate -----------------------------------------------------
  describe("group_aggregate", () => {
    it("groups and aggregates with alias", () => {
      const sql = build("group_aggregate", {
        groupColumns: ["g"],
        aggregations: [{ fn: "SUM", column: "v", alias: "total" }],
      });
      expect(sql).toContain(`SUM("v") AS "total"`);
      expect(sql).toContain(`GROUP BY "g"`);
      expect(sql).toContain(`SELECT "g"`);
    });

    it("COUNT_ROWS emits COUNT(*)", () => {
      const sql = build("group_aggregate", {
        groupColumns: ["g"],
        aggregations: [{ fn: "COUNT_ROWS", column: "", alias: "n" }],
      });
      expect(sql).toContain(`COUNT(*) AS "n"`);
    });

    it("COUNT_DISTINCT emits COUNT(DISTINCT ...)", () => {
      const sql = build("group_aggregate", {
        groupColumns: ["g"],
        aggregations: [{ fn: "COUNT_DISTINCT", column: "v", alias: "nd" }],
      });
      expect(sql).toContain(`COUNT(DISTINCT`);
      expect(sql).toContain(`COUNT(DISTINCT "v") AS "nd"`);
    });

    it("de-duplicates aliases that collide with a group column", () => {
      const sql = build("group_aggregate", {
        groupColumns: ["g"],
        aggregations: [{ fn: "SUM", column: "v", alias: "g" }],
      });
      expect(sql).toContain(`AS "g_2"`);
      expect(sql).not.toContain(`AS "g"`);
    });

    it("auto-derives an alias when none given", () => {
      const sql = build("group_aggregate", {
        groupColumns: ["g"],
        aggregations: [{ fn: "SUM", column: "v" }],
      });
      expect(sql).toContain(`SUM("v") AS "v"`);
    });

    it("no group columns produces a grand-total SELECT", () => {
      const sql = build("group_aggregate", {
        aggregations: [{ fn: "SUM", column: "v", alias: "total" }],
      });
      expect(sql).toBe(`SELECT SUM("v") AS "total" FROM prev`);
    });

    it("empty aggregations with no group columns defaults to COUNT(*)", () => {
      const sql = build("group_aggregate", {});
      expect(sql).toBe(`SELECT COUNT(*) AS row_count FROM prev`);
    });

    it("legacy groupBy shape still works", () => {
      const sql = build("group_aggregate", {
        groupBy: ["g"],
        aggregations: [{ fn: "SUM", column: "v", alias: "total" }],
      });
      expect(sql).toContain(`SUM("v") AS "total"`);
      expect(sql).toContain(`GROUP BY "g"`);
    });
  });
});