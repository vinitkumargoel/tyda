/**
 * track_food_order — current state + ETA for one order.
 *
 * Returns rider information (name, distance, ETA minutes) while the order is
 * OUT_FOR_DELIVERY. Composes order state from the store and driver state from
 * the sim singletons.
 */
import { loadState } from "../../store.js";
import type { HandlerContext } from "./_types.js";

interface Input {
  orderId?: string;
}

interface TrackedOrder {
  orderId: string;
  state: string;
  placedAt: string;
  etaMinutes: number;
  restaurantName: string;
  rider?: { name: string; distanceKm: number; etaMinutes: number };
}

export interface TrackFoodOrderOutput {
  success: boolean;
  data?: { orders: TrackedOrder[] };
  error?: { code?: string; message: string };
}

export default async function handle(
  input: Input,
  ctx: HandlerContext,
): Promise<TrackFoodOrderOutput> {
  const state = await loadState();
  const userOrders = state.orders.food.filter((o) => o.userId === ctx.auth.sub);

  const filtered = input.orderId
    ? userOrders.filter((o) => o.id === input.orderId)
    : userOrders.filter((o) => o.state !== "DELIVERED" && o.state !== "CANCELLED");

  if (input.orderId && filtered.length === 0) {
    return {
      success: false,
      error: { code: "ORDER_NOT_FOUND", message: `No order ${input.orderId}` },
    };
  }

  const tracked: TrackedOrder[] = filtered.map((o) => {
    const t: TrackedOrder = {
      orderId: o.id,
      state: o.state,
      placedAt: o.placedAt,
      etaMinutes: o.etaMinutes,
      restaurantName: o.restaurantName,
    };
    if (o.state === "OUT_FOR_DELIVERY") {
      const d = ctx.drivers?.get(o.id);
      if (d) {
        t.rider = {
          name: d.name,
          distanceKm: Number(d.distanceKm.toFixed(2)),
          etaMinutes: Math.max(1, Math.round(d.eta)),
        };
      }
    }
    return t;
  });

  return { success: true, data: { orders: tracked } };
}
