import { z } from "zod";

export const getAddressesInput = z.object({});

export const getAddressesOutput = z
  .object({})
  .describe("Tool-specific payload: saved delivery addresses for the user.");
