import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";
import { advance } from "../../sim/order-state.js";
import { haversineKm } from "../../sim/eta.js";
import type { InstamartOrder } from "./_types.js";

export interface TrackOrderInput {
  orderId: string;
  lat?: number;
  lng?: number;
}

export interface TrackingPayload {
  orderId: string;
  state: InstamartOrder["state"];
  etaMinutes: number;
  driver: { name: string; lat: number; lng: number; distanceKm: number };
  items: InstamartOrder["items"];
  placedAt: number;
}

export interface TrackOrderContext {
  now?: () => number;
}

export async function trackOrder(
  args: TrackOrderInput,
  ctx: TrackOrderContext = {},
): Promise<OkResponse<TrackingPayload> | ErrResponse> {
  const now = (ctx.now ?? (() => Date.now()))();
  let order: InstamartOrder | null = null;

  await mutate((s) => {
    const idx = s.orders.instamart.findIndex((o) => o.id === args.orderId);
    if (idx < 0) return;
    const existing = s.orders.instamart[idx]!;
    const next = advance(
      {
        id: existing.id,
        state: existing.state,
        stateStartedAt: existing.stateStartedAt,
        placedAt: existing.placedAt,
        speed: existing.speed,
      },
      now,
    );
    if (next.state !== existing.state) {
      const updated: InstamartOrder = {
        ...existing,
        state: next.state,
        stateStartedAt: next.stateStartedAt,
      };
      // As the rider approaches OUT_FOR_DELIVERY, snap the driver toward the
      // destination so the TUI can render movement.
      if (next.state === "OUT_FOR_DELIVERY") {
        updated.driverLat = existing.deliveryLat + 0.005;
        updated.driverLng = existing.deliveryLng + 0.005;
      } else if (next.state === "DELIVERED") {
        updated.driverLat = existing.deliveryLat;
        updated.driverLng = existing.deliveryLng;
      }
      s.orders.instamart[idx] = updated;
      order = updated;
    } else {
      order = existing;
    }
  });

  if (!order) {
    return {
      success: false,
      error: {
        code: "ORDER_NOT_FOUND",
        message: `No Instamart order found with id ${args.orderId}`,
      },
    };
  }

  const o = order as InstamartOrder;
  const distanceKm = haversineKm(
    { lat: o.driverLat, lng: o.driverLng },
    {
      lat: args.lat ?? o.deliveryLat,
      lng: args.lng ?? o.deliveryLng,
    },
  );
  const elapsedMin = Math.max(0, (now - o.placedAt) / 60_000);
  const remaining = Math.max(0, Math.ceil(o.etaMinutes - elapsedMin));

  return {
    success: true,
    data: {
      orderId: o.id,
      state: o.state,
      etaMinutes: remaining,
      driver: {
        name: o.driverName,
        lat: o.driverLat,
        lng: o.driverLng,
        distanceKm,
      },
      items: o.items,
      placedAt: o.placedAt,
    },
    message: `Order ${o.id} is ${o.state}; ETA ${remaining} min.`,
  };
}
