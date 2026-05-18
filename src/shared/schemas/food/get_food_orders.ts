import { z } from "zod";

export const getFoodOrdersInput = z.object({
  orderCount: z
    .number()
    .optional()
    .describe("Number of orders to fetch (default: 5, max: 20)"),
  addressId: z
    .string()
    .describe(
      "Address ID to use for fetching orders (can be obtained from get_addresses)",
    ),
});

export const getFoodOrdersOutput = z
  .object({})
  .describe("Tool-specific payload: active food orders and their statuses.");
