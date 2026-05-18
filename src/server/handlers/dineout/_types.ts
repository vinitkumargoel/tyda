/**
 * Dineout-side domain types. Track H owns these.
 *
 * The store keeps slot capacity inside `addresses.dineout` is NOT correct —
 * slots are per-venue, persisted in memory copy of the fixture grid. We keep
 * a venue-id -> slot-grid map under `state.orders.dineout` adjacent storage;
 * actually we use a separate field on `state.addresses.dineout` for saved
 * locations and `state.orders.dineout` for bookings. Venue slot decay lives
 * on a per-process cache loaded from the fixture and mutated in place.
 */

export interface Deal {
  id: string;
  title: string;
  isFree: boolean;
  bookingPrice: number;
}

export interface Slot {
  id: string;
  label: string;
  capacity: number;
}

export interface SlotDay {
  date: string;
  windows: Slot[];
}

export interface DineoutVenue {
  id: string;
  name: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  costForTwo: number;
  currency: string;
  openHours: string;
  deals: Deal[];
  slots: SlotDay[];
}

export type DineoutCartType = "DEAL_TICKET_PURCHASE" | "DINEOUT";

export interface DineoutCart {
  cartId: string;
  cartType: DineoutCartType;
  restaurantId: string;
  slotId: string;
  reservationTime: number;
  guestCount: number;
  dealId: string;
  billToPay: 0;
  skipPayment: true;
  createdAt: number;
}

export interface DineoutBooking {
  orderId: string;
  cartId: string;
  restaurantId: string;
  restaurantName: string;
  date: string;
  time: string;
  slotId: string;
  guestCount: number;
  dealId: string;
  dealTitle: string;
  status: "CONFIRMED";
  createdAt: number;
}

export interface SavedLocation {
  id: string;
  index: number;
  addressLine: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
}
