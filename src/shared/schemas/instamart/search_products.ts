import { z } from "zod";

export const searchProductsInput = z.object({
  addressId: z.string().describe("Address ID from get_addresses tool"),
  query: z
    .string()
    .describe("Search query (product name, category, or brand)"),
  offset: z
    .number()
    .optional()
    .describe("Pagination offset (default: 0)"),
});

export const searchProductsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: product search results with variants and spinIds.",
  );
