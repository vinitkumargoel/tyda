import { z } from "zod";

export const updateCartInput = z.object({
  selectedAddressId: z
    .string()
    .describe("Selected delivery address ID from get_addresses tool"),
  items: z
    .array(
      z.object({
        spinId: z.string().describe("Product spin/variant ID"),
        quantity: z.number().int().nonnegative().describe("Quantity; 0 removes the item"),
      }),
    )
    .describe("Array of items to add to cart"),
});

export const updateCartOutput = z
  .object({})
  .describe("Tool-specific payload: updated cart contents.");
