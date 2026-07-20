// Pure column-profiling over a preview result set. Computes null count,
// distinct count, and (where meaningful) min/max/mean/median over the rows
// actually fetched (a sample, not the full table). Used by useAutoPreview to
// populate previewStore.profiles → ProfilePanel.

import type { ArrowResult, ColumnProfile } from "../types/engine";

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function lessThan(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (typeof a === "string" && typeof b === "string") return a < b;
  return false;
}

function median(sorted: number[]): number | undefined {
  if (!sorted.length) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeProfiles(data: ArrowResult): ColumnProfile[] {
  return data.columns.map((col, ci) => {
    let nullCount = 0;
    const seen = new Set<unknown>();
    const nums: number[] = [];
    let min: unknown;
    let max: unknown;

    for (const row of data.rows) {
      const v = row[ci];
      if (v === null || v === undefined) {
        nullCount++;
        continue;
      }
      seen.add(v);
      if (isNumeric(v)) nums.push(v);
      if (min === undefined || lessThan(v, min)) min = v;
      if (max === undefined || lessThan(max, v)) max = v;
    }

    const profile: ColumnProfile = {
      name: col.name,
      type: col.type,
      nullCount,
      distinctCount: seen.size,
    };
    if (min !== undefined) profile.min = min;
    if (max !== undefined) profile.max = max;
    if (nums.length) {
      profile.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      profile.median = median([...nums].sort((a, b) => a - b));
    }
    return profile;
  });
}