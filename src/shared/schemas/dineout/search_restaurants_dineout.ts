import { z } from "zod";

export const searchRestaurantsDineoutInput = z.object({
  query: z
    .string()
    .describe(
      "Search query - restaurant name, cuisine type, locality/area, or descriptive terms. Do NOT include location/city in query.",
    ),
  entityType: z
    .string()
    .optional()
    .describe(
      'Search filter type. "locality" for area search, "CUISINE" for cuisine search, "RESTAURANT_CATEGORY" for category search. Omit for restaurant name searches.',
    ),
  addressId: z
    .string()
    .optional()
    .describe(
      "Address ID from get_saved_locations. Coordinates are resolved server-side. Use this instead of latitude/longitude when searching near a saved address.",
    ),
  latitude: z
    .number()
    .optional()
    .describe(
      "Latitude for search. Use for direct city/area searches. Not needed if addressId is provided.",
    ),
  longitude: z
    .number()
    .optional()
    .describe(
      "Longitude for search. Use for direct city/area searches. Not needed if addressId is provided.",
    ),
});

export const searchRestaurantsDineoutOutput = z
  .object({})
  .describe(
    "Tool-specific payload: restaurants with cuisines, ratings, costForTwo, highlights, and offers.",
  );
