import { describe, it, expect } from "vitest";
import { rowsSteps } from "./rows";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = rowsSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("rowsSteps", () => {
  it("exposes 4 defs in the rows category", () => {
    expect(rowsSteps).toHaveLength(4);
    for (const s of rowsSteps) {
      expect(s.category).toBe("rows");
    }
    expect(rowsSteps.map((s) => s.kind).sort()).toEqual([
      "fill_null",
      "filter_rows",
      "remove_duplicates",
      "sort_rows",
    ]);
  });

  // --- filter_rows ---------------------------------------------------------
  describe("filter_rows", () => {
    it("rule-builder mode emits WHERE with the rule predicate", () => {
      const sql = build("filter_rows", {
        rules: [{ column: "a", operator: "equals", value: "1", columnType: "text" }],
      });
      expect(sql).toContain(`SELECT * FROM prev WHERE`);
      expect(sql).toContain(`"a" = '1'`);
    });

    it("raw SQL mode passes the condition through verbatim", () => {
      const sql = build("filter_rows", { mode: "sql", condition: "a > 5" });
      expect(sql).toBe(`SELECT * FROM prev WHERE a > 5`);
    });

    it("wraps multiple rules with AND by default", () => {
      const sql = build("filter_rows", {
        rules: [
          { column: "a", operator: "equals", value: "1", columnType: "text" },
          { column: "b", operator: "greater_than", value: "5", columnType: "number" },
        ],
      });
      expect(sql).toContain(`AND`);
      expect(sql).toContain(`("a" = '1')`);
      expect(sql).toContain(`("b" > 5)`);
    });
  });

  // --- sort_rows -----------------------------------------------------------
  describe("sort_rows", () => {
    it("orders by the named column with the given direction", () => {
      const sql = build("sort_rows", { sorts: [{ column: "a", direction: "DESC" }] });
      expect(sql).toContain(`ORDER BY "a" DESC`);
    });

    it("defaults direction to ASC when omitted", () => {
      const sql = build("sort_rows", { sorts: [{ column: "a" }] });
      expect(sql).toBe(`SELECT * FROM prev ORDER BY "a" ASC`);
    });

    it("multiple sorts produce a comma-joined ORDER BY", () => {
      const sql = build("sort_rows", {
        sorts: [
          { column: "a", direction: "DESC" },
          { column: "b", direction: "ASC" },
        ],
      });
      expect(sql).toBe(`SELECT * FROM prev ORDER BY "a" DESC, "b" ASC`);
    });

    it("empty sorts fall back to SELECT * FROM prev", () => {
      const sql = build("sort_rows", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });

    it("legacy orderBy shape still works", () => {
      const sql = build("sort_rows", { orderBy: [{ column: "a", direction: "DESC" }] });
      expect(sql).toContain(`ORDER BY "a" DESC`);
    });
  });

  // --- remove_duplicates ---------------------------------------------------
  describe("remove_duplicates", () => {
    it("with columns uses ROW_NUMBER window + WHERE _rn = 1", () => {
      const sql = build("remove_duplicates", { columns: ["a", "b"] });
      expect(sql).toContain(`ROW_NUMBER() OVER (PARTITION BY`);
      expect(sql).toContain(`WHERE _rn = 1`);
      expect(sql).toContain(`PARTITION BY "a", "b"`);
      expect(sql).toContain(`FROM prev`);
    });

    it("with no columns uses SELECT DISTINCT *", () => {
      const sql = build("remove_duplicates", {});
      expect(sql).toBe(`SELECT DISTINCT * FROM prev`);
    });
  });

  // --- fill_null -----------------------------------------------------------
  describe("fill_null", () => {
    it("text column quotes the fill value", () => {
      const sql = build("fill_null", { column: "a", value: "x", columnType: "text" });
      expect(sql).toContain(`COALESCE("a", 'x') AS "a"`);
    });

    it("number column emits the fill value raw", () => {
      const sql = build("fill_null", { column: "a", value: "0", columnType: "number" });
      expect(sql).toContain(`COALESCE("a", 0) AS "a"`);
    });

    it("defaults to quoted literal when columnType omitted", () => {
      const sql = build("fill_null", { column: "a", value: "x" });
      expect(sql).toContain(`COALESCE("a", 'x') AS "a"`);
    });

    it("no column falls back to SELECT * FROM prev", () => {
      const sql = build("fill_null", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });
});