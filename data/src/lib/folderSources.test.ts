import { describe, it, expect } from "vitest";
import { buildFolderFileManifestEntries, sourceRelPath } from "./folderSources";
import type { FolderFile } from "./fileAccess";

function makeFolderFile(overrides: Partial<FolderFile> & Pick<FolderFile, "relPath" | "ext">): FolderFile {
  const { relPath, ext, ...rest } = overrides;
  const name = relPath?.split("/").pop() ?? "file";
  return {
    name,
    relPath,
    ext,
    handle: {} as FileSystemFileHandle,
    ...rest,
  };
}

describe("buildFolderFileManifestEntries", () => {
  it("maps flat files to virtual names based on relative path", () => {
    const entries = buildFolderFileManifestEntries([
      makeFolderFile({ relPath: "sales.csv", ext: "csv" }),
      makeFolderFile({ relPath: "orders.parquet", ext: "parquet" }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      relPath: "sales.csv",
      name: "sales.csv",
      ext: "csv",
      virtualName: "sales.csv",
      jsonVirtualName: null,
    });
    expect(entries[1]).toMatchObject({
      relPath: "orders.parquet",
      name: "orders.parquet",
      ext: "parquet",
      virtualName: "orders.parquet",
      jsonVirtualName: null,
    });
  });

  it("escapes sub-folder separators in virtual names", () => {
    const entries = buildFolderFileManifestEntries([
      makeFolderFile({ relPath: "2024/jan/data.csv", ext: "csv" }),
    ]);
    expect(entries[0].virtualName).toBe("2024_jan_data.csv");
  });

  it("creates a JSON virtual name for xlsx and xls", () => {
    const entries = buildFolderFileManifestEntries([
      makeFolderFile({ relPath: "report.xlsx", ext: "xlsx" }),
      makeFolderFile({ relPath: "old.xls", ext: "xls" }),
    ]);
    expect(entries[0].jsonVirtualName).toBe("report.xlsx.json");
    expect(entries[1].jsonVirtualName).toBe("old.xls.json");
  });

  it("keeps json/jsonl without a JSON virtual name", () => {
    const entries = buildFolderFileManifestEntries([
      makeFolderFile({ relPath: "data.json", ext: "json" }),
    ]);
    expect(entries[0].jsonVirtualName).toBeNull();
  });
});

describe("sourceRelPath", () => {
  it("prefers relPath over sourceName", () => {
    expect(sourceRelPath({ relPath: "a/b.csv", sourceName: "b.csv" })).toBe("a/b.csv");
  });

  it("falls back to sourceName", () => {
    expect(sourceRelPath({ sourceName: "b.csv" })).toBe("b.csv");
  });

  it("returns null when neither is set", () => {
    expect(sourceRelPath({})).toBeNull();
  });
});
