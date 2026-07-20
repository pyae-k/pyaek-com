import { describe, it, expect } from "vitest";
import {
  detectDateFormat,
  buildDateTypeReplacementSql,
  buildDateParseSql,
  formatDateForDisplay,
  DATE_DISPLAY_STRFTIME,
  enrichChangeTypeDateFormats,
} from "./dateType";

describe("detectDateFormat", () => {
  it("detects ISO yyyy-mm-dd from a common sample", () => {
    expect(detectDateFormat(["2024-03-15", "2024-01-02"])).toBe("%Y-%m-%d");
  });

  it("detects mm/dd/yyyy from a slash-separated US sample", () => {
    // 15 > 12 disambiguates to month-day-year ordering.
    expect(detectDateFormat(["03/15/2024", "12/31/2024"])).toBe("%m/%d/%Y");
  });

  it("detects dd/mm/yyyy when the first segment exceeds 12", () => {
    expect(detectDateFormat(["15/03/2024", "31/12/2024"])).toBe("%d/%m/%Y");
  });

  it("detects compact yyyymmdd", () => {
    expect(detectDateFormat(["20240315", "20241231"])).toBe("%Y%m%d");
  });

  it("returns null for an empty / all-empty sample list", () => {
    expect(detectDateFormat([])).toBeNull();
    expect(detectDateFormat(["", "  ", null])).toBeNull();
  });
});

describe("buildDateTypeReplacementSql", () => {
  it("produces SQL containing strptime and TRY_CAST ... AS DATE", () => {
    const sql = buildDateTypeReplacementSql('"order_date"', "%Y-%m-%d");
    expect(sql).toContain("strptime");
    expect(sql).toContain("TRY_CAST(\"order_date\" AS DATE)");
    // The replacement wraps the parsed expression in a CASE/strftime.
    expect(sql).toContain("strftime");
    expect(sql).toContain(DATE_DISPLAY_STRFTIME);
  });

  it("includes the detected primary format at the front of the format list", () => {
    const sql = buildDateParseSql('"d"', "%m/%d/%Y");
    // The first format entry should be the primary one.
    expect(sql).toContain("'%m/%d/%Y'");
    expect(sql).toContain("try_strptime");
  });

  it("falls back to the full format list when no primary is given", () => {
    const sql = buildDateTypeReplacementSql('"d"');
    expect(sql).toContain("'%Y-%m-%d'");
    expect(sql).toContain("'%d%m%Y'");
  });
});

describe("formatDateForDisplay", () => {
  it("formats a JS Date as dd-mmm-yyyy using UTC", () => {
    const d = new Date(Date.UTC(2024, 2, 15)); // 15 Mar 2024
    expect(formatDateForDisplay(d)).toBe("15-Mar-2024");
  });

  it("returns null for null and undefined", () => {
    expect(formatDateForDisplay(null)).toBeNull();
    expect(formatDateForDisplay(undefined)).toBeNull();
  });

  it("parses an ISO yyyy-mm-dd string", () => {
    expect(formatDateForDisplay("2024-03-15")).toBe("15-Mar-2024");
  });

  it("returns the trimmed text unchanged when it is not a recognizable date", () => {
    expect(formatDateForDisplay("not a date")).toBe("not a date");
  });
});

describe("enrichChangeTypeDateFormats", () => {
  it("detects formats for date columns and leaves non-date configs untouched", () => {
    const config = {
      types: { order_date: "date", name: "varchar" },
    };
    const rows = [
      { order_date: "2024-03-15", name: "a" },
      { order_date: "2024-01-02", name: "b" },
    ];
    const next = enrichChangeTypeDateFormats(config, rows);
    expect(next.dateFormats).toEqual({ order_date: "%Y-%m-%d" });
    // Non-date columns are not present in dateFormats.
    expect((next.dateFormats as Record<string, string>).name).toBeUndefined();
  });

  it("removes dateFormats when there are no date columns", () => {
    const config = {
      types: { name: "varchar" },
      dateFormats: { leftover: "%Y-%m-%d" },
    };
    const next = enrichChangeTypeDateFormats(config, []);
    expect(next.dateFormats).toBeUndefined();
  });
});