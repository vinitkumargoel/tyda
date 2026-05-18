import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";
import {
  CHECKOUT_MAX,
  computeBill,
  emptyCart,
  loadInstamartCoupons,
} from "./_helpers.js";
import { CART_KEY } from "./get_cart.js";
import { etaMinutes, type OrderTicker } from "../../sim/index.js";
import type {
  InstamartOrder,
  InstamartOrderItemSnapshot,
} from "./_types.js";

export interface CheckoutInput {
  addressId: string;
  paymentMethod?: string;
}

export interface CheckoutContext {
  ticker?: OrderTicker;
  now?: () => Date;
}

const STORE_LAT = 12.9716;
const STORE_LNG = 77.5946;

function todayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function buildOrderId(d: Date, sequence: number): string {
  return `IM-${todayKey(d)}-${String(sequence).padStart(4, "0")}`;
}

export async function checkout(
  args: CheckoutInput,
  ctx: CheckoutContext = {},
): Promise<OkResponse<{ order: InstamartOrder }> | ErrResponse> {
  const now = (ctx.now ?? (() => new Date()))();
  const coupons = await loadInstamartCoupons();

  let order: InstamartOrder | null = null;
  let err: ErrResponse | null = null;

  await mutate((s) => {
    const cart = s.carts.instamart[CART_KEY];
    if (!cart || cart.items.length === 0) {
      err = {
        success: false,
        error: {
          code: "EMPTY_CART",
          message: "Your Instamart cart is empty",
        },
      };
      return;
    }
    const address = s.addresses.instamart.find((a) => a.id === args.addressId);
    if (!address) {
      err = {
        success: false,
        error: {
          code: "ADDRESS_NOT_FOUND",
          message: `No address found with id ${args.addressId}`,
        },
      };
      return;
    }
    const bill = computeBill(cart, coupons);
    if (bill.total > CHECKOUT_MAX) {
      err = {
        success: false,
        error: {
          code: "ORDER_LIMIT_EXCEEDED",
          message:
            `Cart total ₹${bill.total} exceeds the ₹${CHECKOUT_MAX} Instamart limit. ` +
            "For larger orders, please use the Swiggy Instamart app.",
        },
      };
      return;
    }

    const day = todayKey(now);
    const sameDayCount = s.orders.instamart.filter((o) =>
      o.id.startsWith(`IM-${day}`),
    ).length;
    const id = buildOrderId(now, sameDayCount + 1);

    const items: InstamartOrderItemSnapshot[] = cart.items.map((it) => ({
      spinId: it.spinId,
      productId: it.productId,
      name: it.name,
      variantLabel: it.variantLabel,
      price: it.price,
      quantity: it.quantity,
    }));

    const eta = Math.max(
      10,
      Math.min(
        15,
        Math.round(
          etaMinutes(
            { lat: STORE_LAT, lng: STORE_LNG },
            { lat: address.lat, lng: address.lng },
            { prepBufferMin: 5, avgKmh: 30 },
          ),
        ),
      ),
    );

    order = {
      id,
      addressId: address.id,
      items,
      bill,
      paymentMethod: args.paymentMethod ?? "UPI",
      placedAt: now.getTime(),
      etaMinutes: eta,
      state: "PLACED",
      stateStartedAt: now.getTime(),
      speed: "fast",
      deliveryLat: address.lat,
      deliveryLng: address.lng,
      driverLat: STORE_LAT,
      driverLng: STORE_LNG,
      driverName: "Instamart Rider",
    };

    s.orders.instamart.push(order);
    // Empty the cart after a successful checkout.
    s.carts.instamart[CART_KEY] = emptyCart();
  });

  if (err) return err;
  if (!order) {
    return {
      success: false,
      error: { code: "INTERNAL", message: "Failed to create order" },
    };
  }

  // Register the placed order with the sim ticker.
  if (ctx.ticker) {
    ctx.ticker.register({
      id: (order as InstamartOrder).id,
      state: "PLACED",
      stateStartedAt: (order as InstamartOrder).stateStartedAt,
      placedAt: (order as InstamartOrder).placedAt,
      speed: "fast",
    });
  }

  return {
    success: true,
    data: { order: order as InstamartOrder },
    message: `Instamart order placed successfully — arriving in ${(order as InstamartOrder).etaMinutes} min.`,
  };
}
