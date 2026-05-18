import { z } from "zod";

export const trackFoodOrderInput = z.object({
  orderId: z
    .string()
    .optional()
    .describe(
      "Optional: Specific order ID to track. If not provided, returns all active orders.",
    ),
});

export const trackFoodOrderOutput = z
  .object({})
  .describe(
    "Tool-specific payload: current status, ETA, and delivery progress for the order(s).",
  );
