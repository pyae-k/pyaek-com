import { describe, it, expect } from "vitest";
import {
  qIdent,
  qLit,
  stripSqlStringsAndComments,
  customSqlUsesPrev,
  leadingQueryStart,
  generateCustomSql,
  normalizeAppendSources,
  appendSourceBranchSql,
  generateAppendTablesSql,
  appendSourceTitle,
  appendSourceSubtitle,
  appendSourceLabel,
  JOIN_KIND_OPTIONS,
  normalizeJoinKeyPair,
  normalizeJoinConfig,
  joinFilledKeys,
  joinPredicate,
  joinRightKeyCols,
  joinRightSelectExpr,
  generateJoinTablesSql,
  joinKeepLabel,
  generateJoinPreviewStatsSql,
  normalizePivotConfig,
  TYPE_MAP,
  normalizeFilterColumnType,
  quoteFilterValue,
  buildFilterRuleSql,
  buildFilterWhereClause,
  normalizeReplaceValuesConfig,
  buildReplaceTextEquals,
  buildReplaceTextContains,
  buildReplaceMatchCondition,
} from "./helpers";
import type { JoinConfig, FilterConfig } from "./helpers";

describe("qIdent / qLit", () => {
  it("doubles embedded double-quotes in identifiers", () => {
    expect(qIdent('a"b')).toBe('"a""b"');
  });
  it("doubles embedded single-quotes in literals", () => {
    expect(qLit("it's")).toBe("'it''s'");
  });
  it("treats nullish literal values as empty string", () => {
    expect(qLit(null)).toBe("''");
    expect(qLit(undefined)).toBe("''");
  });
});

describe("stripSqlStringsAndComments", () => {
  it("removes line and block comments", () => {
    expect(stripSqlStringsAndComments("SELECT 1 -- hi\n/* block */ FROM t")).toBe(
      "SELECT 1  \n  FROM t",
    );
  });
  it("collapses string and identifier literals", () => {
    expect(stripSqlStringsAndComments(`SELECT 'a''b' AS "col"`)).toBe(
      `SELECT '' AS ""`,
    );
  });
});

describe("customSqlUsesPrev", () => {
  it("detects {{prev}} placeholder", () => {
    expect(customSqlUsesPrev("SELECT * FROM {{prev}}")).toBe(true);
  });
  it("detects bare prev alias", () => {
    expect(customSqlUsesPrev("SELECT * FROM prev")).toBe(true);
  });
  it("does not match columns ending in prev", () => {
    expect(customSqlUsesPrev("SELECT stepprev FROM t")).toBe(false);
  });
  it("ignores prev inside string literals", () => {
    expect(customSqlUsesPrev("SELECT 'prev' FROM t")).toBe(false);
  });
});

describe("leadingQueryStart", () => {
  it("skips leading whitespace", () => {
    expect(leadingQueryStart("   SELECT 1")).toBe(3);
  });
  it("skips leading line comments", () => {
    expect(leadingQueryStart("-- hello\nSELECT 1")).toBe(9);
  });
  it("skips leading block comments", () => {
    expect(leadingQueryStart("/* x */ SELECT 1")).toBe(8);
  });
});

describe("generateCustomSql", () => {
  it("injects prev CTE for plain SELECT referencing prev", () => {
    const out = generateCustomSql("SELECT * FROM prev WHERE a=1", "step_01");
    expect(out.startsWith("WITH prev AS (")).toBe(true);
    expect(out).toContain("SELECT * FROM step_01");
    expect(out).toContain("SELECT * FROM prev WHERE a=1");
  });

  it("joins prev CTE with user CTEs under one WITH (comma-joined)", () => {
    const out = generateCustomSql("WITH x AS (SELECT 1) SELECT * FROM x", "step_01");
    expect(out).toContain("WITH prev AS (");
    const prevIdx = out.indexOf("WITH prev AS (");
    const commaIdx = out.indexOf(",", prevIdx);
    const xIdx = out.indexOf("x AS", prevIdx);
    expect(commaIdx).toBeGreaterThan(prevIdx);
    expect(xIdx).toBeGreaterThan(commaIdx);
  });

  it("preserves WITH RECURSIVE keyword", () => {
    const out = generateCustomSql(
      "WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r",
      "step_01",
    );
    expect(out.startsWith("WITH RECURSIVE prev AS (")).toBe(true);
    expect(out).toContain(",\nr AS");
  });

  it("rewrites {{prev}} to prev", () => {
    const out = generateCustomSql("SELECT * FROM {{prev}}", "step_01");
    expect(out).toContain("SELECT * FROM prev");
    expect(out).not.toContain("{{prev}}");
  });

  it("preserves leading comments", () => {
    const out = generateCustomSql("-- hi\nSELECT * FROM prev", "step_01");
    expect(out.startsWith("-- hi\n")).toBe(true);
  });

  it("returns empty fallback when sql is blank", () => {
    expect(generateCustomSql("", "step_01")).toBe("SELECT * FROM step_01");
    expect(generateCustomSql("", "")).toBe("SELECT 1 WHERE FALSE");
  });
});

describe("append sources", () => {
  it("normalizeAppendSources prefers sources[] and filters invalid entries", () => {
    expect(
      normalizeAppendSources({
        sources: [
          { type: "table", schema: "main", table: "x" },
          { table: "" },
        ],
      }).length,
    ).toBe(1);
  });

  it("normalizeAppendSources falls back to legacy {schema,table}", () => {
    const out = normalizeAppendSources({ schema: "raw", table: "t" });
    expect(out).toEqual([
      { type: "table", schema: "raw", table: "t", label: "raw.t" },
    ]);
  });

  it("appendSourceBranchSql builds a table branch", () => {
    expect(
      appendSourceBranchSql({ type: "table", schema: "main", table: "x" }),
    ).toBe('SELECT * FROM main."x"');
  });

  it("generateAppendTablesSql unions branches BY NAME", () => {
    const out = generateAppendTablesSql(
      { sources: [{ type: "table", schema: "main", table: "x" }] },
      "prev",
    );
    expect(out).toContain("UNION ALL BY NAME");
    expect(out).toContain("SELECT * FROM prev");
    expect(out).toContain('main."x"');
  });

  it("generateAppendTablesSql returns prev alone when no sources", () => {
    expect(generateAppendTablesSql({}, "prev")).toBe("SELECT * FROM prev");
  });

  it("appendSourceTitle returns basename for files", () => {
    expect(appendSourceTitle({ type: "file", relPath: "a/b/c.csv" })).toBe("c.csv");
  });
  it("appendSourceSubtitle returns connectionName / Saved table", () => {
    expect(appendSourceSubtitle({ connectionName: "pg1" })).toBe("pg1");
    expect(appendSourceSubtitle({ type: "table", table: "x" })).toBe("Saved table");
  });
  it("appendSourceLabel combines title and subtitle", () => {
    expect(appendSourceLabel({ type: "table", table: "x", connectionName: "pg" })).toBe(
      "x · pg",
    );
  });
});

describe("joins", () => {
  it("JOIN_KIND_OPTIONS contains the six kinds", () => {
    expect(JOIN_KIND_OPTIONS.has("LEFT")).toBe(true);
    expect(JOIN_KIND_OPTIONS.size).toBe(6);
  });

  it("normalizeJoinKeyPair reads legacy leftKey/rightKey", () => {
    expect(normalizeJoinKeyPair({ leftKey: "a", rightKey: "b" })).toEqual({
      left: "a",
      right: "b",
    });
  });

  it("normalizeJoinConfig collapses legacy leftKey/rightKey into keys[]", () => {
    const cfg = normalizeJoinConfig({ leftKey: "a", rightKey: "b" });
    expect(cfg.keys).toContainEqual({ left: "a", right: "b" });
    expect(cfg.leftKey).toBe("a");
    expect(cfg.rightKey).toBe("b");
    expect(cfg.joinType).toBe("LEFT"); // default
  });

  it("normalizeJoinConfig reads keys[] directly", () => {
    const cfg = normalizeJoinConfig({
      joinType: "INNER",
      keys: [{ left: "id", right: "tid" }],
    });
    expect(cfg.joinType).toBe("INNER");
    expect(cfg.keys).toEqual([{ left: "id", right: "tid" }]);
  });

  it("normalizeJoinConfig collapses legacy levels[]", () => {
    const cfg = normalizeJoinConfig({
      levels: [{ keys: [{ left: "a", right: "b" }, { left: "c", right: "d" }] }],
    });
    expect(cfg.keys).toEqual([
      { left: "a", right: "b" },
      { left: "c", right: "d" },
    ]);
  });

  it("joinFilledKeys keeps only complete pairs", () => {
    expect(
      joinFilledKeys(
        normalizeJoinConfig({
          keys: [
            { left: "a", right: "b" },
            { left: "", right: "x" },
          ],
        }),
      ),
    ).toEqual([{ left: "a", right: "b" }]);
  });

  it("joinPredicate joins with AND", () => {
    expect(
      joinPredicate("a", "b", [
        { left: "id", right: "tid" },
        { left: "k", right: "kk" },
      ]),
    ).toBe('a."id" = b."tid" AND a."k" = b."kk"');
  });

  it("joinRightKeyCols dedupes", () => {
    expect(
      joinRightKeyCols([
        { left: "a", right: "x" },
        { left: "b", right: "x" },
      ]),
    ).toEqual(["x"]);
  });

  it("joinRightSelectExpr emits EXCLUDE when keys present", () => {
    expect(joinRightSelectExpr([{ left: "id", right: "tid" }])).toBe(
      'b.* EXCLUDE ("tid")',
    );
    expect(joinRightSelectExpr([])).toBe("b.*");
  });

  it("generateJoinTablesSql LEFT JOIN with EXCLUDE", () => {
    const out = generateJoinTablesSql(
      { joinType: "LEFT", schema: "main", table: "t", keys: [{ left: "id", right: "tid" }] },
      "prev",
    );
    expect(out).toContain("LEFT JOIN");
    expect(out).toContain('main."t"');
    expect(out).toContain('EXCLUDE ("tid")');
    expect(out).toContain('a."id" = b."tid"');
  });

  it("generateJoinTablesSql INNER/RIGHT/FULL/anti variants", () => {
    expect(
      generateJoinTablesSql(
        { joinType: "INNER", table: "t", keys: [{ left: "id", right: "tid" }] },
        "prev",
      ),
    ).toContain("INNER JOIN");
    expect(
      generateJoinTablesSql(
        { joinType: "FULL", table: "t", keys: [{ left: "id", right: "tid" }] },
        "prev",
      ),
    ).toContain("FULL OUTER JOIN");
    expect(
      generateJoinTablesSql(
        { joinType: "LEFT_ANTI", table: "t", keys: [{ left: "id", right: "tid" }] },
        "prev",
      ),
    ).toContain("NOT EXISTS");
    expect(
      generateJoinTablesSql(
        { joinType: "RIGHT_ANTI", table: "t", keys: [{ left: "id", right: "tid" }] },
        "prev",
      ),
    ).toContain("NOT EXISTS");
  });

  it("generateJoinTablesSql returns prev when no table or no keys", () => {
    expect(generateJoinTablesSql({ table: "" }, "prev")).toBe("SELECT * FROM prev");
    expect(
      generateJoinTablesSql({ table: "t", keys: [{ left: "", right: "" }] }, "prev"),
    ).toBe("SELECT * FROM prev");
  });

  it("joinKeepLabel returns friendly labels", () => {
    expect(joinKeepLabel("LEFT")).toBe("Keep all from left");
    expect(joinKeepLabel("INNER")).toBe("Only matching rows");
    expect(joinKeepLabel("FULL")).toBe("Keep all from both");
  });

  it("generateJoinPreviewStatsSql builds a 4-count query", () => {
    const out = generateJoinPreviewStatsSql(
      { table: "t", keys: [{ left: "id", right: "tid" }] },
      "step_01",
    );
    expect(out).toContain("left_total");
    expect(out).toContain("right_matched");
    expect(out).toContain("EXISTS");
  });
  it("generateJoinPreviewStatsSql returns null without table/leftRef", () => {
    expect(generateJoinPreviewStatsSql({ table: "" }, "prev")).toBeNull();
  });
});

describe("pivot", () => {
  it("normalizePivotConfig reads new multi-field shape", () => {
    const cfg = normalizePivotConfig({
      indexCols: ["a"],
      pivotCol: "p",
      aggregations: [{ column: "v", fn: "sum", alias: "tot" }],
    });
    expect(cfg.indexCols).toEqual(["a"]);
    expect(cfg.pivotCol).toBe("p");
    expect(cfg.useAllValues).toBe(true);
    expect(cfg.aggregations).toEqual([{ column: "v", fn: "sum", alias: "tot" }]);
  });
  it("normalizePivotConfig reads legacy single-field shape", () => {
    const cfg = normalizePivotConfig({
      indexCol: "a",
      pivotCol: "p",
      valueCol: "v",
      agg: "avg",
    });
    expect(cfg.indexCols).toEqual(["a"]);
    expect(cfg.aggregations).toEqual([{ column: "v", fn: "AVG", alias: "" }]);
  });
  it("useAllValues=false with values disables all-values", () => {
    const cfg = normalizePivotConfig({
      pivotCol: "p",
      useAllValues: false,
      pivotValues: ["x", "y"],
    });
    expect(cfg.useAllValues).toBe(false);
    expect(cfg.pivotValues).toEqual(["x", "y"]);
  });
});

describe("filter column types", () => {
  it("TYPE_MAP maps app types to DuckDB types", () => {
    expect(TYPE_MAP.text).toBe("VARCHAR");
    expect(TYPE_MAP.number).toBe("DOUBLE");
    expect(TYPE_MAP.integer).toBe("BIGINT");
    expect(TYPE_MAP.date).toBe("DATE");
    expect(TYPE_MAP.timestamp).toBe("TIMESTAMP");
    expect(TYPE_MAP.boolean).toBe("BOOLEAN");
  });

  it("normalizeFilterColumnType maps SQL type strings", () => {
    expect(normalizeFilterColumnType("VARCHAR")).toBe("text");
    expect(normalizeFilterColumnType("BIGINT")).toBe("integer");
    expect(normalizeFilterColumnType("DOUBLE")).toBe("number");
    expect(normalizeFilterColumnType("BOOLEAN")).toBe("boolean");
    expect(normalizeFilterColumnType("TIMESTAMP")).toBe("timestamp");
    expect(normalizeFilterColumnType("DATE")).toBe("date");
    expect(normalizeFilterColumnType("")).toBe("text");
  });

  it("quoteFilterValue emits numeric literals for numbers", () => {
    expect(quoteFilterValue("1.5", "number")).toBe("1.5");
    expect(quoteFilterValue("abc", "number")).toBe("NULL");
  });
  it("quoteFilterValue emits TRUE/FALSE for booleans", () => {
    expect(quoteFilterValue("true", "boolean")).toBe("TRUE");
    expect(quoteFilterValue("0", "boolean")).toBe("FALSE");
  });
  it("quoteFilterValue quotes text", () => {
    expect(quoteFilterValue("a'b", "text")).toBe("'a''b'");
  });
});

describe("buildFilterRuleSql", () => {
  it("equals text", () => {
    expect(
      buildFilterRuleSql({ column: "a", operator: "equals", value: "1", columnType: "text" }),
    ).toBe(`"a" = '1'`);
  });
  it("is_null / is_not_null", () => {
    expect(buildFilterRuleSql({ column: "a", operator: "is_null" })).toBe(`"a" IS NULL`);
    expect(buildFilterRuleSql({ column: "a", operator: "is_not_null" })).toBe(
      `"a" IS NOT NULL`,
    );
  });
  it("between", () => {
    expect(
      buildFilterRuleSql({
        column: "a",
        operator: "between",
        value: "1",
        valueTo: "10",
        columnType: "integer",
      }),
    ).toBe(`"a" BETWEEN 1 AND 10`);
  });
  it("in / not_in", () => {
    expect(
      buildFilterRuleSql({ column: "a", operator: "in", value: "x, y", columnType: "text" }),
    ).toBe(`"a" IN ('x', 'y')`);
  });
  it("returns null for unknown op", () => {
    expect(buildFilterRuleSql({ column: "a", operator: "bogus" })).toBeNull();
  });
});

describe("buildFilterWhereClause", () => {
  it("wraps single equals rule in parens", () => {
    expect(
      buildFilterWhereClause({
        rules: [{ column: "a", operator: "equals", value: "1", columnType: "text" }],
      }),
    ).toBe(`("a" = '1')`);
  });

  it("is_null wrapped", () => {
    expect(
      buildFilterWhereClause({ rules: [{ column: "a", operator: "is_null" }] }),
    ).toBe(`("a" IS NULL)`);
  });

  it("contains uses ILIKE", () => {
    const out = buildFilterWhereClause({
      rules: [{ column: "a", operator: "contains", value: "x", columnType: "text" }],
    });
    expect(out).toContain("ILIKE");
    expect(out).toContain("'x'");
  });

  it("joins multiple rules with AND by default", () => {
    const out = buildFilterWhereClause({
      rules: [
        { column: "a", operator: "equals", value: "1", columnType: "text" },
        { column: "b", operator: "is_null" },
      ],
    });
    expect(out).toBe(`("a" = '1') AND ("b" IS NULL)`);
  });

  it("honors OR logic", () => {
    const out = buildFilterWhereClause({
      logic: "OR",
      rules: [
        { column: "a", operator: "equals", value: "1", columnType: "text" },
        { column: "b", operator: "is_null" },
      ],
    });
    expect(out).toBe(`("a" = '1') OR ("b" IS NULL)`);
  });

  it("sql mode returns raw condition", () => {
    expect(buildFilterWhereClause({ mode: "sql", condition: "a > 1" })).toBe("a > 1");
  });

  it("empty rules fall back to condition or 1=1", () => {
    expect(buildFilterWhereClause({ condition: "x" })).toBe("x");
    expect(buildFilterWhereClause({})).toBe("1=1");
  });
});

describe("replace values", () => {
  it("normalizeReplaceValuesConfig migrates legacy matchMode", () => {
    const cfg = normalizeReplaceValuesConfig({ matchMode: "contains", find: "x" });
    expect(cfg.operator).toBe("contains");
    expect(cfg.replaceScope).toBe("matching_text");
    expect(cfg.caseSensitive).toBe(true); // legacy default
  });
  it("normalizeReplaceValuesConfig new defaults", () => {
    const cfg = normalizeReplaceValuesConfig({ column: "a" });
    expect(cfg.operator).toBe("equals");
    expect(cfg.replaceScope).toBe("whole_cell");
    expect(cfg.caseSensitive).toBe(false);
  });

  it("buildReplaceTextEquals case sensitive / insensitive", () => {
    expect(buildReplaceTextEquals('"a"', "x", true)).toBe(`"a" = 'x'`);
    expect(buildReplaceTextEquals('"a"', "x", false)).toBe(
      `LOWER(CAST("a" AS VARCHAR)) = LOWER('x')`,
    );
  });

  it("buildReplaceTextContains case sensitive / insensitive", () => {
    expect(buildReplaceTextContains('"a"', "x", true)).toBe(
      `CAST("a" AS VARCHAR) LIKE '%' || 'x' || '%'`,
    );
    expect(buildReplaceTextContains('"a"', "x", false)).toBe(
      `CAST("a" AS VARCHAR) ILIKE '%' || 'x' || '%'`,
    );
  });

  it("buildReplaceMatchCondition returns null without column", () => {
    expect(buildReplaceMatchCondition({})).toBeNull();
  });
  it("buildReplaceMatchCondition equals text", () => {
    expect(
      buildReplaceMatchCondition({ column: "a", find: "x", columnType: "text" }),
    ).toBe(`LOWER(CAST("a" AS VARCHAR)) = LOWER('x')`);
  });
  it("buildReplaceMatchCondition contains returns null for empty find", () => {
    expect(
      buildReplaceMatchCondition({
        column: "a",
        operator: "contains",
        find: "",
        columnType: "text",
      }),
    ).toBeNull();
  });
  it("buildReplaceMatchCondition typed equals for numbers", () => {
    expect(
      buildReplaceMatchCondition({
        column: "a",
        operator: "equals",
        find: "5",
        columnType: "integer",
      }),
    ).toBe(`"a" = 5`);
  });
  it("buildReplaceMatchCondition is_empty", () => {
    expect(
      buildReplaceMatchCondition({ column: "a", operator: "is_empty" }),
    ).toBe(`"a" IS NULL OR CAST("a" AS VARCHAR) = ''`);
  });
});

// Re-import the typed configs to keep them referenced for type-only exports.
describe("typed config interfaces (compile-time)", () => {
  it("JoinConfig accepts the documented shape", () => {
    const cfg: JoinConfig = { joinType: "LEFT", keys: [{ left: "a", right: "b" }] };
    expect(cfg.joinType).toBe("LEFT");
  });
  it("FilterConfig accepts the documented shape", () => {
    const cfg: FilterConfig = { mode: "builder", rules: [] };
    expect(cfg.mode).toBe("builder");
  });
});