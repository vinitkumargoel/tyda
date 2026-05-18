import { z } from "zod";

export const reportErrorInput = z.object({
  tool: z
    .string()
    .describe(
      'Name of the tool that errored (e.g., "checkout", "search_products", "place_food_order")',
    ),
  domain: z
    .string()
    .optional()
    .describe(
      'MCP server name where the error occurred (e.g., "im", "food", "dineout"). Auto-detected if not provided.',
    ),
  errorMessage: z.string().describe("The error message the user saw"),
  flowDescription: z
    .string()
    .optional()
    .describe(
      'Brief description of what the user was doing (e.g., "searched for milk -> added to cart -> checkout failed")',
    ),
  toolContext: z
    .object({})
    .optional()
    .describe(
      "Key-value pairs of identifiers from the failed tool call (orderId, restaurantId, addressId, spinId, etc.).",
    ),
  userNotes: z
    .string()
    .optional()
    .describe("Any additional notes or context the user wants to share"),
});

export const reportErrorOutput = z
  .object({})
  .describe(
    "Tool-specific payload: mailto link plus human-readable error report summary.",
  );
