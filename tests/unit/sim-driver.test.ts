import { describe, it, expect } from "vitest";
import { spawnDriver, tickDriver, DRIVER_NAMES } from "../../src/server/sim/driver.js";
import { haversineKm, type LatLng } from "../../src/server/sim/eta.js";

const DESTINATION: LatLng = { lat: 12.9716, lng: 77.5946 };

/** Deterministic RNG returning a fixed sequence then cycling. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    return v;
  };
}

describe("spawnDriver", () => {
  it("spawns between 1.5 and 3.0 km from destination", () => {
    const rng = seqRng([0.1, 0.25, 0.5, 0.75, 0.9, 0.4, 0.6]);
    for (let i = 0; i < 20; i++) {
      const d = spawnDriver(DESTINATION, { rng });
      expect(d.distanceKm).toBeGreaterThanOrEqual(1.4);
      expect(d.distanceKm).toBeLessThanOrEqual(3.1);
    }
  });

  it("is deterministic given a seeded RNG", () => {
    const a = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    const b = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    expect(a).toEqual(b);
  });

  it("picks a name from the fixed driver list", () => {
    // First rng() draw is used for name selection.
    const rng = seqRng([0.0, 0.5, 0.5]);
    const d = spawnDriver(DESTINATION, { rng });
    expect(DRIVER_NAMES).toContain(d.name);
    expect(d.name).toBe("Ramesh K");
  });

  it("indexes correctly across the entire name list", () => {
    for (let i = 0; i < DRIVER_NAMES.length; i++) {
      // Pick rng start so floor(rng * 6) lands on i.
      const start = (i + 0.5) / DRIVER_NAMES.length;
      const rng = seqRng([start, 0.5, 0.5]);
      const d = spawnDriver(DESTINATION, { rng });
      expect(d.name).toBe(DRIVER_NAMES[i]);
    }
  });

  it("honours name override", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]), name: "Custom" });
    expect(d.name).toBe("Custom");
  });

  it("eta = distance / speed * 60", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    const expected = (d.distanceKm / d.speedKmh) * 60;
    expect(d.eta).toBeCloseTo(expected, 6);
  });
});

describe("tickDriver", () => {
  it("returns same state for non-positive elapsed", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    expect(tickDriver(d, 0)).toBe(d);
    expect(tickDriver(d, -100)).toBe(d);
  });

  it("decreases distanceKm by speed * elapsed", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    const elapsedMs = 60_000; // 1 minute
    const traveled = d.speedKmh * (elapsedMs / 3.6e6);
    const next = tickDriver(d, elapsedMs);
    expect(next.distanceKm).toBeCloseTo(d.distanceKm - traveled, 6);
  });

  it("clamps distance at 0 and snaps to destination", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.1, 0.2, 0.3]) });
    const huge = 60 * 60_000; // 60 minutes — way over 3 km at 18 km/h
    const next = tickDriver(d, huge);
    expect(next.distanceKm).toBe(0);
    expect(next.eta).toBe(0);
    expect(next.position.lat).toBeCloseTo(DESTINATION.lat, 6);
    expect(next.position.lng).toBeCloseTo(DESTINATION.lng, 6);
  });

  it("converges toward destination across repeated ticks", () => {
    let d = spawnDriver(DESTINATION, { rng: seqRng([0.4, 0.7, 0.1]) });
    const initial = d.distanceKm;
    // 1000 ticks of 10s = ~50km of travel at 18km/h, well beyond the 3km spawn.
    for (let i = 0; i < 1000; i++) {
      d = tickDriver(d, 10_000);
    }
    expect(d.distanceKm).toBeLessThan(initial);
    expect(d.distanceKm).toBe(0);
    expect(d.eta).toBe(0);
    expect(haversineKm(d.position, DESTINATION)).toBeLessThan(0.01);
  });

  it("position lies between origin and destination during travel", () => {
    const d = spawnDriver(DESTINATION, { rng: seqRng([0.4, 0.7, 0.1]) });
    const halfElapsed = (d.distanceKm / d.speedKmh) * 3.6e6 * 0.5; // ms to halfway
    const next = tickDriver(d, halfElapsed);
    expect(next.distanceKm).toBeCloseTo(d.distanceKm * 0.5, 4);
    // Midway should be closer to destination than original was.
    expect(haversineKm(next.position, DESTINATION)).toBeLessThan(
      haversineKm(d.position, DESTINATION),
    );
  });
});
