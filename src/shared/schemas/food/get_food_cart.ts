import { z } from "zod";

export const getFoodCartInput = z.object({
  addressId: z
    .string()
    .describe(
      "Address ID to get accurate delivery charges based on location.",
    ),
  restaurantName: z
    .string()
    .optional()
    .describe(
      "Restaurant name from search_restaurants or search_menu results. Pass this so the cart widget can display the restaurant name (the cart API does not always return it).",
    ),
});

export const getFoodCartOutput = z
  .object({})
  .describe(
    "Tool-specific payload: cart contents including valid_addons and available payment methods.",
  );
