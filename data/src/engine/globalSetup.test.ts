import { describe, it, expect } from "vitest";
import {
  buildGlobalSetup,
  aggregateConnectionGlobalSetup,
  buildFolderPathExpr,
} from "./globalSetup";
import type { Connection, ConnectionKind } from "../types/connection";

function conn(id: string, kind: ConnectionKind, config: Record<string, unknown>): Connection {
  return { id, kind, displayName: id, config, createdAt: 0, updatedAt: 0 };
}

describe("engine/globalSetup", () => {
  it("buildGlobalSetup is an alias over aggregateConnectionGlobalSetup", () => {
    const conns = [conn("c1", "postgres", { host: "h", database: "db", user: "u", password: "p" })];
    expect(buildGlobalSetup(conns)).toEqual(aggregateConnectionGlobalSetup(conns));
  });

  it("buildGlobalSetup emits SET VARIABLE for a folder connection", () => {
    const { setupSql } = buildGlobalSetup([conn("c1", "folder", { folderPath: "/data", folderAlias: "folder1" })]);
    expect(setupSql).toContain("SET VARIABLE folder1");
  });

  it("buildGlobalSetup returns per-connection attach SQL for postgres", () => {
    const { attachSqlByConnectionId } = buildGlobalSetup([
      conn("c1", "postgres", { host: "h", database: "db", user: "u", password: "p" }),
    ]);
    expect(attachSqlByConnectionId["c1"]).toContain("ATTACH '");
    expect(attachSqlByConnectionId["c1"]).toContain("host=h");
  });

  it("re-exports buildFolderPathExpr", () => {
    const expr = buildFolderPathExpr("/data", "f.csv", "folder1");
    expect(expr).toContain("getvariable('folder1')");
    expect(expr).toContain("f.csv");
  });

  it("dedups httpfs load across two s3 connections", () => {
    const { setupSql } = buildGlobalSetup([
      conn("c1", "s3", { region: "us-east-1", accessKey: "k1", secretKey: "s1" }),
      conn("c2", "s3", { region: "us-west-2", accessKey: "k2", secretKey: "s2" }),
    ]);
    expect((setupSql.match(/LOAD httpfs;/g) ?? []).length).toBe(1);
  });
});