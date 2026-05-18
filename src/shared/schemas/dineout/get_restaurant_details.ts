import { z } from "zod";

export const getRestaurantDetailsInput = z.object({
  restaurantId: z.string().describe("Restaurant ID from search results"),
  latitude: z.number().describe("Latitude (use same as search)"),
  longitude: z.number().describe("Longitude (use same as search)"),
});

export const getRestaurantDetailsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: restaurant details including ratings, deals, timings, and address.",
  );
