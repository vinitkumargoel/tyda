import { z } from "zod";

export const yourGoToItemsInput = z.object({
  addressId: z.string().describe("Address ID from get_addresses tool"),
  offset: z
    .number()
    .optional()
    .describe("Pagination offset (default: 0)"),
});

export const yourGoToItemsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: frequently or recently ordered items with variants.",
  );
