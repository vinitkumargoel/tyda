import { z } from "zod";

export const checkoutInput = z.object({
  addressId: z
    .string()
    .describe(
      "Delivery address ID (from get_addresses - user must have selected this address)",
    ),
  paymentMethod: z
    .string()
    .optional()
    .describe(
      "Payment method to use. Check availablePaymentMethods from get_cart response. Auto-defaults to the user's available payment method if not specified.",
    ),
});

export const checkoutOutput = z
  .object({})
  .describe(
    "Tool-specific payload: order placement result(s). May include per-store results for multi-store carts.",
  );
