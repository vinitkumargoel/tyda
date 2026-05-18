import { z } from "zod";

export const getSavedLocationsInput = z.object({});

export const getSavedLocationsOutput = z
  .object({})
  .describe(
    "Tool-specific payload: list of saved addresses (index, id, addressLine).",
  );
