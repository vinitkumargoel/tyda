/**
 * get_food_order_details — full record of a single food order.
 */
import { loadState } from "../../store.js";
import type { HandlerContext, FoodOrder } from "./_types.js";

interface Input {
  orderId: string;
}

export interface GetFoodOrderDetailsOutput {
  success: boolean;
  data?: { order: FoodOrder };
  error?: { code?: string; message: string };
}

export default async function handle(
  input: Input,
  ctx: HandlerContext,
): Promise<GetFoodOrderDetailsOutput> {
  const state = await loadState();
  const order = state.orders.food.find(
    (o) => o.id === input.orderId && o.userId === ctx.auth.sub,
  );
  if (!order) {
    return {
      success: false,
      error: { code: "ORDER_NOT_FOUND", message: `No order ${input.orderId}` },
    };
  }
  return { success: true, data: { order } };
}
