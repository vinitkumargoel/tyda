import { z } from "zod";

export const searchMenuInput = z.object({
  addressId: z.string().describe("Address ID from get_addresses tool"),
  query: z.string().describe("Search query (dish name)"),
  restaurantIdOfAddedItem: z
    .string()
    .optional()
    .describe("Optional restaurant ID to scope search"),
  vegFilter: z
    .number()
    .optional()
    .describe(
      "Veg filter flag (0 or 1). Pass 1 for veg-only items. 0 or omitted returns mixed veg + non-veg.",
    ),
  offset: z
    .number()
    .optional()
    .describe(
      "Pagination offset. Use nextOffset from previous response to load more results. Default: 0.",
    ),
});

export const searchMenuOutput = z
  .object({})
  .describe("Tool-specific payload: menu search results with customizations.");
