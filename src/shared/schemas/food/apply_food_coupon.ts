import { z } from "zod";

export const applyFoodCouponInput = z.object({
  couponCode: z.string().describe("Coupon code to apply"),
  addressId: z
    .string()
    .describe(
      "Address ID where the order will be delivered (coordinates will be fetched automatically)",
    ),
  cartId: z.string().optional().describe("Optional cart ID"),
});

export const applyFoodCouponOutput = z
  .object({})
  .describe(
    "Tool-specific payload: updated cart with coupon applied, pricing, and savings.",
  );
