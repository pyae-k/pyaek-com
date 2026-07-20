import { describe, it, expect } from "vitest";
import { getDataSteps } from "./getData";
import type { StepDef, BuildSqlContext } from "./types";

const ctx: BuildSqlContext = { prevRef: "prev", index: 1 };

function findStep(kind: string): StepDef {
  const step = getDataSteps.find((s) => s.kind === kind);
  if (!step) throw new Error(`missing step ${kind}`);
  return step;
}

function build(kind: string, config: Record<string, unknown>): string {
  return findStep(kind).buildSql(config, ctx);
}

describe("getDataSteps", () => {
  it("exposes 7 defs in the get_data category", () => {
    expect(getDataSteps).toHaveLength(7);
    for (const s of getDataSteps) {
      expect(s.category).toBe("get_data");
    }
    expect(getDataSteps.map((s) => s.kind).sort()).toEqual([
      "folder_path",
      "source_connection",
      "source_file",
      "source_folder_connection",
      "source_postgres",
      "source_sqlserver",
      "source_table",
    ]);
  });

  it("marks script-only and ui-only kinds correctly", () => {
    const byKind = new Map(getDataSteps.map((s) => [s.kind, s]));
    expect(byKind.get("source_postgres")?.scriptOnly).toBe(true);
    expect(byKind.get("source_sqlserver")?.scriptOnly).toBe(true);
    expect(byKind.get("source_connection")?.scriptOnly).toBe(true);
    expect(byKind.get("folder_path")?.scriptOnly).toBe(true);
    expect(byKind.get("source_folder_connection")?.uiOnly).toBe(true);
    expect(byKind.get("source_file")?.scriptOnly).toBeFalsy();
    expect(byKind.get("source_table")?.scriptOnly).toBeFalsy();
  });

  it("source_file builds read_csv_auto from sourceVirtual + ext", () => {
    const sql = build("source_file", { sourceVirtual: "x.csv", ext: "csv" });
    expect(sql).toContain(`read_csv_auto('x.csv')`);
  });

  it("source_file reads the registered buffer in-browser even with a folder path", () => {
    // Folder-connected file: a portable querySql and folderPath are stored, but
    // in-browser execution must read the registered virtual buffer directly.
    const sql = build("source_file", {
      sourceVirtual: "0de1.parquet",
      sourceName: "0de1.parquet",
      ext: "parquet",
      folderPath: "simple",
      folderAlias: "simple",
      querySql: "SELECT * FROM read_parquet(getvariable('simple') || '/0de1.parquet')",
    });
    expect(sql).toBe(`SELECT * FROM read_parquet('0de1.parquet')`);
    expect(sql).not.toContain("getvariable");
  });

  it("source_file emits the portable getvariable form in portable mode", () => {
    const portableCtx: BuildSqlContext = { prevRef: "", index: 0, portable: true };
    const sql = findStep("source_file").buildSql(
      {
        sourceVirtual: "0de1.parquet",
        sourceName: "0de1.parquet",
        ext: "parquet",
        folderPath: "simple",
        folderAlias: "simple",
        querySql: "SELECT * FROM read_parquet(getvariable('simple') || '/0de1.parquet')",
      },
      portableCtx,
    );
    expect(sql).toContain("getvariable('simple')");
    expect(sql).not.toContain("'0de1.parquet'");
  });

  it("source_file returns querySql when present", () => {
    expect(build("source_file", { querySql: "SELECT 1" })).toBe("SELECT 1");
  });

  it("source_file falls back to SELECT 1 WHERE FALSE without a virtual name", () => {
    expect(build("source_file", { ext: "csv" })).toBe("SELECT 1 WHERE FALSE");
  });

  it("source_table selects from schema.table", () => {
    expect(build("source_table", { schema: "main", table: "t" })).toBe(
      `SELECT * FROM main."t"`,
    );
  });

  it("source_table defaults schema to main", () => {
    expect(build("source_table", { table: "users" })).toBe(
      `SELECT * FROM main."users"`,
    );
  });

  it("folder_path emits a folder marker comment", () => {
    expect(build("folder_path", { folderPath: "/data" })).toBe(
      "-- Folder: /data",
    );
  });

  it("folder_path emits a placeholder when no path set", () => {
    expect(build("folder_path", {})).toBe("-- Set folder path");
  });

  it("source_folder_connection emits a select-source placeholder", () => {
    const sql = build("source_folder_connection", {});
    expect(sql).toContain("Select a source");
  });

  it("source_postgres emits pg.schema.table SQL", () => {
    expect(
      build("source_postgres", { schema: "public", table: "orders" }),
    ).toBe(`SELECT * FROM pg.public."orders"`);
  });

  it("source_postgres prefers querySql", () => {
    expect(
      build("source_postgres", { querySql: "SELECT 1 AS x" }),
    ).toBe("SELECT 1 AS x");
  });

  it("source_sqlserver emits schema.table SQL", () => {
    expect(
      build("source_sqlserver", { schema: "dbo", table: "orders" }),
    ).toBe(`SELECT * FROM dbo."orders"`);
  });

  it("source_sqlserver uses scanSql when it contains mssql_scan", () => {
    const scan = "SELECT * FROM mssql_scan('dsn=...')";
    expect(
      build("source_sqlserver", { scanSql: scan, schema: "dbo", table: "t" }),
    ).toBe(scan);
  });

  it("source_connection emits schema.table SQL", () => {
    expect(
      build("source_connection", { schema: "public", table: "orders" }),
    ).toBe(`SELECT * FROM public."orders"`);
  });

  it("source_connection prefers querySql", () => {
    expect(
      build("source_connection", { querySql: "SELECT 42" }),
    ).toBe("SELECT 42");
  });
});