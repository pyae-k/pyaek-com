/**
 * Date-format detection and DuckDB strptime/strftime SQL helpers.
 *
 * Pure module: no DOM, no DuckDB dependency. Ported from the vanilla-JS
 * project at pwa_duckdb/js/date-type.js. The DuckDB SQL output (TRY_CAST,
 * try_strptime, strftime patterns) is preserved exactly.
 */

/** Display format for parsed dates in preview and export. */
export const DATE_DISPLAY_STRFTIME = "%d-%b-%Y";

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const FALLBACK_PARSE_FORMATS = [
  "%Y-%m-%d",
  "%d%m%Y",
  "%m%d%Y",
  "%Y%m%d",
  "%d-%m-%Y",
  "%m-%d-%Y",
  "%d/%m/%Y",
  "%m/%d/%Y",
  "%d.%m.%Y",
  "%m.%d.%Y",
  "%d-%b-%Y",
  "%d %b %Y",
  "%d-%B-%Y",
  "%d %B %Y",
];

type Order = "dmY" | "mdY";

interface ScoredFormat {
  format: string;
  score: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidDateParts(day: number, month: number, year: number): boolean {
  return (
    year >= 1000 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

function normalizeSample(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function disambiguateCompactOrder(samples: readonly string[]): string {
  let dmSignals = 0;
  let mdSignals = 0;
  for (const raw of samples) {
    const s = normalizeSample(raw);
    if (!/^\d{8}$/.test(s)) continue;
    const first = parseInt(s.slice(0, 2), 10);
    const second = parseInt(s.slice(2, 4), 10);
    if (first > 12) dmSignals += 1;
    if (second > 12) mdSignals += 1;
  }
  if (dmSignals > mdSignals) return "%d%m%Y";
  if (mdSignals > dmSignals) return "%m%d%Y";
  return "%d%m%Y";
}

function disambiguateSeparatedOrder(samples: readonly string[]): Order {
  let dmSignals = 0;
  let mdSignals = 0;
  for (const raw of samples) {
    const s = normalizeSample(raw);
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) continue;
    const first = parseInt(m[1], 10);
    const second = parseInt(m[2], 10);
    if (first > 12) dmSignals += 1;
    if (second > 12) mdSignals += 1;
  }
  if (dmSignals > mdSignals) return "dmY";
  if (mdSignals > dmSignals) return "mdY";
  return "dmY";
}

function scoreCompactFormat(
  samples: readonly string[],
  order: Order,
): number {
  let score = 0;
  for (const raw of samples) {
    const s = normalizeSample(raw);
    if (!/^\d{8}$/.test(s)) continue;
    const day =
      order === "dmY"
        ? parseInt(s.slice(0, 2), 10)
        : parseInt(s.slice(2, 4), 10);
    const month =
      order === "dmY"
        ? parseInt(s.slice(2, 4), 10)
        : parseInt(s.slice(0, 2), 10);
    const year = parseInt(s.slice(4, 8), 10);
    if (isValidDateParts(day, month, year)) score += 1;
  }
  return score;
}

function scorePattern(
  samples: readonly string[],
  regex: RegExp,
  parseFn: (s: string) => boolean,
): number {
  let score = 0;
  for (const raw of samples) {
    const s = normalizeSample(raw);
    if (!regex.test(s)) continue;
    if (parseFn(s)) score += 1;
  }
  return score;
}

function detectSeparator(samples: readonly string[]): string {
  for (const raw of samples) {
    const s = normalizeSample(raw);
    if (s.includes("/")) return "/";
    if (s.includes("-")) return "-";
    if (s.includes(".")) return ".";
  }
  return "-";
}

/**
 * Inspect sample values and pick the most likely DuckDB strptime format
 * for the column. Returns `null` when no candidate matches any sample.
 */
export function detectDateFormat(
  samples: readonly unknown[],
): string | null {
  const values = (samples || [])
    .map(normalizeSample)
    .filter(Boolean)
    .slice(0, 500);
  if (!values.length) return null;

  const compactOrder = disambiguateCompactOrder(values);
  const separatedOrder = disambiguateSeparatedOrder(values);
  const sep = detectSeparator(values);
  const dmSepFormat =
    sep === "/" ? "%d/%m/%Y" : sep === "." ? "%d.%m.%Y" : "%d-%m-%Y";
  const mdSepFormat =
    sep === "/" ? "%m/%d/%Y" : sep === "." ? "%m.%d.%Y" : "%m-%d-%Y";

  const candidates: ScoredFormat[] = [
    {
      format: "%Y-%m-%d",
      score: scorePattern(values, /^\d{4}-\d{1,2}-\d{1,2}$/, (s) => {
        const [y, m, d] = s.split("-").map(Number);
        return isValidDateParts(d, m, y);
      }),
    },
    {
      format: compactOrder,
      score: scoreCompactFormat(
        values,
        compactOrder === "%d%m%Y" ? "dmY" : "mdY",
      ),
    },
    {
      format: compactOrder === "%d%m%Y" ? "%m%d%Y" : "%d%m%Y",
      score: scoreCompactFormat(
        values,
        compactOrder === "%d%m%Y" ? "mdY" : "dmY",
      ),
    },
    {
      format: "%Y%m%d",
      score: scorePattern(values, /^\d{8}$/, (s) => {
        const y = parseInt(s.slice(0, 4), 10);
        const m = parseInt(s.slice(4, 6), 10);
        const d = parseInt(s.slice(6, 8), 10);
        return isValidDateParts(d, m, y);
      }),
    },
    {
      format: separatedOrder === "dmY" ? dmSepFormat : mdSepFormat,
      score: scorePattern(
        values,
        /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/,
        (s) => {
          const parts = s.split(/[-/.]/).map(Number);
          const [a, b, y] = parts;
          return separatedOrder === "dmY"
            ? isValidDateParts(a, b, y)
            : isValidDateParts(b, a, y);
        },
      ),
    },
    {
      format: separatedOrder === "dmY" ? mdSepFormat : dmSepFormat,
      score: scorePattern(
        values,
        /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/,
        (s) => {
          const parts = s.split(/[-/.]/).map(Number);
          const [a, b, y] = parts;
          return separatedOrder === "dmY"
            ? isValidDateParts(b, a, y)
            : isValidDateParts(a, b, y);
        },
      ),
    },
    {
      format: "%d-%b-%Y",
      score: scorePattern(values, /^\d{1,2}-[A-Za-z]{3}-\d{4}$/i, () => true),
    },
    {
      format: "%d %b %Y",
      score: scorePattern(values, /^\d{1,2} [A-Za-z]{3} \d{4}$/i, () => true),
    },
  ];

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score && candidates[0].score > 0
    ? candidates[0].format
    : null;
}

function buildFormatList(primaryFormat: string | null): string[] {
  if (!primaryFormat) return [...FALLBACK_PARSE_FORMATS];
  return [
    primaryFormat,
    ...FALLBACK_PARSE_FORMATS.filter((f) => f !== primaryFormat),
  ];
}

/**
 * DuckDB expression that parses mixed date strings into a DATE value.
 */
export function buildDateParseSql(
  colIdent: string,
  primaryFormat: string | null = null,
): string {
  const varchar = `TRIM(CAST(${colIdent} AS VARCHAR))`;
  const formats = buildFormatList(primaryFormat);
  const formatList = `[${formats.map((f) => `'${f}'`).join(", ")}]`;
  return `COALESCE(
    CAST(try_strptime(${varchar}, ${formatList}) AS DATE),
    TRY_CAST(${colIdent} AS DATE),
    CAST(TRY_CAST(${colIdent} AS TIMESTAMP) AS DATE)
  )`;
}

/**
 * DuckDB expression that parses dates and formats them as dd-mmm-yyyy text.
 */
export function buildDateTypeReplacementSql(
  colIdent: string,
  primaryFormat: string | null = null,
): string {
  const parsed = buildDateParseSql(colIdent, primaryFormat);
  return `CASE WHEN ${parsed} IS NOT NULL THEN strftime(${parsed}, '${DATE_DISPLAY_STRFTIME}') ELSE CAST(${colIdent} AS VARCHAR) END`;
}

/** Format JS Date values for preview when DuckDB returns native dates. */
export function formatDateForDisplay(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getUTCDate())}-${MONTH_ABBR[value.getUTCMonth()]}-${value.getUTCFullYear()}`;
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    if (isValidDateParts(d, m, y)) {
      return `${pad2(d)}-${MONTH_ABBR[m - 1]}-${y}`;
    }
  }
  return text;
}

/**
 * Add detected input formats for date columns in a change_type step config.
 */
export function enrichChangeTypeDateFormats(
  config: Record<string, unknown>,
  rows: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  const types = (config.types as Record<string, string> | undefined) || {};
  const dateCols = Object.entries(types)
    .filter(([, type]) => type === "date")
    .map(([col]) => col);
  if (!dateCols.length) {
    const next = { ...config };
    delete next.dateFormats;
    return next;
  }

  const dateFormats = {
    ...((config.dateFormats as Record<string, string> | undefined) || {}),
  };
  for (const col of dateCols) {
    const samples = (rows || [])
      .map((row) => row[col])
      .filter((v) => v != null && v !== "");
    const detected = detectDateFormat(samples);
    if (detected) dateFormats[col] = detected;
  }

  return { ...config, dateFormats };
}