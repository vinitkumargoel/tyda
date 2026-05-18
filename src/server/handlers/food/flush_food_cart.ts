/**
 * flush_food_cart — clear the active food cart (or a specific restaurant's).
 */
import { mutate } from "../../store.js";
import type { HandlerContext } from "./_types.js";
import { activeCart } from "./_helpers.js";

interface Input {
  restaurantId?: string;
}

export interface FlushFoodCartOutput {
  success: true;
  data: { cleared: string | null };
  message: string;
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<FlushFoodCartOutput> {
  let cleared: string | null = null;
  await mutate((s) => {
    if (input.restaurantId) {
      if (s.carts.food[input.restaurantId]) {
        delete s.carts.food[input.restaurantId];
        cleared = input.restaurantId;
      }
      return;
    }
    const cart = activeCart(s.carts.food);
    if (cart) {
      delete s.carts.food[cart.restaurantId];
      cleared = cart.restaurantId;
    }
  });
  return {
    success: true,
    data: { cleared },
    message: cleared ? "Cart cleared." : "No active cart to clear.",
  };
}
