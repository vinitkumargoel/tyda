import { z } from "zod";

export const getAvailableSlotsInput = z.object({
  restaurantId: z.string().describe("Restaurant ID from search or details"),
  date: z
    .string()
    .describe(
      'Starting date as YYYY-MM-DD string (e.g., "2025-11-20") or epoch timestamp as numeric string. Returns slots for up to 7 days from this date.',
    ),
  latitude: z.number().describe("User's latitude"),
  longitude: z.number().describe("User's longitude"),
});

export const getAvailableSlotsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: available slots across up to 7 days with deals (free and paid).",
  );
