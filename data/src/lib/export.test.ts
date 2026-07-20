import { describe, it, expect } from "vitest";
import {
  buildExportFileName,
  sanitizeSqlFileName,
  uniqueSqlFileNames,
  buildQuerySqlFile,
  type ExportFormat,
} from "./export";
import type { Query } from "../types/query";

function mkQuery(id: string, name: string, sql: string): Query {
  return {
    id,
    name,
    folderId: null,
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    steps: [
      {
        id: `${id}-s1`,
        name: "custom",
        stepKind: "custom_sql",
        config: {},
        sql,
        enabled: true,
        order: 0,
      },
    ],
  };
}

describe("export pure helpers", () => {
  it("buildExportFileName sanitizes base, appends extension, no date by default", () => {
    expect(buildExportFileName("Sales Q1", "csv")).toBe("Sales_Q1.csv");
    expect(buildExportFileName("a/b", ".parquet")).toBe("a_b.parquet");
  });

  it("buildExportFileName stamps date at start/end", () => {
    expect(buildExportFileName("out", "csv", { datePosition: "start", date: "20260101" })).toBe("20260101_out.csv");
    expect(buildExportFileName("out", "csv", { datePosition: "end", date: "20260101" })).toBe("out_20260101.csv");
  });

  it("sanitizeSqlFileName strips unsafe chars and trims underscores", () => {
    expect(sanitizeSqlFileName("Sales/Q1:2026")).toBe("Sales_Q1_2026");
    expect(sanitizeSqlFileName("  spaced name ")).toBe("spaced_name");
    expect(sanitizeSqlFileName("")).toBe("query");
  });

  it("uniqueSqlFileNames suffixes collisions", () => {
    expect(uniqueSqlFileNames(["a", "b", "a", "a", "b"])).toEqual(["a", "b", "a_2", "a_3", "b_2"]);
  });

  it("buildQuerySqlFile prepends setupSql and ends with a semicolon", () => {
    const q = mkQuery("q1", "Top sales", "SELECT * FROM prev");
    const text = buildQuerySqlFile(q, [q], "INSTALL httpfs;\nLOAD httpfs;");
    expect(text).toContain("Global setup");
    expect(text).toContain("INSTALL httpfs;");
    expect(text).toContain("-- Query: Top sales");
    expect(text).toContain("SELECT * FROM prev");
    expect(text.trim().endsWith(";")).toBe(true);
  });

  it("buildQuerySqlFile omits the setup block when setupSql is empty", () => {
    const q = mkQuery("q1", "X", "SELECT 1");
    const text = buildQuerySqlFile(q, [q], "");
    expect(text).not.toContain("Global setup");
    expect(text).toContain("-- Query: X");
  });

  it("ExportFormat includes xlsx and jsonl", () => {
    const fmts: ExportFormat[] = ["csv", "parquet", "xlsx", "json", "jsonl"];
    expect(fmts).toHaveLength(5);
  });
});