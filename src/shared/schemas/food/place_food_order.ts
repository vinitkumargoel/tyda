import { z } from "zod";

export const placeFoodOrderInput = z.object({
  addressId: z
    .string()
    .describe(
      "Address ID from the user's saved addresses (coordinates will be fetched automatically)",
    ),
  paymentMethod: z
    .string()
    .optional()
    .describe(
      "Payment method to use. Check availablePaymentMethods from get_food_cart response. Auto-defaults to the user's available payment method if not specified.",
    ),
});

export const placeFoodOrderOutput = z
  .object({})
  .describe("Tool-specific payload: placed order confirmation details.");
