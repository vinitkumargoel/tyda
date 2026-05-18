/**
 * Wave-1 simulation primitives.
 *
 * Pure logic only — no HTTP, no DB, no I/O. Handlers in Wave 2 compose these
 * to give the mock server "alive" behavior (orders progress through states,
 * drivers move toward addresses, Instamart inventory reshuffles daily).
 */

export type { LatLng, EtaOptions } from "./eta.js";
export { haversineKm, etaMinutes } from "./eta.js";

export type {
  OrderState,
  DemoSpeed,
  OrderRecord,
  TransitionTiming,
  OrderTicker,
} from "./order-state.js";
export { TRANSITIONS, advance, startTicker } from "./order-state.js";

export type { DriverState, SpawnOptions } from "./driver.js";
export { spawnDriver, tickDriver, DRIVER_NAMES } from "./driver.js";

export { isAvailable, OOS_PROBABILITY } from "./inventory.js";
