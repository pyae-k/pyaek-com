import { describe, it, expect } from "vitest";
import { outputSteps } from "./output";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = outputSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("outputSteps", () => {
  it("exposes 1 def in the output category", () => {
    expect(outputSteps).toHaveLength(1);
    for (const s of outputSteps) {
      expect(s.category).toBe("output");
      // Output steps are engine-handled, not WASM-runnable.
      expect(s.scriptOnly).toBe(true);
    }
    expect(outputSteps.map((s) => s.kind).sort()).toEqual([
      "export_file",
    ]);
  });

  // --- export_file ---------------------------------------------------------
  describe("export_file", () => {
    it("emits an export_file marker with the format", () => {
      const sql = build("export_file", { format: "xlsx" });
      expect(sql).toContain("export_file");
      expect(sql).toContain("xlsx");
    });
  });
});