import { z } from "zod";

export const fetchFoodCouponsInput = z.object({
  restaurantId: z.string().describe("Restaurant ID for the cart"),
  addressId: z
    .string()
    .describe(
      "Address ID where the order will be delivered (coordinates will be fetched automatically)",
    ),
  couponCode: z
    .string()
    .optional()
    .describe("Optional coupon code to check applicability of a specific coupon"),
});

export const fetchFoodCouponsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: available coupons and offers with applicability and discount details.",
  );
