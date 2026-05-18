import { z } from "zod";

export const updateFoodCartInput = z.object({
  restaurantId: z.string().describe("Restaurant ID for the cart"),
  cartItems: z
    .array(z.object({}))
    .describe("Array of items to add to cart with their customizations"),
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

export const updateFoodCartOutput = z
  .object({})
  .describe("Tool-specific payload: updated cart state.");
