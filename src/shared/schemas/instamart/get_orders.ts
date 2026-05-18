import { z } from "zod";

export const getOrdersInput = z.object({
  count: z
    .number()
    .optional()
    .describe("Number of orders to fetch (default: 10, max recommended: 20)"),
  orderType: z
    .string()
    .optional()
    .describe('Order type filter (e.g., "DASH", "INSTAMART"). Default: "DASH"'),
  activeOnly: z
    .boolean()
    .optional()
    .describe(
      "Set to true to filter only active/ongoing orders. Default: false (returns all orders)",
    ),
});

export const getOrdersOutput = z
  .object({})
  .describe(
    "Tool-specific payload: Instamart order history with items, status, and delivery info.",
  );
