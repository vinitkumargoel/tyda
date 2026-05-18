/**
 * Internal helpers shared by every Food handler.
 *
 * Loads the fixture files lazily (memoized) and exposes pure utilities for
 * looking up restaurants and menu items, scoring search results, computing
 * cart totals, and seeding default Food-side addresses on first run.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Address,
  AppliedCoupon,
  FoodCart,
  FoodCartItem,
} from "./_types.js";

/* ------------------------------------------------------------------ */
/* Fixture types                                                       */
/* ------------------------------------------------------------------ */

export interface MenuAddOn {
  id: string;
  name: string;
  price: number;
}

export interface MenuVariant {
  id: string;
  label: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  veg: boolean;
  addOns: MenuAddOn[];
  variants: MenuVariant[];
  isBestseller: boolean;
  available: boolean;
}

export interface Restaurant {
  id: string;
  name: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  costForTwo: number;
  currency: string;
  etaMinutes: number;
  imageUrl: string | null;
  menu: MenuItem[];
}

export interface CouponFixture {
  code: string;
  scope: "food" | "instamart";
  title: string;
  description: string;
  discountType: "flat" | "percent";
  amount: number;
  minOrderValue: number;
  maxDiscount: number | null;
  appliesTo: { category?: string; firstOrderOnly?: boolean } | null;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Fixture loading                                                     */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// handlers/food -> handlers -> server -> src -> repo root -> fixtures
const FIXTURES_DIR = path.resolve(here, "..", "..", "..", "..", "fixtures");

let restaurantsCache: Restaurant[] | null = null;
let couponsCache: CouponFixture[] | null = null;

export async function loadRestaurants(): Promise<Restaurant[]> {
  if (restaurantsCache) return restaurantsCache;
  const raw = await fs.readFile(path.join(FIXTURES_DIR, "restaurants.json"), "utf8");
  const parsed = JSON.parse(raw) as Restaurant[];
  restaurantsCache = parsed;
  return parsed;
}

export async function loadCoupons(): Promise<CouponFixture[]> {
  if (couponsCache) return couponsCache;
  const raw = await fs.readFile(path.join(FIXTURES_DIR, "coupons.json"), "utf8");
  const parsed = JSON.parse(raw) as CouponFixture[];
  couponsCache = parsed;
  return parsed;
}

/** Reset memo caches (test hook). */
export function resetFixtureCaches(): void {
  restaurantsCache = null;
  couponsCache = null;
}

/* ------------------------------------------------------------------ */
/* Default Food addresses (seeded on first call to get_addresses)      */
/* ------------------------------------------------------------------ */

export const DEFAULT_FOOD_ADDRESSES: Address[] = [
  {
    id: "addr_food_home",
    label: "Home",
    line: "Flat 302, Brigade Gateway",
    area: "Malleshwaram",
    city: "Bangalore",
    lat: 12.9926,
    lng: 77.5739,
  },
  {
    id: "addr_food_work",
    label: "Work",
    line: "Embassy Manyata Tech Park, Block N1",
    area: "Hebbal",
    city: "Bangalore",
    lat: 13.0473,
    lng: 77.6195,
  },
];

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function findRestaurant(
  restaurants: Restaurant[],
  id: string,
): Restaurant | undefined {
  return restaurants.find((r) => r.id === id);
}

export function findMenuItem(r: Restaurant, menuItemId: string): MenuItem | undefined {
  return r.menu.find((m) => m.id === menuItemId);
}

/**
 * Score a restaurant for a free-text query. Higher = better match.
 * Matches against name + cuisines (case-insensitive). 0 means no match.
 */
export function scoreRestaurant(r: Restaurant, query: string): number {
  if (!query) return r.rating;
  const q = query.toLowerCase().trim();
  const name = r.name.toLowerCase();
  const cuisines = r.cuisines.map((c) => c.toLowerCase());
  let score = 0;
  if (name.includes(q)) score += 10;
  for (const c of cuisines) {
    if (c.includes(q)) score += 5;
  }
  // Tie-break by rating.
  return score === 0 ? 0 : score + r.rating;
}

/**
 * Resolve unit price = (variant.price if any) + sum(addOn.price).
 */
export function priceFor(
  item: MenuItem,
  variantId: string | undefined,
  addOnIds: string[] | undefined,
): { unitPrice: number; variantLabel?: string } {
  const variant = variantId ? item.variants.find((v) => v.id === variantId) : undefined;
  const base = variant?.price ?? item.price;
  const addOns = addOnIds ?? [];
  const addOnSum = addOns.reduce((sum, aid) => {
    const a = item.addOns.find((x) => x.id === aid);
    return sum + (a?.price ?? 0);
  }, 0);
  const result: { unitPrice: number; variantLabel?: string } = {
    unitPrice: base + addOnSum,
  };
  if (variant) result.variantLabel = variant.label;
  return result;
}

/**
 * Compute cart totals from items. Pure: callers attach the result back to the
 * cart record before persisting.
 *
 * Fees per Wave 2 spec: deliveryFee ₹39, platformFee ₹6. Discount is preserved
 * from any already-applied coupon (caller passes it in).
 */
export interface CartTotals {
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  discount: number;
  total: number;
}

export function computeTotals(items: FoodCartItem[], discount: number): CartTotals {
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = items.length === 0 ? 0 : 39;
  const platformFee = items.length === 0 ? 0 : 6;
  const total = Math.max(0, subtotal + deliveryFee + platformFee - discount);
  return { subtotal, deliveryFee, platformFee, discount, total };
}

/**
 * Re-apply (re-compute) a stored coupon against the current cart contents.
 * Returns the new discount + applied coupon record, or null if the coupon no
 * longer satisfies its preconditions (e.g. cart fell below minOrderValue).
 */
export function evaluateCoupon(
  cart: FoodCart,
  coupon: CouponFixture,
): { discount: number; applied: AppliedCoupon } | null {
  if (!coupon.active) return null;
  if (coupon.scope !== "food") return null;
  const subtotal = cart.items.reduce((s, i) => s + i.lineTotal, 0);
  if (subtotal < coupon.minOrderValue) return null;

  // Category gating, e.g. BIRYANI20 requires a Biryani item.
  const requiredCategory = coupon.appliesTo?.category;
  if (requiredCategory) {
    const hasCategory = cart.items.some(
      (i) => (i.category ?? "").toLowerCase() === requiredCategory.toLowerCase(),
    );
    if (!hasCategory) return null;
  }

  let discount = 0;
  if (coupon.discountType === "flat") {
    discount = coupon.amount;
  } else {
    discount = Math.floor((subtotal * coupon.amount) / 100);
    if (coupon.maxDiscount !== null && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount;
    }
  }
  discount = Math.min(discount, subtotal);
  return {
    discount,
    applied: { code: coupon.code, title: coupon.title, discount },
  };
}

/* ------------------------------------------------------------------ */
/* Order id generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build an order id of the form `FD-YYYY-MM-DD-NNNN` where NNNN is a 4-digit
 * sequence within the day. The caller supplies the count of orders previously
 * placed on the same day for this user.
 */
export function buildOrderId(now: Date, sequenceForDay: number): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const n = String(sequenceForDay).padStart(4, "0");
  return `FD-${y}-${m}-${d}-${n}`;
}

export function dateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/**
 * Find the active (most recently updated) food cart for the user, if any.
 */
export function activeCart(carts: Record<string, FoodCart>): FoodCart | null {
  const list = Object.values(carts);
  if (list.length === 0) return null;
  return list.reduce((acc, c) => (new Date(c.updatedAt) > new Date(acc.updatedAt) ? c : acc));
}
