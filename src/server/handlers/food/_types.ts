/**
 * TS types for the Food domain.
 *
 * These shapes back the in-memory state managed in `src/server/store.ts`'s
 * `addresses.food` / `carts.food` / `orders.food` slots. They are intentionally
 * lightweight — handlers serialize them into the universal envelope before
 * returning to the MCP transport.
 */
import type { TokenClaims } from "../../oauth/jwt.js";
import type { OrderTicker, DriverState, OrderState } from "../../sim/index.js";

export interface Address {
  id: string;
  label: string;
  line: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  /** ISO timestamp of the most recent order delivered to this address. */
  lastOrderAt?: string;
}

export interface FoodCartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** Resolved price = (variant.price ?? menuItem.price) + sum(addOns[].price). */
  lineTotal: number;
  variantId?: string;
  variantLabel?: string;
  addOnIds?: string[];
  category?: string;
  veg?: boolean;
}

export interface AppliedCoupon {
  code: string;
  title: string;
  discount: number;
}

export interface FoodCart {
  restaurantId: string;
  restaurantName: string;
  items: FoodCartItem[];
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  discount: number;
  total: number;
  appliedCoupon?: AppliedCoupon;
  updatedAt: string;
}

export interface FoodOrder {
  id: string;
  userId: string;
  restaurantId: string;
  restaurantName: string;
  addressId: string;
  address: Address;
  items: FoodCartItem[];
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  state: OrderState;
  placedAt: string;
  etaMinutes: number;
  appliedCoupon?: AppliedCoupon;
  rider?: {
    name: string;
    distanceKm: number;
    etaMinutes: number;
  };
}

/**
 * Per-process services injected into every handler.
 *
 * `auth` carries the JWT claims (so handlers know which user is calling).
 * The sim singletons (`ticker`, `drivers`) are wired by `mountFood` and
 * passed through here; they are optional so unit tests can construct
 * handlers without spinning up the real ticker.
 */
export interface HandlerContext {
  auth: TokenClaims;
  ticker?: OrderTicker;
  drivers?: Map<string, DriverState>;
}
