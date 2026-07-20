import { describe, it, expect } from "vitest";
import { combineSteps } from "./combine";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = combineSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("combineSteps", () => {
  it("exposes 2 defs in the combine category", () => {
    expect(combineSteps).toHaveLength(2);
    for (const s of combineSteps) {
      expect(s.category).toBe("combine");
    }
    expect(combineSteps.map((s) => s.kind).sort()).toEqual([
      "append_tables",
      "join_tables",
    ]);
  });

  // --- append_tables -------------------------------------------------------
  describe("append_tables", () => {
    it("emits UNION ALL BY NAME across prev and configured sources", () => {
      const sql = build("append_tables", {
        sources: [{ type: "table", schema: "main", table: "other" }],
      });
      expect(sql).toContain("UNION ALL BY NAME");
      expect(sql).toContain("prev");
      expect(sql).toContain("other");
    });

    it("includes prev as the first branch", () => {
      const sql = build("append_tables", {
        sources: [{ type: "table", schema: "main", table: "other" }],
      });
      expect(sql.indexOf("prev")).toBeLessThan(sql.indexOf("other"));
    });
  });

  // --- join_tables ---------------------------------------------------------
  describe("join_tables", () => {
    it("emits a LEFT JOIN with ON over prev and the right table", () => {
      const sql = build("join_tables", {
        joinKind: "LEFT",
        rightTable: "r",
        keys: [{ left: "a", right: "a" }],
      });
      // joinKind is the legacy alias; normalizeJoinConfig reads joinType, but
      // the engine stores the configured joinType. The catalog default is LEFT.
      expect(sql).toMatch(/LEFT JOIN/);
      expect(sql).toContain("prev");
      expect(sql).toContain("ON");
    });

    it("uses joinType LEFT by default", () => {
      const sql = build("join_tables", {
        joinType: "LEFT",
        table: "r",
        keys: [{ left: "a", right: "a" }],
      });
      expect(sql).toMatch(/LEFT JOIN/);
      expect(sql).toContain("prev");
      expect(sql).toContain("ON");
    });
  });
});