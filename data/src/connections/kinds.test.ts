import { describe, it, expect } from "vitest";
import {
  CONNECTION_CATALOG,
  CONNECTION_BY_KIND,
  buildPostgresAttachSql,
  buildSqlServerAttachSql,
  buildSqlServerSetupSql,
  buildMysqlAttachSql,
  buildSqliteAttachSql,
  buildS3SetupSql,
  buildHttpSetupSql,
  buildGcsSetupSql,
  buildAzureSetupSql,
  buildHdfsSetupSql,
  buildIcebergSetupSql,
  buildDeltaSetupSql,
  aggregateConnectionGlobalSetup,
  joinFolderPath,
  buildFolderPathExpr,
  getFolderPathFromSteps,
  getSourceFileRelPath,
  resolveFolderPathForSource,
  buildFolderFileQuerySql,
  buildFolderSetupSql,
  getFolderConnectionAlias,
} from "./kinds";
import type { Connection, ConnectionKind } from "../types/connection";
import type { Step } from "../types/query";

function conn(id: string, kind: ConnectionKind, config: Record<string, unknown>): Connection {
  return { id, kind, displayName: id, config, createdAt: 0, updatedAt: 0 };
}

describe("CONNECTION_CATALOG", () => {
  it("has all 16 kinds (folder + 15 server)", () => {
    const kinds = CONNECTION_CATALOG.map((c) => c.kind);
    expect(kinds).toHaveLength(16);
    expect(kinds).toContain("folder");
    expect(kinds).toEqual(expect.arrayContaining([
      "postgres", "mysql", "sqlite", "sqlserver", "odbc", "odbc_dsn", "access",
      "s3", "http", "https", "gcs", "azure", "hdfs", "iceberg", "delta",
    ]));
  });

  it("indexes every kind in CONNECTION_BY_KIND", () => {
    for (const def of CONNECTION_CATALOG) {
      expect(CONNECTION_BY_KIND[def.kind]).toBe(def);
    }
  });

  it("marks postgres as scriptOnly and folder as not scriptOnly", () => {
    expect(CONNECTION_BY_KIND["postgres"].scriptOnly).toBe(true);
    expect(CONNECTION_BY_KIND["folder"].scriptOnly).toBeUndefined();
  });

  it("every server kind is scriptOnly", () => {
    for (const def of CONNECTION_CATALOG) {
      if (def.kind === "folder") continue;
      expect(def.scriptOnly, `${def.kind} should be scriptOnly`).toBe(true);
    }
  });
});

describe("server ATTACH/SETUP builders", () => {
  it("buildPostgresAttachSql emits host/db and ATTACH", () => {
    const sql = buildPostgresAttachSql({ host: "h", port: 5432, database: "db", user: "u", password: "p" });
    expect(sql).toContain("ATTACH '");
    expect(sql).toContain("host=h");
    expect(sql).toContain("dbname=db");
    expect(sql).toContain("INSTALL postgres;");
    expect(sql).toContain("LOAD postgres;");
  });

  it("buildSqlServerSetupSql + buildSqlServerAttachSql", () => {
    expect(buildSqlServerSetupSql()).toBe("INSTALL mssql;\nLOAD mssql;");
    const sql = buildSqlServerAttachSql({ server: "s", database: "d", user: "u", password: "p" });
    expect(sql).toContain("INSTALL mssql;");
    expect(sql).toContain("ATTACH '");
    expect(sql).toContain("Server=s");
    expect(sql).toContain("Database=d");
  });

  it("buildMysqlAttachSql emits MYSQL attach", () => {
    const sql = buildMysqlAttachSql({ host: "h", port: 3306, database: "db", user: "u", password: "p" });
    expect(sql).toContain("INSTALL mysql;");
    expect(sql).toContain("ATTACH '");
    expect(sql).toContain("host=h");
    expect(sql).toContain("database=db");
    expect(sql).toContain("TYPE MYSQL");
  });

  it("buildSqliteAttachSql emits ATTACH with the path", () => {
    const sql = buildSqliteAttachSql({ path: "/x.db" });
    expect(sql).toContain("INSTALL sqlite;");
    expect(sql).toContain("LOAD sqlite;");
    expect(sql).toContain("ATTACH '/x.db'");
    expect(sql).toContain("TYPE SQLITE");
  });

  it("buildS3SetupSql emits SET s3_access_key_id and region", () => {
    const sql = buildS3SetupSql({ key: "k", secret: "s", region: "r", accessKey: "k", secretKey: "s" });
    expect(sql).toContain("INSTALL httpfs;");
    expect(sql).toContain("LOAD httpfs;");
    // The original uses s3_region / s3_access_key_id / s3_secret_access_key.
    expect(sql).toContain("SET s3_region='r';");
    expect(sql).toContain("SET s3_access_key_id='k';");
    expect(sql).toContain("SET s3_secret_access_key='s';");
  });

  it("buildHttpSetupSql loads httpfs", () => {
    expect(buildHttpSetupSql()).toBe("INSTALL httpfs;\nLOAD httpfs;");
  });

  it("buildGcsSetupSql sets gcs_credentials when provided", () => {
    expect(buildGcsSetupSql({})).toBe("INSTALL httpfs;\nLOAD httpfs;");
    expect(buildGcsSetupSql({ credentials: "/svc.json" })).toContain("SET gcs_credentials='/svc.json';");
  });

  it("buildAzureSetupSql sets account + connection string", () => {
    const sql = buildAzureSetupSql({ account: "acct", sasOrKey: "sas" });
    expect(sql).toContain("INSTALL azure;");
    expect(sql).toContain("SET azure_storage_account='acct';");
    expect(sql).toContain("SET azure_storage_connection_string='sas';");
  });

  it("buildHdfsSetupSql includes namenode comment", () => {
    const sql = buildHdfsSetupSql({ host: "nn", port: "9000" });
    expect(sql).toContain("INSTALL hdfs;");
    expect(sql).toContain("-- HDFS namenode: nn:9000");
  });

  it("buildIcebergSetupSql creates the secret", () => {
    const sql = buildIcebergSetupSql({ catalog: "cat", warehouse: "wh" });
    expect(sql).toContain("INSTALL iceberg;");
    expect(sql).toContain("CREATE SECRET IF NOT EXISTS iceberg_secret");
    expect(sql).toContain("WAREHOUSE 'wh'");
    expect(sql).toContain("-- Catalog: cat");
  });

  it("buildDeltaSetupSql loads delta", () => {
    expect(buildDeltaSetupSql()).toBe("INSTALL delta;\nLOAD delta;");
  });
});

describe("folder path helpers", () => {
  it("joinFolderPath uses forward slash by default and trims edges", () => {
    expect(joinFolderPath("/data/", "f.csv")).toBe("/data/f.csv");
    expect(joinFolderPath("/data", "/f.csv")).toBe("/data/f.csv");
    expect(joinFolderPath("C:\\dir\\", "f.csv")).toBe("C:\\dir\\f.csv");
    expect(joinFolderPath("", "f.csv")).toBe("f.csv");
    expect(joinFolderPath("/data", "")).toBe("/data");
  });

  it("buildFolderPathExpr with alias uses getvariable", () => {
    const expr = buildFolderPathExpr("/data", "f.csv", "folder1");
    expect(expr).toContain("getvariable('folder1')");
    expect(expr).toContain("f.csv");
    expect(expr).toContain("/f.csv");
  });

  it("buildFolderPathExpr without alias returns a quoted literal", () => {
    const expr = buildFolderPathExpr("/data", "f.csv", "");
    expect(expr).toBe("'/data/f.csv'");
  });

  it("getFolderPathFromSteps reads folder_path then source_file", () => {
    const stepsFp: Step[] = [
      { id: "1", name: "fp", stepKind: "folder_path", config: { folderPath: "/dir" }, sql: "", enabled: true, order: 0 },
    ];
    expect(getFolderPathFromSteps(stepsFp)).toBe("/dir");

    const stepsSrc: Step[] = [
      { id: "1", name: "src", stepKind: "source_file", config: { folderPath: "/other" }, sql: "", enabled: true, order: 0 },
    ];
    expect(getFolderPathFromSteps(stepsSrc)).toBe("/other");

    expect(getFolderPathFromSteps([])).toBeNull();
  });

  it("getSourceFileRelPath reads relPath or sourceName", () => {
    const step: Step = {
      id: "1", name: "s", stepKind: "source_file", config: { relPath: "a/b.csv" }, sql: "", enabled: true, order: 0,
    };
    expect(getSourceFileRelPath(step)).toBe("a/b.csv");
    const step2: Step = {
      id: "2", name: "s", stepKind: "source_file", config: { sourceName: "x.parquet" }, sql: "", enabled: true, order: 0,
    };
    expect(getSourceFileRelPath(step2)).toBe("x.parquet");
    expect(getSourceFileRelPath(null)).toBeNull();
  });

  it("resolveFolderPathForSource prefers connection path when linked", () => {
    const steps: Step[] = [];
    const src: Step = {
      id: "1", name: "s", stepKind: "source_file", config: { connectionId: "c1" }, sql: "", enabled: true, order: 0,
    };
    expect(resolveFolderPathForSource(steps, { folderPath: "/conn" }, src)).toBe("/conn");
    // No connection id → fall back to connConfig folderPath.
    const srcNoConn: Step = {
      id: "2", name: "s", stepKind: "source_file", config: {}, sql: "", enabled: true, order: 0,
    };
    expect(resolveFolderPathForSource(steps, { folderPath: "/fallback" }, srcNoConn)).toBe("/fallback");
  });

  it("buildFolderFileQuerySql builds a folder-alias path expression reader", () => {
    const sql = buildFolderFileQuerySql("/data", "f.csv", "csv", { folderAlias: "folder1" });
    expect(sql).toContain("read_csv_auto(getvariable('folder1')");
    expect(sql).toContain("/f.csv");
  });

  it("buildFolderFileQuerySql without alias uses a quoted literal", () => {
    const sql = buildFolderFileQuerySql("/data", "f.csv", "csv", {});
    expect(sql).toBe("SELECT * FROM read_csv_auto('/data/f.csv')");
  });

  it("buildFolderFileQuerySql returns sqlText for .sql files", () => {
    expect(buildFolderFileQuerySql("/data", "s.sql", "sql", { sqlText: "SELECT 1" })).toBe("SELECT 1");
    expect(buildFolderFileQuerySql("/data", "s.sql", "sql", {})).toBe("-- Empty SQL script");
  });

  it("buildFolderSetupSql emits SET VARIABLE for a configured folder", () => {
    const sql = buildFolderSetupSql({ folderPath: "/data", folderAlias: "folder1" });
    expect(sql).toContain("SET VARIABLE folder1 = '/data';");
  });

  it("getFolderConnectionAlias falls back to folder1", () => {
    expect(getFolderConnectionAlias({})).toBe("folder1");
    expect(getFolderConnectionAlias({ folderName: "Sales Data!" })).toBe("Sales_Data");
    expect(getFolderConnectionAlias({ folderAlias: "my_alias" })).toBe("my_alias");
  });
});

describe("aggregateConnectionGlobalSetup", () => {
  it("emits SET VARIABLE for a folder connection", () => {
    const { setupSql, attachSqlByConnectionId } = aggregateConnectionGlobalSetup([
      conn("c1", "folder", { folderPath: "/data", folderAlias: "folder1" }),
    ]);
    expect(setupSql).toContain("SET VARIABLE folder1");
    expect(setupSql).toContain("= '/data';");
    // Folder connections have no per-connection attach SQL.
    expect(attachSqlByConnectionId["c1"]).toBe("");
  });

  it("returns the attach SQL per postgres connection id", () => {
    const { setupSql, attachSqlByConnectionId } = aggregateConnectionGlobalSetup([
      conn("c1", "postgres", { host: "h", port: 5432, database: "db", user: "u", password: "p" }),
    ]);
    expect(setupSql).toContain("INSTALL postgres;");
    expect(setupSql).toContain("LOAD postgres;");
    // INSTALL/LOAD are global; the per-connection attach is the ATTACH line only.
    expect(attachSqlByConnectionId["c1"]).toContain("ATTACH '");
    expect(attachSqlByConnectionId["c1"]).toContain("host=h");
    expect(attachSqlByConnectionId["c1"]).toContain("dbname=db");
    expect(attachSqlByConnectionId["c1"]).not.toContain("INSTALL postgres;");
  });

  it("dedups httpfs load across two s3 connections (appears once)", () => {
    const { setupSql } = aggregateConnectionGlobalSetup([
      conn("c1", "s3", { region: "us-east-1", accessKey: "k1", secretKey: "s1" }),
      conn("c2", "s3", { region: "us-west-2", accessKey: "k2", secretKey: "s2" }),
    ]);
    const loadCount = (setupSql.match(/LOAD httpfs;/g) ?? []).length;
    expect(loadCount).toBe(1);
    const installCount = (setupSql.match(/INSTALL httpfs;/g) ?? []).length;
    expect(installCount).toBe(1);
    // Per-connection credentials stay separate.
    // (SET lines live in attachSqlByConnectionId, not in setupSql.)
    expect(setupSql).not.toContain("s3_access_key_id");
  });

  it("dedups odbc extension load across multiple odbc connections", () => {
    const { setupSql } = aggregateConnectionGlobalSetup([
      conn("c1", "odbc", { connectionString: "Driver={X};", macroName: "src1" }),
      conn("c2", "odbc", { connectionString: "Driver={Y};", macroName: "src2" }),
    ]);
    expect((setupSql.match(/LOAD odbc;/g) ?? []).length).toBe(1);
    // Both macros are emitted (deduped by key, but keys differ).
    expect(setupSql).toContain("CREATE OR REPLACE MACRO src1");
    expect(setupSql).toContain("CREATE OR REPLACE MACRO src2");
  });

  it("returns empty setup for no connections", () => {
    const { setupSql, attachSqlByConnectionId } = aggregateConnectionGlobalSetup([]);
    expect(setupSql).toBe("");
    expect(attachSqlByConnectionId).toEqual({});
  });
});