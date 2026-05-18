import { describe, it, expect } from "vitest";
import { haversineKm, etaMinutes } from "../../src/server/sim/eta.js";

// Reference coordinates (approximate city / neighborhood centroids).
const BANGALORE = { lat: 12.9716, lng: 77.5946 };
const MYSORE = { lat: 12.2958, lng: 76.6394 };
const INDIRANAGAR = { lat: 12.9784, lng: 77.6408 };
const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(BANGALORE, BANGALORE)).toBe(0);
  });

  it("is symmetric", () => {
    const a = haversineKm(BANGALORE, MYSORE);
    const b = haversineKm(MYSORE, BANGALORE);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });

  it("Bangalore -> Mysore is ~130 km (±15 km)", () => {
    // Reference: published great-circle distance ~128 km between city centroids.
    const km = haversineKm(BANGALORE, MYSORE);
    expect(km).toBeGreaterThan(115);
    expect(km).toBeLessThan(145);
  });

  it("Indiranagar -> Koramangala is ~3.5–5 km (±1 km)", () => {
    const km = haversineKm(INDIRANAGAR, KORAMANGALA);
    expect(km).toBeGreaterThan(2.5);
    expect(km).toBeLessThan(6);
  });

  it("scales linearly with bearing-aligned points", () => {
    const p1 = { lat: 0, lng: 0 };
    const p2 = { lat: 0, lng: 1 }; // ~111.19 km along equator
    const km = haversineKm(p1, p2);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });
});

describe("etaMinutes", () => {
  it("uses default 25 km/h and 10 min prep buffer", () => {
    // Equator: 1 deg of longitude ~ 111 km. With 25 km/h that's ~266.4 min + 10.
    const eta = etaMinutes({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(eta).toBeGreaterThan(270);
    expect(eta).toBeLessThan(280);
  });

  it("respects custom avgKmh and prepBufferMin", () => {
    const eta = etaMinutes(INDIRANAGAR, KORAMANGALA, { avgKmh: 20, prepBufferMin: 5 });
    // distance ~ 5 km, 20 km/h -> 15 min + 5 prep buffer = ~20 min
    expect(eta).toBeGreaterThan(10);
    expect(eta).toBeLessThan(30);
  });

  it("returns prep buffer only when restaurant equals address", () => {
    const eta = etaMinutes(BANGALORE, BANGALORE, { prepBufferMin: 7 });
    expect(eta).toBe(7);
  });

  it("is a pure function (multiple calls are stable)", () => {
    const a = etaMinutes(INDIRANAGAR, KORAMANGALA);
    const b = etaMinutes(INDIRANAGAR, KORAMANGALA);
    expect(a).toBe(b);
  });
});
