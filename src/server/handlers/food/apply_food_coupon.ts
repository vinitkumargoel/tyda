/**
 * apply_food_coupon — apply a coupon to the active food cart.
 *
 * Validates the coupon against the active cart (must exist, must meet
 * minOrderValue, and BIRYANI20-style category gates). Mutates the stored cart
 * to attach `appliedCoupon` + recompute `discount` and `total`.
 */
import { mutate } from "../../store.js";
import type { HandlerContext, FoodCart } from "./_types.js";
import {
  activeCart,
  computeTotals,
  evaluateCoupon,
  loadCoupons,
} from "./_helpers.js";

interface Input {
  couponCode: string;
  addressId?: string;
  cartId?: string;
}

export interface ApplyFoodCouponOutput {
  success: boolean;
  data?: { cart: FoodCart };
  message?: string;
  error?: { code?: string; message: string };
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<ApplyFoodCouponOutput> {
  const coupons = await loadCoupons();
  const coupon = coupons.find(
    (c) => c.code.toLowerCase() === input.couponCode.toLowerCase(),
  );
  if (!coupon || coupon.scope !== "food" || !coupon.active) {
    return {
      success: false,
      error: { code: "COUPON_NOT_FOUND", message: `Unknown coupon: ${input.couponCode}` },
    };
  }

  let result: ApplyFoodCouponOutput | null = null;
  await mutate((s) => {
    const cart = activeCart(s.carts.food);
    if (!cart) {
      result = {
        success: false,
        error: { code: "NO_ACTIVE_CART", message: "No active food cart to apply coupon to." },
      };
      return;
    }
    const evaluated = evaluateCoupon(cart, coupon);
    if (!evaluated) {
      result = {
        success: false,
        error: {
          code: "COUPON_NOT_APPLICABLE",
          message: `Coupon ${coupon.code} is not applicable to this cart.`,
        },
      };
      return;
    }
    cart.appliedCoupon = evaluated.applied;
    const totals = computeTotals(cart.items, evaluated.discount);
    cart.subtotal = totals.subtotal;
    cart.deliveryFee = totals.deliveryFee;
    cart.platformFee = totals.platformFee;
    cart.discount = totals.discount;
    cart.total = totals.total;
    cart.updatedAt = new Date().toISOString();
    s.carts.food[cart.restaurantId] = cart;
    result = {
      success: true,
      data: { cart },
      message: `Applied ${coupon.code}: saved ₹${evaluated.discount}.`,
    };
  });

  return (
    result ?? {
      success: false,
      error: { message: "Unknown failure applying coupon." },
    }
  );
}
