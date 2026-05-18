/**
 * update_food_cart — replace the cart for a restaurant.
 *
 * Per Wave 2 spec:
 *  - `cartItems[].quantity === 0` removes the item.
 *  - Switching restaurants clears the previous cart first (Swiggy single-vendor
 *    rule).
 *  - Re-applies any stored coupon; if the coupon no longer qualifies, drop it.
 */
import { mutate } from "../../store.js";
import type {
  HandlerContext,
  FoodCart,
  FoodCartItem,
} from "./_types.js";
import {
  computeTotals,
  evaluateCoupon,
  findMenuItem,
  findRestaurant,
  loadCoupons,
  loadRestaurants,
  priceFor,
} from "./_helpers.js";

interface RawCartItem {
  menuItemId: string;
  quantity: number;
  addOnIds?: string[];
  variantId?: string;
}

interface Input {
  restaurantId: string;
  cartItems: RawCartItem[];
  addressId?: string;
  restaurantName?: string;
}

export interface UpdateFoodCartOutput {
  success: boolean;
  data?: { cart: FoodCart | null };
  message?: string;
  error?: { code?: string; message: string };
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<UpdateFoodCartOutput> {
  const restaurants = await loadRestaurants();
  const restaurant = findRestaurant(restaurants, input.restaurantId);
  if (!restaurant) {
    return {
      success: false,
      error: {
        code: "RESTAURANT_NOT_FOUND",
        message: `No restaurant with id ${input.restaurantId}`,
      },
    };
  }

  // Resolve incoming items against the menu.
  const items: FoodCartItem[] = [];
  for (const raw of input.cartItems as RawCartItem[]) {
    if (raw.quantity <= 0) continue;
    const m = findMenuItem(restaurant, raw.menuItemId);
    if (!m) {
      return {
        success: false,
        error: {
          code: "MENU_ITEM_NOT_FOUND",
          message: `Menu item ${raw.menuItemId} not on ${restaurant.name}.`,
        },
      };
    }
    const { unitPrice, variantLabel } = priceFor(m, raw.variantId, raw.addOnIds);
    const item: FoodCartItem = {
      menuItemId: m.id,
      name: m.name,
      quantity: raw.quantity,
      unitPrice,
      lineTotal: unitPrice * raw.quantity,
      category: m.category,
      veg: m.veg,
    };
    if (raw.variantId !== undefined) item.variantId = raw.variantId;
    if (variantLabel !== undefined) item.variantLabel = variantLabel;
    if (raw.addOnIds !== undefined) item.addOnIds = raw.addOnIds;
    items.push(item);
  }

  const coupons = await loadCoupons();
  let resultCart: FoodCart | null = null;

  await mutate((s) => {
    // Switching vendors: drop other carts.
    for (const rid of Object.keys(s.carts.food)) {
      if (rid !== input.restaurantId) delete s.carts.food[rid];
    }

    if (items.length === 0) {
      // Empty update -> remove cart entirely.
      delete s.carts.food[input.restaurantId];
      resultCart = null;
      return;
    }

    const existing = s.carts.food[input.restaurantId];
    const next: FoodCart = {
      restaurantId: restaurant.id,
      restaurantName: input.restaurantName ?? restaurant.name,
      items,
      subtotal: 0,
      deliveryFee: 0,
      platformFee: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date().toISOString(),
    };

    // Carry coupon forward if it still applies.
    const carryCode = existing?.appliedCoupon?.code;
    if (carryCode) {
      const coupon = coupons.find((c) => c.code === carryCode);
      if (coupon) {
        const evaluated = evaluateCoupon(next, coupon);
        if (evaluated) {
          next.appliedCoupon = evaluated.applied;
          next.discount = evaluated.discount;
        }
      }
    }

    const totals = computeTotals(next.items, next.discount);
    next.subtotal = totals.subtotal;
    next.deliveryFee = totals.deliveryFee;
    next.platformFee = totals.platformFee;
    next.total = totals.total;

    s.carts.food[input.restaurantId] = next;
    resultCart = next;
  });

  return {
    success: true,
    data: { cart: resultCart },
  };
}
