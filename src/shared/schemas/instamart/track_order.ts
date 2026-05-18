import { z } from "zod";

export const trackOrderInput = z.object({
  orderId: z
    .string()
    .describe(
      "The order ID to track (required). Can be obtained from get_orders tool.",
    ),
  lat: z
    .number()
    .describe("Latitude of the delivery address (required for accurate tracking)"),
  lng: z
    .number()
    .describe("Longitude of the delivery address (required for accurate tracking)"),
});

export const trackOrderOutput = z
  .object({})
  .describe(
    "Tool-specific payload: real-time tracking info, ETA, partner location, items, and payment.",
  );
