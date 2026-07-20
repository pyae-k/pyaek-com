import { describe, it, expect } from "vitest";
import { valuesSteps } from "./values";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = valuesSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("valuesSteps", () => {
  it("exposes 3 defs in the values category", () => {
    expect(valuesSteps).toHaveLength(3);
    for (const s of valuesSteps) {
      expect(s.category).toBe("values");
    }
    expect(valuesSteps.map((s) => s.kind).sort()).toEqual([
      "fix_errors",
      "remove_errors",
      "replace_values",
    ]);
  });

  // --- replace_values ------------------------------------------------------
  describe("replace_values", () => {
    it("whole-cell equals produces CASE WHEN ... AS col", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "equals",
        find: "1",
        replace: "2",
        columnType: "text",
      });
      expect(sql).toContain(`CASE WHEN`);
      expect(sql).toContain(`AS "a"`);
      expect(sql).toContain(`FROM prev`);
      expect(sql).toContain(`SELECT * REPLACE`);
    });

    it("case-insensitive equals uses LOWER(...) comparison", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "equals",
        find: "1",
        replace: "2",
        columnType: "text",
        caseSensitive: false,
      });
      expect(sql).toContain(`LOWER(CAST("a" AS VARCHAR)) = LOWER('1')`);
      expect(sql).toContain(`THEN '2'`);
      expect(sql).toContain(`ELSE "a"`);
    });

    it("case-sensitive equals uses direct equality", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "equals",
        find: "1",
        replace: "2",
        columnType: "text",
        caseSensitive: true,
      });
      expect(sql).toContain(`"a" = '1'`);
    });

    it("matching_text + contains uses REGEXP_REPLACE (case-insensitive)", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "contains",
        find: "x",
        replace: "y",
        columnType: "text",
        replaceScope: "matching_text",
        caseSensitive: false,
      });
      expect(sql).toContain(`REGEXP_REPLACE`);
      expect(sql).toContain(`'gi'`);
      expect(sql).toContain(`AS "a"`);
    });

    it("matching_text + contains case-sensitive uses REPLACE", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "contains",
        find: "x",
        replace: "y",
        columnType: "text",
        replaceScope: "matching_text",
        caseSensitive: true,
      });
      expect(sql).toContain(`REPLACE(CAST("a" AS VARCHAR), 'x', 'y')`);
      expect(sql).not.toContain(`REGEXP_REPLACE`);
    });

    it("matching_text with empty find falls back to SELECT *", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "contains",
        find: "",
        replace: "y",
        columnType: "text",
        replaceScope: "matching_text",
      });
      expect(sql).toBe(`SELECT * FROM prev`);
    });

    it("number columnType quotes the replacement as a number", () => {
      const sql = build("replace_values", {
        column: "a",
        operator: "equals",
        find: "1",
        replace: "2",
        columnType: "number",
      });
      expect(sql).toContain(`"a" = 1`);
      expect(sql).toContain(`THEN 2`);
    });

    it("no column falls back to SELECT * FROM prev", () => {
      const sql = build("replace_values", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });

    it("legacy matchMode=contains migrates to operator+matching_text", () => {
      // Legacy matchMode sets caseSensitive=true (legacy default), so the
      // matching_text path uses plain REPLACE rather than REGEXP_REPLACE.
      const sql = build("replace_values", {
        column: "a",
        matchMode: "contains",
        find: "x",
        replace: "y",
      });
      expect(sql).toContain(`REPLACE(CAST("a" AS VARCHAR), 'x', 'y')`);
      expect(sql).toContain(`AS "a"`);
    });
  });

  // --- remove_errors -------------------------------------------------------
  describe("remove_errors", () => {
    it("no fixes filters out uncastable rows", () => {
      const sql = build("remove_errors", {
        column: "a",
        targetType: "number",
      });
      expect(sql).toBe(
        `SELECT * FROM prev WHERE TRY_CAST("a" AS DOUBLE) IS NOT NULL`,
      );
    });

    it("with per-row fixes uses ROW_NUMBER() OVER () and CASE", () => {
      const sql = build("remove_errors", {
        column: "a",
        targetType: "number",
        fixes: [{ row: 2, newValue: "5" }],
      });
      expect(sql).toContain(`ROW_NUMBER() OVER ()`);
      expect(sql).toContain(`CASE __rn`);
      expect(sql).toContain(`WHEN 2 THEN TRY_CAST('5' AS DOUBLE)`);
      expect(sql).toContain(`WHERE "a" IS NOT NULL`);
      expect(sql).toContain(`EXCLUDE (__rn)`);
    });

    it("invalid fixes are ignored", () => {
      const sqlNoRow = build("remove_errors", {
        column: "a",
        targetType: "number",
        fixes: [{ row: 0, newValue: "5" }],
      });
      expect(sqlNoRow).toBe(
        `SELECT * FROM prev WHERE TRY_CAST("a" AS DOUBLE) IS NOT NULL`,
      );

      const sqlEmpty = build("remove_errors", {
        column: "a",
        targetType: "number",
        fixes: [{ row: 3, newValue: "" }],
      });
      expect(sqlEmpty).toBe(
        `SELECT * FROM prev WHERE TRY_CAST("a" AS DOUBLE) IS NOT NULL`,
      );
    });

    it("no column falls back to SELECT * FROM prev", () => {
      const sql = build("remove_errors", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });

  // --- fix_errors ----------------------------------------------------------
  describe("fix_errors", () => {
    it("no fixes applies the default via CASE", () => {
      const sql = build("fix_errors", {
        column: "a",
        targetType: "number",
        defaultValue: "0",
      });
      expect(sql).toContain(`CASE`);
      expect(sql).toContain(
        `WHEN TRY_CAST("a" AS DOUBLE) IS NULL THEN TRY_CAST('0' AS DOUBLE)`,
      );
      expect(sql).toContain(`ELSE TRY_CAST("a" AS DOUBLE)`);
      expect(sql).toContain(`FROM prev`);
    });

    it("with a per-row fix uses ROW_NUMBER() OVER () and CASE", () => {
      const sql = build("fix_errors", {
        column: "a",
        targetType: "number",
        defaultValue: "0",
        fixes: [{ row: 3, newValue: "9" }],
      });
      expect(sql).toContain(`ROW_NUMBER() OVER ()`);
      expect(sql).toContain(`CASE __rn`);
      expect(sql).toContain(`WHEN 3 THEN TRY_CAST('9' AS DOUBLE)`);
      expect(sql).toContain(`COALESCE(TRY_CAST("a" AS DOUBLE), TRY_CAST('0' AS DOUBLE))`);
      expect(sql).toContain(`EXCLUDE (__rn)`);
    });

    it("no column falls back to SELECT * FROM prev", () => {
      const sql = build("fix_errors", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });
});