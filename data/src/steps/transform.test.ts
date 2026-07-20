import { describe, it, expect } from "vitest";
import { transformSteps } from "./transform";
import type { StepDef, BuildSqlContext } from "./types";

const baseCtx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = transformSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(
  kind: string,
  config: Record<string, unknown>,
  ctx: BuildSqlContext = baseCtx,
): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("transformSteps", () => {
  it("exposes 7 defs in the transform category", () => {
    expect(transformSteps).toHaveLength(7);
    for (const s of transformSteps) {
      expect(s.category).toBe("transform");
    }
    expect(transformSteps.map((s) => s.kind).sort()).toEqual([
      "add_index",
      "clean_text",
      "expand_list",
      "expand_struct",
      "formula_column",
      "pivot",
      "unpivot",
    ]);
  });

  it("hides clean_text, expand_list, expand_struct", () => {
    const hidden = new Set(
      transformSteps.filter((s) => s.hidden).map((s) => s.kind),
    );
    expect(hidden).toEqual(new Set(["clean_text", "expand_list", "expand_struct"]));
  });

  // --- add_index ------------------------------------------------------------
  describe("add_index", () => {
    it("emits ROW_NUMBER() OVER () with the new column name", () => {
      const sql = build("add_index", { newColumnName: "idx" });
      expect(sql).toContain(`ROW_NUMBER() OVER () AS "idx"`);
      expect(sql).toContain("FROM prev");
    });

    it("supports the legacy columnName field", () => {
      const sql = build("add_index", { columnName: "row_num" });
      expect(sql).toContain(`ROW_NUMBER() OVER () AS "row_num"`);
    });

    it("adds ORDER BY when a sort column is set", () => {
      const sql = build("add_index", {
        newColumnName: "idx",
        sortColumn: "created_at",
        sortDirection: "DESC",
      });
      expect(sql).toContain(`ROW_NUMBER() OVER (ORDER BY "created_at" DESC) AS "idx"`);
    });
  });

  // --- formula_column -------------------------------------------------------
  describe("formula_column", () => {
    it("uses expressionSql and aliases to newName", () => {
      const sql = build(
        "formula_column",
        { expressionSql: '"a" * 2', newName: "b" },
      );
      expect(sql).toContain(`"a" * 2 AS "b"`);
      expect(sql).toContain("FROM prev");
    });

    it("emits NULL when expressionSql is empty", () => {
      const sql = build("formula_column", { newName: "b" });
      expect(sql).toContain("NULL");
      expect(sql).toContain(`AS "b"`);
    });
  });

  // --- clean_text -----------------------------------------------------------
  describe("clean_text", () => {
    it("composes operations outer-to-inner (trim then lower)", () => {
      const sql = build("clean_text", {
        column: "a",
        operations: ["trim", "lower"],
      });
      expect(sql).toContain(`TRIM(LOWER("a")) AS "a"`);
      expect(sql).toContain("FROM prev");
    });

    it("still supports the legacy single operation field", () => {
      const sql = build("clean_text", { column: "a", operation: "upper" });
      expect(sql).toContain(`UPPER(CAST("a" AS VARCHAR)) AS "a"`);
    });

    it("passes through when no column is set", () => {
      const sql = build("clean_text", {});
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });

  // --- pivot ----------------------------------------------------------------
  describe("pivot", () => {
    it("emits a DuckDB PIVOT statement", () => {
      const sql = build("pivot", {
        indexCols: ["region"],
        pivotCol: "category",
        aggregations: [{ column: "sales", fn: "SUM", alias: "" }],
      });
      expect(sql).toContain("PIVOT");
      expect(sql).toContain(`ON "category"`);
      expect(sql).toContain(`SUM("sales")`);
      expect(sql).toContain(`GROUP BY "region"`);
    });

    it("uses an IN filter when useAllValues is false with values", () => {
      const sql = build("pivot", {
        pivotCol: "category",
        pivotValues: ["a", "b"],
        useAllValues: false,
        aggregations: [{ column: "sales", fn: "SUM", alias: "" }],
      });
      expect(sql).toContain(`"category" IN ('a', 'b')`);
    });

    it("passes through when pivotCol or aggregations are missing", () => {
      const sql = build("pivot", { pivotCol: "", aggregations: [] });
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });

  // --- unpivot --------------------------------------------------------------
  describe("unpivot", () => {
    it("emits an UNPIVOT statement", () => {
      const sql = build("unpivot", {
        idCols: ["id"],
        valueCols: ["q1", "q2"],
        nameCol: "attribute",
        valueCol: "value",
      });
      expect(sql).toContain("UNPIVOT");
      expect(sql).toContain(`ON "q1", "q2"`);
      expect(sql).toContain(`INTO NAME "attribute" VALUE "value"`);
      expect(sql).toContain(`BY "id"`);
    });

    it("passes through when no value columns are given", () => {
      const sql = build("unpivot", { idCols: ["id"], valueCols: [] });
      expect(sql).toBe(`SELECT * FROM prev`);
    });
  });

  // --- expand_list / expand_struct -----------------------------------------
  describe("expand_list", () => {
    it("unnests a list column into rows", () => {
      const sql = build("expand_list", { column: "tags" });
      expect(sql).toContain(`UNNEST("tags") AS "tags_item"`);
      expect(sql).toContain(`EXCLUDE ("tags")`);
    });
  });

  describe("expand_struct", () => {
    it("extracts struct fields as columns", () => {
      const sql = build("expand_struct", { column: "addr", fields: ["city", "zip"] });
      expect(sql).toContain(`struct_extract("addr", 'city') AS "city"`);
      expect(sql).toContain(`struct_extract("addr", 'zip') AS "zip"`);
    });
  });
});