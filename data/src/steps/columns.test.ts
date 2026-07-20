import { describe, it, expect } from "vitest";
import { columnsSteps } from "./columns";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = columnsSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("columnsSteps", () => {
  it("exposes 4 defs in the columns category", () => {
    expect(columnsSteps).toHaveLength(4);
    for (const s of columnsSteps) {
      expect(s.category).toBe("columns");
    }
    expect(columnsSteps.map((s) => s.kind).sort()).toEqual([
      "change_type",
      "duplicate_column",
      "pick_columns",
      "promote_headers",
    ]);
  });

  // --- pick_columns --------------------------------------------------------
  describe("pick_columns", () => {
    it("keep mode selects the named columns", () => {
      const sql = build("pick_columns", { columns: ["a", "b"] });
      expect(sql).toBe(`SELECT "a", "b" FROM prev`);
    });

    it("remove mode uses EXCLUDE", () => {
      const sql = build("pick_columns", {
        mode: "remove",
        columns: ["a"],
      });
      expect(sql).toBe(`SELECT * EXCLUDE ("a") FROM prev`);
    });

    it("empty columns falls back to SELECT *", () => {
      const sql = build("pick_columns", { columns: [] });
      expect(sql).toBe(`SELECT * FROM prev`);
    });

    it("quotes column names with embedded quotes", () => {
      const sql = build("pick_columns", { columns: ['a"b'] });
      expect(sql).toBe(`SELECT "a""b" FROM prev`);
    });
  });

  // --- change_type ---------------------------------------------------------
  describe("change_type", () => {
    it("casts via TRY_CAST using TYPE_MAP for number", () => {
      const sql = build("change_type", {
        columns: [{ column: "a", type: "number" }],
      });
      expect(sql).toContain(`TRY_CAST("a" AS DOUBLE) AS "a"`);
      expect(sql).toContain(`SELECT * REPLACE (`);
      expect(sql).toContain(`FROM prev`);
    });

    it("casts integer → BIGINT", () => {
      const sql = build("change_type", {
        columns: [{ column: "n", type: "integer" }],
      });
      expect(sql).toContain(`TRY_CAST("n" AS BIGINT) AS "n"`);
    });

    it("date type uses buildDateTypeReplacementSql", () => {
      const sql = build("change_type", {
        columns: [{ column: "d", type: "date" }],
      });
      expect(sql).toContain(`try_strptime`);
      expect(sql).toContain(`AS "d"`);
    });

    it("legacy types map shape still works", () => {
      const sql = build("change_type", {
        types: { x: "boolean" },
      });
      expect(sql).toContain(`TRY_CAST("x" AS BOOLEAN) AS "x"`);
    });

    it("legacy single column/targetType shape", () => {
      const sql = build("change_type", {
        column: "y",
        targetType: "text",
      });
      expect(sql).toContain(`TRY_CAST("y" AS VARCHAR) AS "y"`);
    });

    it("no changes → SELECT * FROM prev", () => {
      const sql = build("change_type", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });

    it("multiple columns produce a comma-joined REPLACE list", () => {
      const sql = build("change_type", {
        columns: [
          { column: "a", type: "number" },
          { column: "b", type: "text" },
        ],
      });
      expect(sql).toContain(`TRY_CAST("a" AS DOUBLE) AS "a"`);
      expect(sql).toContain(`TRY_CAST("b" AS VARCHAR) AS "b"`);
      expect(sql).toMatch(/AS "a", TRY_CAST/);
    });
  });

  // --- promote_headers -----------------------------------------------------
  describe("promote_headers", () => {
    it("custom mode maps allColumns to customNames", () => {
      const sql = build("promote_headers", {
        mode: "custom",
        customNames: ["x", "y"],
        allColumns: ["a", "b"],
      });
      expect(sql).toContain(`"a" AS "x"`);
      expect(sql).toContain(`"b" AS "y"`);
      expect(sql).toBe(`SELECT "a" AS "x", "b" AS "y" FROM prev`);
    });

    it("promote mode with allColumns offsets and renames to col_N", () => {
      const sql = build("promote_headers", {
        mode: "promote",
        headerRow: 2,
        allColumns: ["a", "b"],
      });
      expect(sql).toContain(`OFFSET 2`);
      expect(sql).toContain(`"a" AS "col_1"`);
      expect(sql).toContain(`"b" AS "col_2"`);
    });

    it("promote with no allColumns offsets and selects *", () => {
      const sql = build("promote_headers", {
        mode: "promote",
        headerRow: 1,
      });
      expect(sql).toBe(`SELECT * FROM (SELECT * FROM prev OFFSET 1)`);
    });

    it("mappings shape renames from→to with offset in promote mode", () => {
      const sql = build("promote_headers", {
        mode: "promote",
        headerRow: 1,
        mappings: [{ from: "a", to: "x" }],
      });
      expect(sql).toBe(`SELECT "a" AS "x" FROM (SELECT * FROM prev OFFSET 1)`);
    });

    it("mappings with non-promote mode has no offset", () => {
      const sql = build("promote_headers", {
        mode: "custom",
        mappings: [{ from: "a", to: "x" }],
      });
      expect(sql).toBe(`SELECT "a" AS "x" FROM prev`);
    });

    it("demote mode unions a header row by name", () => {
      const sql = build("promote_headers", {
        mode: "demote",
        allColumns: ["a", "b"],
      });
      expect(sql).toContain(`UNION ALL BY NAME`);
      expect(sql).toContain(`'a' AS "a"`);
      expect(sql).toContain(`SELECT "a", "b" FROM prev`);
    });

    it("demote with no columns falls back to SELECT *", () => {
      const sql = build("promote_headers", { mode: "demote" });
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });

  // --- duplicate_column ----------------------------------------------------
  describe("duplicate_column", () => {
    it("legacy single column/newName shape", () => {
      const sql = build("duplicate_column", {
        column: "a",
        newName: "a2",
      });
      expect(sql).toContain(`"a" AS "a2"`);
      expect(sql).toBe(`SELECT *, "a" AS "a2" FROM prev`);
    });

    it("duplicates array shape", () => {
      const sql = build("duplicate_column", {
        duplicates: [
          { column: "a", newName: "a2" },
          { column: "b", newName: "b2" },
        ],
      });
      expect(sql).toBe(`SELECT *, "a" AS "a2", "b" AS "b2" FROM prev`);
    });

    it("empty duplicates falls back to SELECT *", () => {
      const sql = build("duplicate_column", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });
});