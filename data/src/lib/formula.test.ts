// Formula tests removed — Excel-style formula parser has been removed in favor
// of raw SQL expressions with clickable column/function support in the UI dialog.
// The formula_column step now uses expressionSql directly.

import { describe, it, expect } from "vitest";

describe("formula (removed)", () => {
  it("formula module is a placeholder", () => {
    // The formula module was gutted when Excel-style formulas were removed.
    // All formula_column steps now use raw DuckDB SQL expressions.
    expect(true).toBe(true);
  });
});
