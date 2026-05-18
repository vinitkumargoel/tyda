import { z } from "zod";

export const getOrderDetailsInput = z.object({
  orderId: z
    .string()
    .describe(
      "The order ID to fetch details for (required). Can be obtained from get_orders tool.",
    ),
});

export const getOrderDetailsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: detailed order info including items, bill breakdown, status, and refunds.",
  );
