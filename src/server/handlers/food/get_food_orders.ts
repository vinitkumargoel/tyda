/**
 * get_food_orders — list recent food orders for the user, newest first.
 */
import { loadState } from "../../store.js";
import type { HandlerContext, FoodOrder } from "./_types.js";

interface Input {
  orderCount?: number;
  addressId?: string;
}

interface OrderSummary {
  id: string;
  restaurantName: string;
  state: string;
  total: number;
  placedAt: string;
  etaMinutes: number;
}

export interface GetFoodOrdersOutput {
  success: true;
  data: { orders: OrderSummary[] };
}

function summarize(o: FoodOrder): OrderSummary {
  return {
    id: o.id,
    restaurantName: o.restaurantName,
    state: o.state,
    total: o.total,
    placedAt: o.placedAt,
    etaMinutes: o.etaMinutes,
  };
}

export default async function handle(
  input: Input,
  ctx: HandlerContext,
): Promise<GetFoodOrdersOutput> {
  const state = await loadState();
  const userOrders = state.orders.food.filter((o) => o.userId === ctx.auth.sub);
  const limit = Math.max(1, Math.min(input.orderCount ?? 5, 20));
  const sorted = [...userOrders].sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
  );
  return {
    success: true,
    data: { orders: sorted.slice(0, limit).map(summarize) },
  };
}
