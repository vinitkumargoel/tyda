import { z } from "zod";

export const getFoodOrderDetailsInput = z.object({
  orderId: z
    .string()
    .describe(
      "Order ID to fetch details for (can be obtained from get_food_orders)",
    ),
});

export const getFoodOrderDetailsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: comprehensive order details including items, pricing, address, payment, and status.",
  );
