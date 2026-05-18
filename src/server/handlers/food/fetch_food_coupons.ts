/**
 * fetch_food_coupons — return all Food-scope coupons.
 *
 * Optionally filtered down to a single coupon code (the schema also takes a
 * restaurantId; the mock makes all food coupons available at every
 * restaurant, since the fixture data does not encode per-restaurant scoping).
 */
import type { HandlerContext } from "./_types.js";
import { loadCoupons, type CouponFixture } from "./_helpers.js";

interface Input {
  restaurantId?: string;
  addressId?: string;
  couponCode?: string;
}

interface CouponSummary {
  code: string;
  title: string;
  description: string;
  discountType: "flat" | "percent";
  amount: number;
  minOrderValue: number;
  maxDiscount: number | null;
  appliesToCategory?: string;
}

export interface FetchFoodCouponsOutput {
  success: true;
  data: { coupons: CouponSummary[] };
}

function summarize(c: CouponFixture): CouponSummary {
  const out: CouponSummary = {
    code: c.code,
    title: c.title,
    description: c.description,
    discountType: c.discountType,
    amount: c.amount,
    minOrderValue: c.minOrderValue,
    maxDiscount: c.maxDiscount,
  };
  if (c.appliesTo?.category) out.appliesToCategory = c.appliesTo.category;
  return out;
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<FetchFoodCouponsOutput> {
  const all = await loadCoupons();
  let list = all.filter((c) => c.scope === "food" && c.active);
  if (input.couponCode) {
    list = list.filter((c) => c.code.toLowerCase() === input.couponCode!.toLowerCase());
  }
  return {
    success: true,
    data: { coupons: list.map(summarize) },
  };
}
