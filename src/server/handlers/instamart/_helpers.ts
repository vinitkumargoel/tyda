/**
 * Shared helpers for Instamart handlers.
 *
 * Loads fixtures once on first use, computes bill breakdowns, and applies
 * Instamart-scope OOS masking via the sim engine's `isAvailable`.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { isAvailable } from "../../sim/inventory.js";
import type {
  InstamartBill,
  InstamartCart,
  InstamartCartItem,
  Product,
  ProductVariant,
} from "./_types.js";

const DELIVERY_FEE = 30;
const HANDLING_FEE = 2;
const FREE_DELIVERY_THRESHOLD = 199;
const CHECKOUT_MAX = 1000;
const OOS_SEED = "tyda-instamart";

let productsCache: Product[] | null = null;
let couponsCache: InstamartCoupon[] | null = null;

interface RawCoupon {
  code: string;
  scope: string;
  title: string;
  description: string;
  discountType: "flat" | "percent";
  amount: number;
  minOrderValue: number;
  maxDiscount: number | null;
  appliesTo: { category?: string; firstOrderOnly?: boolean } | null;
  active: boolean;
}

export interface InstamartCoupon extends RawCoupon {
  scope: "instamart";
}

function fixturesDir(): string {
  // __dirname-equivalent in ESM, then walk up to repo root.
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // src/server/handlers/instamart -> repo root is four levels up.
  return path.resolve(here, "..", "..", "..", "..", "fixtures");
}

export async function loadProducts(): Promise<Product[]> {
  if (productsCache) return productsCache;
  const file = path.join(fixturesDir(), "products.json");
  const raw = await fs.readFile(file, "utf8");
  productsCache = JSON.parse(raw) as Product[];
  return productsCache;
}

export async function loadInstamartCoupons(): Promise<InstamartCoupon[]> {
  if (couponsCache) return couponsCache;
  const file = path.join(fixturesDir(), "coupons.json");
  const raw = await fs.readFile(file, "utf8");
  const all = JSON.parse(raw) as RawCoupon[];
  couponsCache = all.filter(
    (c): c is InstamartCoupon => c.scope === "instamart" && c.active,
  );
  return couponsCache;
}

/**
 * Resets internal caches. Only intended for tests that need to reload fixtures
 * after mutation.
 */
export function _resetCaches(): void {
  productsCache = null;
  couponsCache = null;
}

/**
 * Returns `true` if the variant is in stock today: fixture stock > 0 AND
 * the deterministic OOS shuffle leaves it available.
 */
export function variantAvailable(
  variant: ProductVariant,
  now: Date = new Date(),
): boolean {
  if (variant.stock <= 0) return false;
  return isAvailable(variant.spinId, now, OOS_SEED);
}

export function findProductBySpinId(
  products: Product[],
  spinId: string,
): { product: Product; variant: ProductVariant } | null {
  for (const p of products) {
    for (const v of p.variants) {
      if (v.spinId === spinId) return { product: p, variant: v };
    }
  }
  return null;
}

/**
 * Apply the best eligible Instamart coupon to a cart automatically.
 *
 * Returns the discount in rupees plus the chosen coupon code (or null if no
 * coupon applies).
 */
export function pickBestCoupon(
  cart: InstamartCart,
  coupons: InstamartCoupon[],
): { code: string | null; discount: number } {
  const subtotal = cartSubtotal(cart);
  let best: { code: string; discount: number } | null = null;
  const categories = new Set(cart.items.map((i) => i.category));

  for (const c of coupons) {
    if (subtotal < c.minOrderValue) continue;
    if (c.appliesTo && c.appliesTo.category) {
      if (!categories.has(c.appliesTo.category)) continue;
    }
    let d = 0;
    if (c.discountType === "flat") {
      d = c.amount;
    } else {
      d = Math.floor((subtotal * c.amount) / 100);
      if (c.maxDiscount !== null) d = Math.min(d, c.maxDiscount);
    }
    if (d <= 0) continue;
    if (!best || d > best.discount) best = { code: c.code, discount: d };
  }

  if (!best) return { code: null, discount: 0 };
  return best;
}

export function cartSubtotal(cart: InstamartCart): number {
  let s = 0;
  for (const it of cart.items) s += it.price * it.quantity;
  return s;
}

export function computeBill(
  cart: InstamartCart,
  coupons: InstamartCoupon[],
): InstamartBill {
  const subtotal = cartSubtotal(cart);
  let deliveryFee: number;
  if (subtotal === 0) {
    deliveryFee = 0;
  } else {
    deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  }
  const handlingFee = subtotal > 0 ? HANDLING_FEE : 0;
  const { code, discount } = pickBestCoupon(cart, coupons);
  const total = Math.max(0, subtotal + deliveryFee + handlingFee - discount);
  return {
    subtotal,
    deliveryFee,
    handlingFee,
    discount,
    total,
    appliedCoupon: code,
  };
}

export function emptyCart(): InstamartCart {
  return { addressId: null, items: [], updatedAt: Date.now() };
}

/**
 * Build a cart item from a (product, variant, qty) triple.
 */
export function buildCartItem(
  product: Product,
  variant: ProductVariant,
  quantity: number,
): InstamartCartItem {
  return {
    spinId: variant.spinId,
    productId: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    variantLabel: variant.label,
    price: variant.price,
    quantity,
  };
}

export { DELIVERY_FEE, HANDLING_FEE, FREE_DELIVERY_THRESHOLD, CHECKOUT_MAX, OOS_SEED };
