import { z } from "zod";

export const getRestaurantMenuInput = z.object({
  addressId: z.string().describe("Address ID from get_addresses tool"),
  restaurantId: z
    .string()
    .describe("Restaurant ID to fetch menu for (from search_restaurants)"),
  page: z
    .number()
    .optional()
    .describe("Page number for pagination (default: 1)"),
  pageSize: z
    .number()
    .optional()
    .describe("Number of categories per page (default: 5, max: 8)"),
});

export const getRestaurantMenuOutput = z
  .object({})
  .describe("Tool-specific payload: paginated restaurant menu by category.");
