import { describe, it, expect } from "vitest";
import { computeProfiles } from "./profiling";
import type { ArrowResult } from "../types/engine";

const data: ArrowResult = {
  columns: [
    { name: "id", type: "INTEGER" },
    { name: "name", type: "VARCHAR" },
    { name: "amount", type: "DOUBLE" },
  ],
  rows: [
    [1, "a", 10],
    [2, "b", 20],
    [3, null, 30],
    [1, "a", 10],
  ],
  rowCount: 4,
};

describe("computeProfiles", () => {
  const profiles = computeProfiles(data);

  it("counts nulls per column", () => {
    expect(profiles.find((p) => p.name === "name")!.nullCount).toBe(1);
    expect(profiles.find((p) => p.name === "id")!.nullCount).toBe(0);
  });

  it("counts distinct values", () => {
    expect(profiles.find((p) => p.name === "id")!.distinctCount).toBe(3);
    expect(profiles.find((p) => p.name === "name")!.distinctCount).toBe(2);
  });

  it("computes min/max for numeric columns", () => {
    const amt = profiles.find((p) => p.name === "amount")!;
    expect(amt.min).toBe(10);
    expect(amt.max).toBe(30);
  });

  it("computes mean/median for numeric columns", () => {
    const amt = profiles.find((p) => p.name === "amount")!;
    expect(amt.mean).toBeCloseTo(17.5, 5);
    expect(amt.median).toBe(15);
  });

  it("omits mean/median for non-numeric columns", () => {
    const name = profiles.find((p) => p.name === "name")!;
    expect(name.mean).toBeUndefined();
    expect(name.median).toBeUndefined();
  });
});