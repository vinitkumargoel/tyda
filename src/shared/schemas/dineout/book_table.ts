import { z } from "zod";

export const bookTableInput = z.object({
  restaurantId: z.string().describe("Restaurant ID"),
  slotId: z
    .number()
    .describe("Slot ID from selected slot (slot.deals[].slotId)"),
  itemId: z
    .string()
    .describe(
      'Deal/ticket item ID (slot.deals[].itemId, format: "restaurantId-ticketId")',
    ),
  reservationTime: z
    .number()
    .describe("Unix timestamp from selected slot (slot.reservationTime)"),
  guestCount: z.number().describe("Number of guests (1-20)"),
  latitude: z.number().describe("Latitude from user address"),
  longitude: z.number().describe("Longitude from user address"),
});

export const bookTableOutput = z
  .object({})
  .describe(
    "Tool-specific payload: booking confirmation including order ID.",
  );
