import { z } from "zod";

export const deleteAddressInput = z.object({
  addressId: z
    .string()
    .describe("The ID of the address to delete (from get_addresses response)"),
});

export const deleteAddressOutput = z
  .object({})
  .describe("Tool-specific payload: confirmation of deletion.");
