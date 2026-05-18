import { z } from "zod";

// Food schemas
import {
  getAddressesInput as foodGetAddressesInput,
  getAddressesOutput as foodGetAddressesOutput,
} from "./schemas/food/get_addresses.js";
import {
  searchRestaurantsInput,
  searchRestaurantsOutput,
} from "./schemas/food/search_restaurants.js";
import {
  searchMenuInput,
  searchMenuOutput,
} from "./schemas/food/search_menu.js";
import {
  getRestaurantMenuInput,
  getRestaurantMenuOutput,
} from "./schemas/food/get_restaurant_menu.js";
import {
  fetchFoodCouponsInput,
  fetchFoodCouponsOutput,
} from "./schemas/food/fetch_food_coupons.js";
import {
  applyFoodCouponInput,
  applyFoodCouponOutput,
} from "./schemas/food/apply_food_coupon.js";
import {
  getFoodCartInput,
  getFoodCartOutput,
} from "./schemas/food/get_food_cart.js";
import {
  updateFoodCartInput,
  updateFoodCartOutput,
} from "./schemas/food/update_food_cart.js";
import {
  flushFoodCartInput,
  flushFoodCartOutput,
} from "./schemas/food/flush_food_cart.js";
import {
  placeFoodOrderInput,
  placeFoodOrderOutput,
} from "./schemas/food/place_food_order.js";
import {
  getFoodOrdersInput,
  getFoodOrdersOutput,
} from "./schemas/food/get_food_orders.js";
import {
  getFoodOrderDetailsInput,
  getFoodOrderDetailsOutput,
} from "./schemas/food/get_food_order_details.js";
import {
  trackFoodOrderInput,
  trackFoodOrderOutput,
} from "./schemas/food/track_food_order.js";
import {
  reportErrorInput as foodReportErrorInput,
  reportErrorOutput as foodReportErrorOutput,
} from "./schemas/food/report_error.js";

// Instamart schemas
import {
  getAddressesInput as imGetAddressesInput,
  getAddressesOutput as imGetAddressesOutput,
} from "./schemas/instamart/get_addresses.js";
import {
  createAddressInput,
  createAddressOutput,
} from "./schemas/instamart/create_address.js";
import {
  deleteAddressInput,
  deleteAddressOutput,
} from "./schemas/instamart/delete_address.js";
import {
  searchProductsInput,
  searchProductsOutput,
} from "./schemas/instamart/search_products.js";
import {
  yourGoToItemsInput,
  yourGoToItemsOutput,
} from "./schemas/instamart/your_go_to_items.js";
import {
  getCartInput,
  getCartOutput,
} from "./schemas/instamart/get_cart.js";
import {
  updateCartInput,
  updateCartOutput,
} from "./schemas/instamart/update_cart.js";
import {
  clearCartInput,
  clearCartOutput,
} from "./schemas/instamart/clear_cart.js";
import {
  checkoutInput,
  checkoutOutput,
} from "./schemas/instamart/checkout.js";
import {
  getOrdersInput,
  getOrdersOutput,
} from "./schemas/instamart/get_orders.js";
import {
  getOrderDetailsInput,
  getOrderDetailsOutput,
} from "./schemas/instamart/get_order_details.js";
import {
  trackOrderInput,
  trackOrderOutput,
} from "./schemas/instamart/track_order.js";
import {
  reportErrorInput as imReportErrorInput,
  reportErrorOutput as imReportErrorOutput,
} from "./schemas/instamart/report_error.js";

// Dineout schemas
import {
  getSavedLocationsInput,
  getSavedLocationsOutput,
} from "./schemas/dineout/get_saved_locations.js";
import {
  searchRestaurantsDineoutInput,
  searchRestaurantsDineoutOutput,
} from "./schemas/dineout/search_restaurants_dineout.js";
import {
  getRestaurantDetailsInput,
  getRestaurantDetailsOutput,
} from "./schemas/dineout/get_restaurant_details.js";
import {
  getAvailableSlotsInput,
  getAvailableSlotsOutput,
} from "./schemas/dineout/get_available_slots.js";
import {
  createCartInput,
  createCartOutput,
} from "./schemas/dineout/create_cart.js";
import {
  bookTableInput,
  bookTableOutput,
} from "./schemas/dineout/book_table.js";
import {
  getBookingStatusInput,
  getBookingStatusOutput,
} from "./schemas/dineout/get_booking_status.js";
import {
  reportErrorInput as dineoutReportErrorInput,
  reportErrorOutput as dineoutReportErrorOutput,
} from "./schemas/dineout/report_error.js";

export type ServerKey = "food" | "instamart" | "dineout";

export type ToolDef = {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
};

export const ALL_TOOLS: Record<ServerKey, ToolDef[]> = {
  food: [
    {
      name: "get_addresses",
      description:
        "Swiggy (Instamart/Food): Get all saved delivery addresses for the authenticated Swiggy user, sorted by last order date.",
      mutating: false,
      inputSchema: foodGetAddressesInput,
      outputSchema: foodGetAddressesOutput,
    },
    {
      name: "search_restaurants",
      description:
        "Search and order food from restaurants for delivery. Use the preferred addressId from get_addresses.",
      mutating: false,
      inputSchema: searchRestaurantsInput,
      outputSchema: searchRestaurantsOutput,
    },
    {
      name: "search_menu",
      description:
        "Search for dishes and menu items to order for food delivery. Returns items with their customizations (variants and addons).",
      mutating: false,
      inputSchema: searchMenuInput,
      outputSchema: searchMenuOutput,
    },
    {
      name: "get_restaurant_menu",
      description:
        "Get the complete menu of a restaurant, paginated by category. Use this to BROWSE a restaurant menu.",
      mutating: false,
      inputSchema: getRestaurantMenuInput,
      outputSchema: getRestaurantMenuOutput,
    },
    {
      name: "fetch_food_coupons",
      description:
        "Get available coupons and offers for a food delivery order, including applicability and discount details.",
      mutating: false,
      inputSchema: fetchFoodCouponsInput,
      outputSchema: fetchFoodCouponsOutput,
    },
    {
      name: "apply_food_coupon",
      description:
        "Apply a coupon code or discount to the food delivery cart and return the updated pricing.",
      mutating: true,
      inputSchema: applyFoodCouponInput,
      outputSchema: applyFoodCouponOutput,
    },
    {
      name: "get_food_cart",
      description:
        "Get the current food delivery cart with items, valid_addons per item, and available payment methods.",
      mutating: false,
      inputSchema: getFoodCartInput,
      outputSchema: getFoodCartOutput,
    },
    {
      name: "update_food_cart",
      description:
        "Add items to the food delivery cart or update cart contents, supporting variants, variantsV2, and addons.",
      mutating: true,
      inputSchema: updateFoodCartInput,
      outputSchema: updateFoodCartOutput,
    },
    {
      name: "flush_food_cart",
      description: "Clear or empty the food delivery cart.",
      mutating: true,
      inputSchema: flushFoodCartInput,
      outputSchema: flushFoodCartOutput,
    },
    {
      name: "place_food_order",
      description:
        "Place a food delivery order and confirm order placement. Requires explicit user confirmation.",
      mutating: true,
      inputSchema: placeFoodOrderInput,
      outputSchema: placeFoodOrderOutput,
    },
    {
      name: "get_food_orders",
      description:
        "Get active food delivery orders and order statuses for the user.",
      mutating: false,
      inputSchema: getFoodOrdersInput,
      outputSchema: getFoodOrdersOutput,
    },
    {
      name: "get_food_order_details",
      description:
        "Get detailed information about a specific food delivery order, including items, pricing, address, payment, and status.",
      mutating: false,
      inputSchema: getFoodOrderDetailsInput,
      outputSchema: getFoodOrderDetailsOutput,
    },
    {
      name: "track_food_order",
      description:
        "Track food delivery order status and delivery progress. Returns ETA and current status.",
      mutating: false,
      inputSchema: trackFoodOrderInput,
      outputSchema: trackFoodOrderOutput,
    },
    {
      name: "report_error",
      description:
        "Generate an error report (mailto link plus server-side log) to share with the Swiggy MCP team.",
      mutating: true,
      inputSchema: foodReportErrorInput,
      outputSchema: foodReportErrorOutput,
    },
  ],
  instamart: [
    {
      name: "get_addresses",
      description:
        "Swiggy (Instamart/Food): Get all saved delivery addresses for the authenticated Swiggy user, sorted by last order date.",
      mutating: false,
      inputSchema: imGetAddressesInput,
      outputSchema: imGetAddressesOutput,
    },
    {
      name: "create_address",
      description:
        "Swiggy (Instamart/Food): Create a new delivery address for the authenticated user.",
      mutating: true,
      inputSchema: createAddressInput,
      outputSchema: createAddressOutput,
    },
    {
      name: "delete_address",
      description:
        "Swiggy (Instamart/Food): Delete a saved delivery address for the authenticated user.",
      mutating: true,
      inputSchema: deleteAddressInput,
      outputSchema: deleteAddressOutput,
    },
    {
      name: "search_products",
      description:
        "Search for Instamart products available at the selected address. Returns products with their variants and spinIds.",
      mutating: false,
      inputSchema: searchProductsInput,
      outputSchema: searchProductsOutput,
    },
    {
      name: "your_go_to_items",
      description:
        "Fetch the user's Your Go To Items (frequently or recently ordered items) for the selected delivery address.",
      mutating: false,
      inputSchema: yourGoToItemsInput,
      outputSchema: yourGoToItemsOutput,
    },
    {
      name: "get_cart",
      description:
        "Swiggy Instamart (Grocery): Get current Instamart grocery cart with all items and bill breakdown.",
      mutating: false,
      inputSchema: getCartInput,
      outputSchema: getCartOutput,
    },
    {
      name: "update_cart",
      description:
        "Swiggy Instamart (Grocery): Update Instamart grocery cart with items. Replaces entire cart with the provided items.",
      mutating: true,
      inputSchema: updateCartInput,
      outputSchema: updateCartOutput,
    },
    {
      name: "clear_cart",
      description: "Clear (remove all items from) the Instamart cart.",
      mutating: true,
      inputSchema: clearCartInput,
      outputSchema: clearCartOutput,
    },
    {
      name: "checkout",
      description:
        "Swiggy Instamart (Grocery): Place and confirm Instamart grocery order in a single operation.",
      mutating: true,
      inputSchema: checkoutInput,
      outputSchema: checkoutOutput,
    },
    {
      name: "get_orders",
      description:
        "Swiggy Instamart order history - fetch past or active orders from the last 15 days.",
      mutating: false,
      inputSchema: getOrdersInput,
      outputSchema: getOrdersOutput,
    },
    {
      name: "get_order_details",
      description:
        "Get detailed information for a specific Swiggy Instamart order by order ID.",
      mutating: false,
      inputSchema: getOrderDetailsInput,
      outputSchema: getOrderDetailsOutput,
    },
    {
      name: "track_order",
      description:
        "Track Swiggy Instamart order status in real-time including ETA, partner location, and items.",
      mutating: false,
      inputSchema: trackOrderInput,
      outputSchema: trackOrderOutput,
    },
    {
      name: "report_error",
      description:
        "Generate an error report (mailto link plus server-side log) to share with the Swiggy MCP team.",
      mutating: true,
      inputSchema: imReportErrorInput,
      outputSchema: imReportErrorOutput,
    },
  ],
  dineout: [
    {
      name: "get_saved_locations",
      description:
        "Swiggy Dineout: Get user's saved addresses for restaurant search.",
      mutating: false,
      inputSchema: getSavedLocationsInput,
      outputSchema: getSavedLocationsOutput,
    },
    {
      name: "search_restaurants_dineout",
      description:
        "Swiggy Dineout: Search restaurants for table booking/reservations. Returns cuisines, ratings, costForTwo, highlights, and offers.",
      mutating: false,
      inputSchema: searchRestaurantsDineoutInput,
      outputSchema: searchRestaurantsDineoutOutput,
    },
    {
      name: "get_restaurant_details",
      description:
        "Swiggy Dineout: Get details about a specific restaurant for table booking - ratings, deals, timings, address.",
      mutating: false,
      inputSchema: getRestaurantDetailsInput,
      outputSchema: getRestaurantDetailsOutput,
    },
    {
      name: "get_available_slots",
      description:
        "Swiggy Dineout (Reservations): Check available time slots for table booking. Returns slots across up to 7 days.",
      mutating: false,
      inputSchema: getAvailableSlotsInput,
      outputSchema: getAvailableSlotsOutput,
    },
    {
      name: "create_cart",
      description:
        "Swiggy Dineout: Create a cart for table booking or bill payment.",
      mutating: true,
      inputSchema: createCartInput,
      outputSchema: createCartOutput,
    },
    {
      name: "book_table",
      description:
        "Swiggy Dineout (Reservations): Book a table at a restaurant for a specific time slot. Free reservations only.",
      mutating: true,
      inputSchema: bookTableInput,
      outputSchema: bookTableOutput,
    },
    {
      name: "get_booking_status",
      description:
        "Get booking status and details for a Swiggy Dineout order.",
      mutating: false,
      inputSchema: getBookingStatusInput,
      outputSchema: getBookingStatusOutput,
    },
    {
      name: "report_error",
      description:
        "Generate an error report (mailto link plus server-side log) to share with the Swiggy MCP team.",
      mutating: true,
      inputSchema: dineoutReportErrorInput,
      outputSchema: dineoutReportErrorOutput,
    },
  ],
};
