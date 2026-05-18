import { z } from "zod";

export const createAddressInput = z.object({
  fullAddress: z.string().describe("Complete address as provided by the user"),
  addressLine: z
    .string()
    .describe("Main street/building/house number (REQUIRED)"),
  addressLine2: z
    .string()
    .describe(
      'Apartment, floor, wing, or additional details (REQUIRED - extract from full address, use empty string "" if not found)',
    ),
  locality: z
    .string()
    .optional()
    .describe("Area, neighborhood, or locality name (optional)"),
  city: z.string().describe("City name (REQUIRED)"),
  postalCode: z.string().describe("Postal/ZIP code (REQUIRED)"),
  latitude: z.number().describe("Latitude coordinate of the address (REQUIRED)"),
  longitude: z
    .number()
    .describe("Longitude coordinate of the address (REQUIRED)"),
  addressCategory: z
    .string()
    .describe(
      "Type of address: HOME, WORK, OFFICE, FRIENDS_AND_FAMILY, or OTHER (REQUIRED)",
    ),
  addressTag: z
    .string()
    .optional()
    .describe(
      'Friendly name/label for the address (e.g., "My Home", "Office", "Mom\'s Place") (optional)',
    ),
  userName: z
    .string()
    .describe("Account holder name (authenticated user) (REQUIRED)"),
  userPhone: z
    .string()
    .describe("Account holder phone number (authenticated user) (REQUIRED)"),
  receiverName: z
    .string()
    .optional()
    .describe("Receiver name if delivering to someone else (optional)"),
  receiverPhone: z
    .string()
    .optional()
    .describe("Receiver phone if delivering to someone else (optional)"),
});

export const createAddressOutput = z
  .object({})
  .describe("Tool-specific payload: confirmation and new address record.");
