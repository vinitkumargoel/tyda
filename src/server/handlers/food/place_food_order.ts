/**
 * place_food_order — create a FoodOrder from the active cart.
 *
 * Per Wave 2 spec:
 *  - Reject cart totals >= ₹1000 with code `CART_LIMIT_EXCEEDED`.
 *  - Persist the order with id `FD-YYYY-MM-DD-NNNN`.
 *  - Register with the sim ticker. Spawn a driver when state advances to
 *    OUT_FOR_DELIVERY (the ticker fires a callback in the server entrypoint).
 *  - Return a Swiggy-branded success message.
 */
import { mutate } from "../../store.js";
import {
  spawnDriver,
  etaMinutes as computeEta,
  type OrderRecord,
} from "../../sim/index.js";
import type { HandlerContext, FoodOrder, Address } from "./_types.js";
import {
  activeCart,
  buildOrderId,
  dateKey,
  findRestaurant,
  loadRestaurants,
} from "./_helpers.js";

interface Input {
  addressId: string;
  paymentMethod?: string;
}

export interface PlaceFoodOrderOutput {
  success: boolean;
  data?: { order: FoodOrder };
  message?: string;
  error?: { code?: string; message: string };
}

const CART_LIMIT_INR = 1000;

export default async function handle(
  input: Input,
  ctx: HandlerContext,
): Promise<PlaceFoodOrderOutput> {
  const restaurants = await loadRestaurants();

  let outcome: PlaceFoodOrderOutput | null = null;
  let order: FoodOrder | null = null;

  await mutate((s) => {
    const cart = activeCart(s.carts.food);
    if (!cart) {
      outcome = {
        success: false,
        error: { code: "NO_ACTIVE_CART", message: "No active food cart to place." },
      };
      return;
    }
    if (cart.total >= CART_LIMIT_INR) {
      outcome = {
        success: false,
        error: {
          code: "CART_LIMIT_EXCEEDED",
          message:
            "MCP beta cannot place orders of ₹1000 or more. Please use the Swiggy Food app to place this order.",
        },
      };
      return;
    }
    const address = s.addresses.food.find((a) => a.id === input.addressId);
    if (!address) {
      outcome = {
        success: false,
        error: { code: "ADDRESS_NOT_FOUND", message: `No address with id ${input.addressId}` },
      };
      return;
    }
    const restaurant = findRestaurant(restaurants, cart.restaurantId);
    if (!restaurant) {
      outcome = {
        success: false,
        error: {
          code: "RESTAURANT_NOT_FOUND",
          message: `Restaurant ${cart.restaurantId} from cart is no longer available.`,
        },
      };
      return;
    }
    const now = new Date();
    const todayKey = dateKey(now);
    const sequence =
      s.orders.food.filter((o) => o.id.startsWith(`FD-${todayKey}-`)).length + 1;
    const id = buildOrderId(now, sequence);
    const eta = Math.round(
      computeEta(
        { lat: restaurant.lat, lng: restaurant.lng },
        { lat: address.lat, lng: address.lng },
      ),
    );
    const placed: FoodOrder = {
      id,
      userId: ctx.auth.sub,
      restaurantId: cart.restaurantId,
      restaurantName: cart.restaurantName,
      addressId: address.id,
      address: address as Address,
      items: cart.items,
      subtotal: cart.subtotal,
      deliveryFee: cart.deliveryFee,
      platformFee: cart.platformFee,
      discount: cart.discount,
      total: cart.total,
      paymentMethod: input.paymentMethod ?? "COD",
      state: "PLACED",
      placedAt: now.toISOString(),
      etaMinutes: eta,
    };
    if (cart.appliedCoupon) placed.appliedCoupon = cart.appliedCoupon;

    s.orders.food.push(placed);
    delete s.carts.food[cart.restaurantId];
    address.lastOrderAt = now.toISOString();
    order = placed;
  });

  if (outcome) return outcome;
  if (!order) {
    return {
      success: false,
      error: { message: "Unknown failure placing order." },
    };
  }

  const placedOrder = order as FoodOrder;

  // Register with the sim ticker for state transitions, if wired.
  if (ctx.ticker) {
    const rec: OrderRecord = {
      id: placedOrder.id,
      state: "PLACED",
      stateStartedAt: Date.now(),
      placedAt: Date.now(),
      speed: "fast",
    };
    ctx.ticker.register(rec);
  }
  if (ctx.drivers) {
    // Pre-spawn the driver so /track can show realistic data once OFD hits.
    const dest = { lat: placedOrder.address.lat, lng: placedOrder.address.lng };
    ctx.drivers.set(placedOrder.id, spawnDriver(dest));
  }

  const addrLine = `${placedOrder.address.label} (${placedOrder.address.area})`;
  return {
    success: true,
    data: { order: placedOrder },
    message: `Swiggy order placed successfully. Order #${placedOrder.id} will be delivered to ${addrLine} in ~${placedOrder.etaMinutes} min.`,
  };
}
