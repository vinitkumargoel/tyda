import type { z } from "zod";

// Food
import type {
  getAddressesInput as foodGetAddressesInput,
  getAddressesOutput as foodGetAddressesOutput,
} from "./schemas/food/get_addresses.js";
import type {
  searchRestaurantsInput,
  searchRestaurantsOutput,
} from "./schemas/food/search_restaurants.js";
import type {
  searchMenuInput,
  searchMenuOutput,
} from "./schemas/food/search_menu.js";
import type {
  getRestaurantMenuInput,
  getRestaurantMenuOutput,
} from "./schemas/food/get_restaurant_menu.js";
import type {
  fetchFoodCouponsInput,
  fetchFoodCouponsOutput,
} from "./schemas/food/fetch_food_coupons.js";
import type {
  applyFoodCouponInput,
  applyFoodCouponOutput,
} from "./schemas/food/apply_food_coupon.js";
import type {
  getFoodCartInput,
  getFoodCartOutput,
} from "./schemas/food/get_food_cart.js";
import type {
  updateFoodCartInput,
  updateFoodCartOutput,
} from "./schemas/food/update_food_cart.js";
import type {
  flushFoodCartInput,
  flushFoodCartOutput,
} from "./schemas/food/flush_food_cart.js";
import type {
  placeFoodOrderInput,
  placeFoodOrderOutput,
} from "./schemas/food/place_food_order.js";
import type {
  getFoodOrdersInput,
  getFoodOrdersOutput,
} from "./schemas/food/get_food_orders.js";
import type {
  getFoodOrderDetailsInput,
  getFoodOrderDetailsOutput,
} from "./schemas/food/get_food_order_details.js";
import type {
  trackFoodOrderInput,
  trackFoodOrderOutput,
} from "./schemas/food/track_food_order.js";
import type {
  reportErrorInput as foodReportErrorInput,
  reportErrorOutput as foodReportErrorOutput,
} from "./schemas/food/report_error.js";

// Instamart
import type {
  getAddressesInput as imGetAddressesInput,
  getAddressesOutput as imGetAddressesOutput,
} from "./schemas/instamart/get_addresses.js";
import type {
  createAddressInput,
  createAddressOutput,
} from "./schemas/instamart/create_address.js";
import type {
  deleteAddressInput,
  deleteAddressOutput,
} from "./schemas/instamart/delete_address.js";
import type {
  searchProductsInput,
  searchProductsOutput,
} from "./schemas/instamart/search_products.js";
import type {
  yourGoToItemsInput,
  yourGoToItemsOutput,
} from "./schemas/instamart/your_go_to_items.js";
import type {
  getCartInput,
  getCartOutput,
} from "./schemas/instamart/get_cart.js";
import type {
  updateCartInput,
  updateCartOutput,
} from "./schemas/instamart/update_cart.js";
import type {
  clearCartInput,
  clearCartOutput,
} from "./schemas/instamart/clear_cart.js";
import type {
  checkoutInput,
  checkoutOutput,
} from "./schemas/instamart/checkout.js";
import type {
  getOrdersInput,
  getOrdersOutput,
} from "./schemas/instamart/get_orders.js";
import type {
  getOrderDetailsInput,
  getOrderDetailsOutput,
} from "./schemas/instamart/get_order_details.js";
import type {
  trackOrderInput,
  trackOrderOutput,
} from "./schemas/instamart/track_order.js";
import type {
  reportErrorInput as imReportErrorInput,
  reportErrorOutput as imReportErrorOutput,
} from "./schemas/instamart/report_error.js";

// Dineout
import type {
  getSavedLocationsInput,
  getSavedLocationsOutput,
} from "./schemas/dineout/get_saved_locations.js";
import type {
  searchRestaurantsDineoutInput,
  searchRestaurantsDineoutOutput,
} from "./schemas/dineout/search_restaurants_dineout.js";
import type {
  getRestaurantDetailsInput,
  getRestaurantDetailsOutput,
} from "./schemas/dineout/get_restaurant_details.js";
import type {
  getAvailableSlotsInput,
  getAvailableSlotsOutput,
} from "./schemas/dineout/get_available_slots.js";
import type {
  createCartInput,
  createCartOutput,
} from "./schemas/dineout/create_cart.js";
import type {
  bookTableInput,
  bookTableOutput,
} from "./schemas/dineout/book_table.js";
import type {
  getBookingStatusInput,
  getBookingStatusOutput,
} from "./schemas/dineout/get_booking_status.js";
import type {
  reportErrorInput as dineoutReportErrorInput,
  reportErrorOutput as dineoutReportErrorOutput,
} from "./schemas/dineout/report_error.js";

// Food types
export type FoodGetAddressesInput = z.infer<typeof foodGetAddressesInput>;
export type FoodGetAddressesOutput = z.infer<typeof foodGetAddressesOutput>;
export type SearchRestaurantsInput = z.infer<typeof searchRestaurantsInput>;
export type SearchRestaurantsOutput = z.infer<typeof searchRestaurantsOutput>;
export type SearchMenuInput = z.infer<typeof searchMenuInput>;
export type SearchMenuOutput = z.infer<typeof searchMenuOutput>;
export type GetRestaurantMenuInput = z.infer<typeof getRestaurantMenuInput>;
export type GetRestaurantMenuOutput = z.infer<typeof getRestaurantMenuOutput>;
export type FetchFoodCouponsInput = z.infer<typeof fetchFoodCouponsInput>;
export type FetchFoodCouponsOutput = z.infer<typeof fetchFoodCouponsOutput>;
export type ApplyFoodCouponInput = z.infer<typeof applyFoodCouponInput>;
export type ApplyFoodCouponOutput = z.infer<typeof applyFoodCouponOutput>;
export type GetFoodCartInput = z.infer<typeof getFoodCartInput>;
export type GetFoodCartOutput = z.infer<typeof getFoodCartOutput>;
export type UpdateFoodCartInput = z.infer<typeof updateFoodCartInput>;
export type UpdateFoodCartOutput = z.infer<typeof updateFoodCartOutput>;
export type FlushFoodCartInput = z.infer<typeof flushFoodCartInput>;
export type FlushFoodCartOutput = z.infer<typeof flushFoodCartOutput>;
export type PlaceFoodOrderInput = z.infer<typeof placeFoodOrderInput>;
export type PlaceFoodOrderOutput = z.infer<typeof placeFoodOrderOutput>;
export type GetFoodOrdersInput = z.infer<typeof getFoodOrdersInput>;
export type GetFoodOrdersOutput = z.infer<typeof getFoodOrdersOutput>;
export type GetFoodOrderDetailsInput = z.infer<typeof getFoodOrderDetailsInput>;
export type GetFoodOrderDetailsOutput = z.infer<
  typeof getFoodOrderDetailsOutput
>;
export type TrackFoodOrderInput = z.infer<typeof trackFoodOrderInput>;
export type TrackFoodOrderOutput = z.infer<typeof trackFoodOrderOutput>;
export type FoodReportErrorInput = z.infer<typeof foodReportErrorInput>;
export type FoodReportErrorOutput = z.infer<typeof foodReportErrorOutput>;

// Instamart types
export type InstamartGetAddressesInput = z.infer<typeof imGetAddressesInput>;
export type InstamartGetAddressesOutput = z.infer<typeof imGetAddressesOutput>;
export type CreateAddressInput = z.infer<typeof createAddressInput>;
export type CreateAddressOutput = z.infer<typeof createAddressOutput>;
export type DeleteAddressInput = z.infer<typeof deleteAddressInput>;
export type DeleteAddressOutput = z.infer<typeof deleteAddressOutput>;
export type SearchProductsInput = z.infer<typeof searchProductsInput>;
export type SearchProductsOutput = z.infer<typeof searchProductsOutput>;
export type YourGoToItemsInput = z.infer<typeof yourGoToItemsInput>;
export type YourGoToItemsOutput = z.infer<typeof yourGoToItemsOutput>;
export type GetCartInput = z.infer<typeof getCartInput>;
export type GetCartOutput = z.infer<typeof getCartOutput>;
export type UpdateCartInput = z.infer<typeof updateCartInput>;
export type UpdateCartOutput = z.infer<typeof updateCartOutput>;
export type ClearCartInput = z.infer<typeof clearCartInput>;
export type ClearCartOutput = z.infer<typeof clearCartOutput>;
export type CheckoutInput = z.infer<typeof checkoutInput>;
export type CheckoutOutput = z.infer<typeof checkoutOutput>;
export type GetOrdersInput = z.infer<typeof getOrdersInput>;
export type GetOrdersOutput = z.infer<typeof getOrdersOutput>;
export type GetOrderDetailsInput = z.infer<typeof getOrderDetailsInput>;
export type GetOrderDetailsOutput = z.infer<typeof getOrderDetailsOutput>;
export type TrackOrderInput = z.infer<typeof trackOrderInput>;
export type TrackOrderOutput = z.infer<typeof trackOrderOutput>;
export type InstamartReportErrorInput = z.infer<typeof imReportErrorInput>;
export type InstamartReportErrorOutput = z.infer<typeof imReportErrorOutput>;

// Dineout types
export type GetSavedLocationsInput = z.infer<typeof getSavedLocationsInput>;
export type GetSavedLocationsOutput = z.infer<typeof getSavedLocationsOutput>;
export type SearchRestaurantsDineoutInput = z.infer<
  typeof searchRestaurantsDineoutInput
>;
export type SearchRestaurantsDineoutOutput = z.infer<
  typeof searchRestaurantsDineoutOutput
>;
export type GetRestaurantDetailsInput = z.infer<
  typeof getRestaurantDetailsInput
>;
export type GetRestaurantDetailsOutput = z.infer<
  typeof getRestaurantDetailsOutput
>;
export type GetAvailableSlotsInput = z.infer<typeof getAvailableSlotsInput>;
export type GetAvailableSlotsOutput = z.infer<typeof getAvailableSlotsOutput>;
export type CreateCartInput = z.infer<typeof createCartInput>;
export type CreateCartOutput = z.infer<typeof createCartOutput>;
export type BookTableInput = z.infer<typeof bookTableInput>;
export type BookTableOutput = z.infer<typeof bookTableOutput>;
export type GetBookingStatusInput = z.infer<typeof getBookingStatusInput>;
export type GetBookingStatusOutput = z.infer<typeof getBookingStatusOutput>;
export type DineoutReportErrorInput = z.infer<typeof dineoutReportErrorInput>;
export type DineoutReportErrorOutput = z.infer<typeof dineoutReportErrorOutput>;
