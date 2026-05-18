import { z } from "zod";

export const searchRestaurantsInput = z.object({
  addressId: z.string().describe("Address ID from get_addresses tool"),
  query: z.string().describe("Search query (restaurant name or cuisine)"),
  offset: z
    .number()
    .optional()
    .describe(
      "Pagination offset. Use nextOffset from previous response to load more results. Default: 0.",
    ),
});

export const searchRestaurantsOutput = z
  .object({})
  .describe("Tool-specific payload: restaurant search results.");
