import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as crypto from "node:crypto";
import { mutate } from "../../store.js";
import type { State } from "../../store.js";
import type {
  DineoutVenue,
  DineoutCart,
  DineoutBooking,
  SavedLocation,
  Slot,
  SlotDay,
} from "./_types.js";

/**
 * Path resolution: fixtures live at `<repo>/fixtures/dineout.json`.
 * `import.meta.url` -> `<repo>/src/server/handlers/dineout/_helpers.ts` (tsx)
 * or                  `<repo>/dist/server/handlers/dineout/_helpers.js`.
 * In both cases climbing four levels lands on the repo root.
 */
function repoRoot(): string {
  const here = url.fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..", "..", "..");
}

function fixturePath(): string {
  return path.join(repoRoot(), "fixtures", "dineout.json");
}

/**
 * In-process mutable cache of the venue catalog. Each `loadVenues` returns the
 * same object reference, so slot capacity decay from `book_table` persists
 * across calls within a single server lifetime.
 */
let venuesCache: DineoutVenue[] | null = null;

export async function loadVenues(): Promise<DineoutVenue[]> {
  if (venuesCache) return venuesCache;
  const raw = await fs.readFile(fixturePath(), "utf8");
  venuesCache = JSON.parse(raw) as DineoutVenue[];
  return venuesCache;
}

/**
 * Test helper: drop the cache so the next call re-reads the fixture from
 * disk. Pristine slot capacities. Tests should call this in `beforeEach`.
 */
export function resetVenuesCache(): void {
  venuesCache = null;
}

export function findVenue(
  venues: DineoutVenue[],
  restaurantId: string,
): DineoutVenue | undefined {
  return venues.find((v) => v.id === restaurantId);
}

export function findSlot(
  venue: DineoutVenue,
  slotId: string,
): { day: SlotDay; slot: Slot } | undefined {
  for (const day of venue.slots) {
    const slot = day.windows.find((w) => w.id === slotId);
    if (slot) return { day, slot };
  }
  return undefined;
}

export function decrementSlotCapacity(
  venue: DineoutVenue,
  slotId: string,
): { ok: true; remaining: number } | { ok: false; reason: "NOT_FOUND" | "FULL" } {
  const found = findSlot(venue, slotId);
  if (!found) return { ok: false, reason: "NOT_FOUND" };
  if (found.slot.capacity <= 0) return { ok: false, reason: "FULL" };
  found.slot.capacity -= 1;
  return { ok: true, remaining: found.slot.capacity };
}

const BANGALORE_PRESETS: SavedLocation[] = [
  {
    id: "loc_home",
    index: 1,
    addressLine: "Home — 12th Main, Indiranagar, Bangalore",
    area: "Indiranagar",
    city: "Bangalore",
    lat: 12.9784,
    lng: 77.6408,
  },
  {
    id: "loc_work",
    index: 2,
    addressLine: "Office — 80 Feet Rd, Koramangala, Bangalore",
    area: "Koramangala",
    city: "Bangalore",
    lat: 12.9352,
    lng: 77.6245,
  },
  {
    id: "loc_mg",
    index: 3,
    addressLine: "MG Road, Bangalore",
    area: "MG Road",
    city: "Bangalore",
    lat: 12.9759,
    lng: 77.6063,
  },
];

export function presetSavedLocations(): SavedLocation[] {
  return BANGALORE_PRESETS.map((l) => ({ ...l }));
}

/**
 * Pull the current saved-locations list off of state. If empty, falls back to
 * the preset Bangalore areas.
 */
export function readSavedLocations(state: State): SavedLocation[] {
  const stored = state.addresses.dineout as unknown as SavedLocation[];
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return presetSavedLocations();
}

/**
 * `DO-YYYY-MM-DD-NNNN` booking id. NNNN is the per-day sequence pulled from
 * existing bookings on `state.orders.dineout`.
 */
export function nextBookingId(state: State, date: string): string {
  const bookings = state.orders.dineout as unknown as DineoutBooking[];
  const todays = bookings.filter((b) => b.date === date);
  const seq = (todays.length + 1).toString().padStart(4, "0");
  return `DO-${date}-${seq}`;
}

export function newCartId(): string {
  return `cart_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * In-process cache of pending carts created by `create_cart` and consumed by
 * `book_table`. Carts vanish when the server restarts — they're a transient
 * staging area, not durable state.
 */
const pendingCarts = new Map<string, DineoutCart>();

export function putCart(cart: DineoutCart): void {
  pendingCarts.set(cart.cartId, cart);
}

export function getCart(cartId: string): DineoutCart | undefined {
  return pendingCarts.get(cartId);
}

export function deleteCart(cartId: string): void {
  pendingCarts.delete(cartId);
}

export function resetCartsForTests(): void {
  pendingCarts.clear();
}

/**
 * Append a booking to durable state.
 */
export async function persistBooking(booking: DineoutBooking): Promise<void> {
  await mutate((s) => {
    const list = s.orders.dineout as unknown as DineoutBooking[];
    list.push(booking);
  });
}

export async function findBooking(
  orderId: string,
): Promise<DineoutBooking | undefined> {
  let result: DineoutBooking | undefined;
  await mutate((s) => {
    const list = s.orders.dineout as unknown as DineoutBooking[];
    result = list.find((b) => b.orderId === orderId);
  });
  return result;
}

export function parseDate(input: string): string {
  // Accepts YYYY-MM-DD verbatim or numeric epoch (seconds or ms). Returns YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return input;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function tomorrowDate(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Reservation time epoch seconds for a slot label like "19:30" on a given date.
 */
export function slotReservationTime(date: string, label: string): number {
  const iso = `${date}T${label}:00.000Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}
