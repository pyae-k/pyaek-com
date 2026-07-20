import { describe, it, expect } from "vitest";
import {
  getExt,
  sanitizeVirtualName,
  minBytesForExt,
  buildFileReaderSql,
  buildFileSourceMeta,
  isSupportedFileExt,
} from "./fileReaders";

describe("fileReaders", () => {
  it("extracts lowercased extension", () => {
    expect(getExt("foo.CSV")).toBe("csv");
    expect(getExt("a/b/c.parquet")).toBe("parquet");
    expect(getExt("noext")).toBe("");
  });

  it("sanitizes virtual names", () => {
    expect(sanitizeVirtualName("my file (1).csv")).toBe("my_file__1_.csv");
    expect(sanitizeVirtualName("data-2024.parquet")).toBe("data-2024.parquet");
  });

  it("min bytes per ext", () => {
    expect(minBytesForExt("parquet")).toBe(8);
    expect(minBytesForExt("csv")).toBe(1);
    expect(minBytesForExt("sqlite")).toBe(16);
    expect(minBytesForExt("unknown")).toBe(1);
  });

  it("builds reader SQL per format", () => {
    expect(buildFileReaderSql("x.csv", "csv")).toBe("SELECT * FROM read_csv_auto('x.csv')");
    expect(buildFileReaderSql("x.parquet", "parquet")).toBe("SELECT * FROM read_parquet('x.parquet')");
    expect(buildFileReaderSql("x.tsv", "tsv")).toBe("SELECT * FROM read_csv_auto('x.tsv', delim='\\t', header=true)");
    expect(buildFileReaderSql("x.xlsx", "xlsx")).toBe("SELECT * FROM read_json_auto('x.xlsx.json')");
    expect(buildFileReaderSql("x.xlsx", "xlsx", "custom.json")).toBe("SELECT * FROM read_json_auto('custom.json')");
  });

  it("throws on unsupported ext", () => {
    expect(() => buildFileReaderSql("x.foo", "foo")).toThrow(/Unsupported file type/);
  });

  it("builds file source meta", () => {
    const meta = buildFileSourceMeta("Sales Data.xlsx");
    expect(meta.ext).toBe("xlsx");
    expect(meta.sourceVirtual).toBe("Sales_Data.xlsx");
    expect(meta.jsonVirtualName).toBe("Sales_Data.xlsx.json");
    expect(meta.sql).toBe("SELECT * FROM read_json_auto('Sales_Data.xlsx.json')");
  });

  it("isSupportedFileExt", () => {
    expect(isSupportedFileExt("csv")).toBe(true);
    expect(isSupportedFileExt("XLSX")).toBe(true);
    expect(isSupportedFileExt("foo")).toBe(false);
  });
});