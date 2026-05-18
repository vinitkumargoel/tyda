/**
 * get_food_cart — return the user's active food cart.
 *
 * "Active" = most recently updated cart in the food slot. Recomputes totals
 * before returning so any out-of-band fixture change (e.g. price update) is
 * reflected. If no cart exists, returns an empty success payload.
 */
import { loadState } from "../../store.js";
import type { HandlerContext, FoodCart } from "./_types.js";
import { activeCart, computeTotals } from "./_helpers.js";

interface Input {
  addressId?: string;
  restaurantName?: string;
}

export interface GetFoodCartOutput {
  success: true;
  data: {
    cart: FoodCart | null;
    availablePaymentMethods: string[];
  };
}

export default async function handle(
  _input: Input,
  _ctx: HandlerContext,
): Promise<GetFoodCartOutput> {
  const state = await loadState();
  const cart = activeCart(state.carts.food);
  if (!cart) {
    return {
      success: true,
      data: { cart: null, availablePaymentMethods: ["COD"] },
    };
  }
  // Recompute totals defensively.
  const totals = computeTotals(cart.items, cart.discount);
  const fresh: FoodCart = {
    ...cart,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    platformFee: totals.platformFee,
    total: totals.total,
  };
  return {
    success: true,
    data: { cart: fresh, availablePaymentMethods: ["COD"] },
  };
}
