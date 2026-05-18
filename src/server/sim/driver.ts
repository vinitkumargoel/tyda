/**
 * Driver position simulation.
 *
 * `spawnDriver` places a driver 1.5–3 km from the destination at a random
 * bearing (uniform on the circle). `tickDriver` advances the driver toward
 * the destination at a configurable speed.
 *
 * Both functions are pure (given an injected RNG for spawn).
 */

import type { LatLng } from "./eta.js";
import { haversineKm } from "./eta.js";

const DRIVER_NAMES = ["Ramesh K", "Suresh M", "Anjali R", "Priya S", "Karthik N", "Deepa V"] as const;

export interface DriverState {
  name: string;
  position: LatLng;
  destination: LatLng;
  /** Speed in kilometers per hour. */
  speedKmh: number;
  /** Estimated minutes to arrival at the current speed. */
  eta: number;
  /** Remaining great-circle distance to destination, in kilometers. */
  distanceKm: number;
}

export interface SpawnOptions {
  /** Override the auto-generated name. */
  name?: string;
  /** Override the default delivery speed (18 km/h). */
  speedKmh?: number;
  /**
   * Injected RNG returning numbers in [0, 1). Allows deterministic spawn in
   * tests. Default: `Math.random`.
   */
  rng?: () => number;
}

/**
 * Convert a (distance_km, bearing_rad) offset from an anchor into a LatLng.
 *
 * Uses the equirectangular projection — good enough for small distances
 * (<10 km) and keeps the math obvious. The sim doesn't need WGS-84 accuracy.
 */
function offsetByKm(anchor: LatLng, distanceKm: number, bearingRad: number): LatLng {
  const dNorthKm = distanceKm * Math.cos(bearingRad);
  const dEastKm = distanceKm * Math.sin(bearingRad);
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((anchor.lat * Math.PI) / 180);
  return {
    lat: anchor.lat + dNorthKm / kmPerDegLat,
    lng: anchor.lng + dEastKm / (kmPerDegLng || 1),
  };
}

function pickName(rng: () => number): string {
  const idx = Math.floor(rng() * DRIVER_NAMES.length);
  // Clamp in case rng() returns exactly 1.
  const safeIdx = Math.min(idx, DRIVER_NAMES.length - 1);
  return DRIVER_NAMES[safeIdx]!;
}

/**
 * Spawn a driver 1.5–3 km from the destination at a uniformly random bearing.
 */
export function spawnDriver(destination: LatLng, opts: SpawnOptions = {}): DriverState {
  const rng = opts.rng ?? Math.random;
  const speedKmh = opts.speedKmh ?? 18;
  const name = opts.name ?? pickName(rng);
  const distance = 1.5 + rng() * 1.5; // [1.5, 3.0) km
  const bearing = rng() * 2 * Math.PI;
  const position = offsetByKm(destination, distance, bearing);
  const actualDistance = haversineKm(position, destination);
  return {
    name,
    position,
    destination,
    speedKmh,
    distanceKm: actualDistance,
    eta: (actualDistance / speedKmh) * 60,
  };
}

/**
 * Pure: advance the driver toward the destination by `elapsedMs`.
 */
export function tickDriver(d: DriverState, elapsedMs: number): DriverState {
  if (elapsedMs <= 0) return d;
  const traveledKm = d.speedKmh * (elapsedMs / 3.6e6);
  const remaining = Math.max(0, d.distanceKm - traveledKm);
  if (remaining === 0 || d.distanceKm === 0) {
    return {
      ...d,
      position: d.destination,
      distanceKm: 0,
      eta: 0,
    };
  }
  // Linear interpolation in lat/lng space. Accurate enough at city scale.
  const ratio = remaining / d.distanceKm;
  const position: LatLng = {
    lat: d.destination.lat + (d.position.lat - d.destination.lat) * ratio,
    lng: d.destination.lng + (d.position.lng - d.destination.lng) * ratio,
  };
  return {
    ...d,
    position,
    distanceKm: remaining,
    eta: (remaining / d.speedKmh) * 60,
  };
}

export { DRIVER_NAMES };
