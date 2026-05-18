import { z } from "zod";

export const updateCartInput = z.object({
  selectedAddressId: z
    .string()
    .describe("Selected delivery address ID from get_addresses tool"),
  items: z.array(z.object({})).describe("Array of items to add to cart"),
});

export const updateCartOutput = z
  .object({})
  .describe("Tool-specific payload: updated cart contents.");
