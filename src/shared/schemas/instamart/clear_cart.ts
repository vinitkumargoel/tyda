import { z } from "zod";

export const clearCartInput = z.object({});

export const clearCartOutput = z
  .object({})
  .describe("Tool-specific payload: confirmation that the cart was cleared.");
