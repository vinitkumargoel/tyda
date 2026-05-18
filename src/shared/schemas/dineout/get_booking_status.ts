import { z } from "zod";

export const getBookingStatusInput = z.object({
  orderId: z.string().describe("Order ID from booking confirmation"),
});

export const getBookingStatusOutput = z
  .object({})
  .describe(
    "Tool-specific payload: booking status including restaurant, date, time, guests, deal, and status.",
  );
