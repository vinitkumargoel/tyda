import { describe, it, expect } from "vitest";
import { isAvailable, OOS_PROBABILITY } from "../../src/server/sim/inventory.js";

const D1 = new Date(Date.UTC(2026, 4, 18));
const D1_LATER_SAME_DAY = new Date(Date.UTC(2026, 4, 18, 23, 59, 59));
const D2 = new Date(Date.UTC(2026, 4, 19));

function spinIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `SPIN-${i.toString().padStart(5, "0")}`);
}

describe("isAvailable", () => {
  it("is deterministic for the same spinId, date, and seed", () => {
    for (const id of spinIds(20)) {
      const a = isAvailable(id, D1);
      const b = isAvailable(id, D1);
      expect(a).toBe(b);
    }
  });

  it("is stable within the same calendar day (different times same UTC date)", () => {
    for (const id of spinIds(20)) {
      expect(isAvailable(id, D1)).toBe(isAvailable(id, D1_LATER_SAME_DAY));
    }
  });

  it("produces approximately 5% OOS across 1000 spinIds", () => {
    const ids = spinIds(1000);
    const oos = ids.filter((id) => !isAvailable(id, D1)).length;
    // Expected 50; allow a wide band so the test is not flaky.
    expect(oos).toBeGreaterThan(20);
    expect(oos).toBeLessThan(90);
  });

  it("reshuffles across different dates", () => {
    const ids = spinIds(1000);
    const setDay1 = new Set(ids.filter((id) => !isAvailable(id, D1)));
    const setDay2 = new Set(ids.filter((id) => !isAvailable(id, D2)));
    // The two OOS sets should not be identical.
    let differ = 0;
    for (const id of setDay1) if (!setDay2.has(id)) differ++;
    for (const id of setDay2) if (!setDay1.has(id)) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it("produces different sets for different seeds", () => {
    const ids = spinIds(500);
    const setA = ids.filter((id) => !isAvailable(id, D1, "seed-a"));
    const setB = ids.filter((id) => !isAvailable(id, D1, "seed-b"));
    // Highly unlikely the two sets are identical.
    expect(setA).not.toEqual(setB);
  });

  it("OOS_PROBABILITY constant is 5%", () => {
    expect(OOS_PROBABILITY).toBeCloseTo(0.05, 6);
  });
});
