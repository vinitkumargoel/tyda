import { z } from "zod";

export const getCartInput = z.object({});

export const getCartOutput = z
  .object({})
  .describe(
    "Tool-specific payload: Instamart cart contents, bill breakdown, and available payment methods.",
  );
