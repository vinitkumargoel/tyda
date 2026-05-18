/**
 * Deterministic Instamart out-of-stock shuffler.
 *
 * `isAvailable(spinId, date, seed)` returns `false` for ~5% of spinIds. The
 * set is stable for a given (date, seed) pair and reshuffles when the calendar
 * date changes. No I/O, no Math.random — strict PRNG hashing.
 */

const DEFAULT_SEED = "tyda-instamart";
const OOS_PROBABILITY = 0.05;

/**
 * MurmurHash3-derived string-to-32-bit seed (xmur3). 4-byte avalanche.
 */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * Mulberry32 PRNG seeded from a 32-bit integer. Cheap and good enough.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateKey(date: Date): string {
  // UTC calendar date — independent of server TZ so the shuffle is global.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Deterministic: returns `true` if the given spinId is in stock for the day.
 *
 * Same (spinId, date, seed) -> same boolean. Same date+seed gives a stable
 * ~5% OOS set across calls.
 */
export function isAvailable(spinId: string, date: Date, seed: string = DEFAULT_SEED): boolean {
  const composite = `${seed}|${dateKey(date)}|${spinId}`;
  const hasher = xmur3(composite);
  const rng = mulberry32(hasher());
  return rng() >= OOS_PROBABILITY;
}

export { OOS_PROBABILITY };
