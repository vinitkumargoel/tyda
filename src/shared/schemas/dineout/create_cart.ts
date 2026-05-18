import { z } from "zod";

export const createCartInput = z.object({
  restaurantId: z.string().describe("Restaurant ID"),
  cartType: z
    .string()
    .describe(
      "Cart type: DEAL_TICKET_PURCHASE for booking, DINEOUT for bill payment",
    ),
  latitude: z.number().describe("Latitude"),
  longitude: z.number().describe("Longitude"),
  slotId: z
    .number()
    .optional()
    .describe("Slot ID (required for booking cart)"),
  itemId: z
    .string()
    .optional()
    .describe(
      'Item ID (required for booking cart, format: "restaurantId-ticketId")',
    ),
  reservationTime: z
    .number()
    .optional()
    .describe("Unix timestamp (required for booking cart)"),
  guestCount: z
    .number()
    .optional()
    .describe("Number of guests (required for booking cart, 1-20)"),
  billAmount: z
    .number()
    .optional()
    .describe("Bill amount in rupees (required for bill payment cart)"),
  source: z
    .string()
    .optional()
    .describe(
      'Source for bill payment cart (default: "direct-payment-cart")',
    ),
});

export const createCartOutput = z
  .object({})
  .describe(
    "Tool-specific payload: cart created for booking or bill payment.",
  );
