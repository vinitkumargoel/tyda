import { z } from "zod";

export const flushFoodCartInput = z.object({});

export const flushFoodCartOutput = z
  .object({})
  .describe("Tool-specific payload: confirmation that the cart was cleared.");
