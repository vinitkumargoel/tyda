/**
 * Barrel re-exports for the TUI renderer components.
 *
 * Slash-command handlers in other tracks build a small view-model from
 * the MCP response and attach the matching component to the
 * `tool-response.render` field of a `TranscriptEntry`. The components
 * themselves are pure: data in, Ink elements out.
 */
export { RestaurantList } from "./restaurant-list.js";
export type {
  Restaurant,
  RestaurantListProps,
} from "./restaurant-list.js";

export { MenuView } from "./menu.js";
export type { MenuItem, MenuViewProps, PageInfo } from "./menu.js";

export { CartView } from "./cart.js";
export type {
  AppliedCouponView,
  CartLineItem,
  CartViewModel,
  CartViewProps,
} from "./cart.js";

export {
  Tracker,
  BAR_WIDTH,
  STATE_FILL,
  formatElapsed,
  progressBar,
} from "./tracker.js";
export type {
  OrderState,
  TrackerOrder,
  TrackerProps,
  TrackerRider,
} from "./tracker.js";

export { SlotsView } from "./slots.js";
export type { Slot, SlotsVenue, SlotsViewProps } from "./slots.js";
