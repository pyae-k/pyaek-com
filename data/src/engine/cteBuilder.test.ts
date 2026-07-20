import { describe, it, expect } from "vitest";
import { buildUpTo, buildFull, substituteParams, cteName } from "./cteBuilder";
import { createQueryResolver } from "./references";
import type { Query, Step } from "../types/query";

function step(id: string, sql: string, enabled = true): Step {
  return { id, name: id, stepKind: "custom_sql", config: {}, sql, enabled, order: 0 };
}

function query(id: string, name: string, steps: Step[]): Query {
  return { id, name, folderId: null, enabled: true, order: 0, createdAt: 0, updatedAt: 0, steps };
}

describe("cteBuilder", () => {
  it("resolves `prev` to the previous CTE name", () => {
    const steps = [
      step("s1", "SELECT 1 AS a"),
      step("s2", "SELECT * FROM prev WHERE a > 0"),
    ];
    const compiled = buildFull(steps);
    expect(compiled.fullSQL).toContain("WITH step_01 AS (");
    expect(compiled.fullSQL).toContain("SELECT * FROM step_01 WHERE a > 0");
  });

  it("emits a final SELECT * FROM the target step", () => {
    const steps = [step("s1", "SELECT 1 AS a"), step("s2", "SELECT * FROM prev")];
    const compiled = buildUpTo(steps, 1);
    expect(compiled.fullSQL).toMatch(/SELECT \* FROM step_02$/);
  });

  it("skips disabled steps", () => {
    const steps = [
      step("s1", "SELECT 1 AS a"),
      step("s2", "SELECT 'disabled_marker' AS x", false),
      step("s3", "SELECT * FROM prev"),
    ];
    const compiled = buildFull(steps);
    // s2 is skipped: only two CTEs (step_01=s1, step_02=s3), s3's prev -> step_01.
    expect(compiled.ctes).toHaveLength(2);
    expect(compiled.fullSQL).toContain("SELECT * FROM step_01");
    expect(compiled.fullSQL).not.toContain("disabled_marker");
  });

  it("inlines cross-query references by name", () => {
    const other = query("q2", "other", [step("x1", "SELECT 10 AS val")]);
    const main = query("q1", "main", [
      step("s1", "SELECT 1 AS a"),
      step("s2", "SELECT * FROM prev JOIN other ON other.val = prev.a"),
    ]);
    const resolver = createQueryResolver([main, other])!;
    const compiled = buildFull(main.steps, resolver);
    expect(compiled.fullSQL).toContain("(WITH step_01 AS (");
    expect(compiled.fullSQL).toContain(") AS other");
  });

  it("terminates on a cross-query cycle (A references B, B references A)", () => {
    const a = query("qa", "a", [step("a1", "SELECT * FROM b")]);
    const b = query("qb", "b", [step("b1", "SELECT * FROM a")]);
    const resolver = createQueryResolver([a, b])!;
    // Should not throw / not infinite-loop.
    const compiled = buildFull(a.steps, resolver);
    expect(typeof compiled.fullSQL).toBe("string");
  });

  it("substitutes {{param}} tokens", () => {
    expect(substituteParams("SELECT * FROM t WHERE c = {{limit}}", { limit: 5 })).toBe(
      "SELECT * FROM t WHERE c = 5",
    );
    expect(substituteParams("WHERE n = {{name}}", { name: "o'reilly" })).toBe(
      "WHERE n = o''reilly",
    );
    expect(substituteParams("SELECT {{missing}}", { other: 1 })).toBe("SELECT ");
  });

  it("cteName is zero-padded", () => {
    expect(cteName(0)).toBe("step_01");
    expect(cteName(9)).toBe("step_10");
  });

  it("regenerates source_file steps as portable getvariable SQL when portable=true", () => {
    // A source_file step whose stored sql is the in-browser buffer form.
    const src: Step = {
      id: "s1",
      name: "src",
      stepKind: "source_file",
      enabled: true,
      order: 0,
      sql: "SELECT * FROM read_parquet('0de1.parquet')",
      config: {
        sourceVirtual: "0de1.parquet",
        sourceName: "0de1.parquet",
        ext: "parquet",
        folderPath: "simple",
        folderAlias: "simple",
        querySql: "SELECT * FROM read_parquet(getvariable('simple') || '/0de1.parquet')",
      },
    };
    const browser = buildFull([src]);
    expect(browser.fullSQL).toContain("read_parquet('0de1.parquet')");
    expect(browser.fullSQL).not.toContain("getvariable");

    const portable = buildFull([src], undefined, undefined, undefined, true);
    expect(portable.fullSQL).toContain("getvariable('simple')");
    expect(portable.fullSQL).not.toContain("'0de1.parquet'");
  });
});