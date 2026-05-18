import {
  loadVenues,
  findVenue,
  findSlot,
  decrementSlotCapacity,
  getCart,
  deleteCart,
  putCart,
  newCartId,
  nextBookingId,
  persistBooking,
  slotReservationTime,
} from "./_helpers.js";
import { loadState } from "../../store.js";
import type { Response } from "../../../shared/response.js";
import type { DineoutBooking, DineoutCart } from "./_types.js";

interface Args {
  cartId?: string;
  restaurantId?: string;
  slotId?: string;
  guestCount?: number;
  dealId?: string;
}

export type BookTableResult = Response<{
  orderId: string;
  status: "CONFIRMED";
  restaurantId: string;
  restaurantName: string;
  date: string;
  time: string;
  guestCount: number;
  dealTitle: string;
}>;

export async function bookTable(args: Args): Promise<BookTableResult> {
  const venues = await loadVenues();

  // Resolve a cart — either by id from `create_cart` or by inlining the
  // booking parameters into a one-shot cart.
  let cart: DineoutCart | undefined;
  if (args.cartId) {
    cart = getCart(args.cartId);
    if (!cart) {
      return {
        success: false,
        error: { code: "CART_NOT_FOUND", message: `Cart "${args.cartId}" not found.` },
      };
    }
  } else {
    if (!args.restaurantId || !args.slotId) {
      return {
        success: false,
        error: {
          code: "MISSING_ARGS",
          message: "Provide cartId, or both restaurantId and slotId.",
        },
      };
    }
    const venue = findVenue(venues, args.restaurantId);
    if (!venue) {
      return {
        success: false,
        error: {
          code: "RESTAURANT_NOT_FOUND",
          message: `No restaurant with id "${args.restaurantId}".`,
        },
      };
    }
    const slotInfo = findSlot(venue, args.slotId);
    if (!slotInfo) {
      return {
        success: false,
        error: { code: "SLOT_NOT_FOUND", message: `No slot "${args.slotId}".` },
      };
    }
    const deal =
      (args.dealId && venue.deals.find((d) => d.id === args.dealId)) ||
      venue.deals[0];
    if (!deal || !deal.isFree || deal.bookingPrice !== 0) {
      return {
        success: false,
        error: {
          code: "PAID_DEAL_REJECTED",
          message: "Only free reservations are supported.",
        },
      };
    }
    const guestCount = args.guestCount ?? 2;
    if (guestCount < 1 || guestCount > 20) {
      return {
        success: false,
        error: {
          code: "BAD_GUEST_COUNT",
          message: "guestCount must be between 1 and 20.",
        },
      };
    }
    cart = {
      cartId: newCartId(),
      cartType: "DEAL_TICKET_PURCHASE",
      restaurantId: venue.id,
      slotId: slotInfo.slot.id,
      reservationTime: slotReservationTime(slotInfo.day.date, slotInfo.slot.label),
      guestCount,
      dealId: deal.id,
      billToPay: 0,
      skipPayment: true,
      createdAt: Date.now(),
    };
    putCart(cart);
  }

  const venue = findVenue(venues, cart.restaurantId);
  if (!venue) {
    return {
      success: false,
      error: {
        code: "RESTAURANT_NOT_FOUND",
        message: `Restaurant "${cart.restaurantId}" disappeared.`,
      },
    };
  }
  const slotInfo = findSlot(venue, cart.slotId);
  if (!slotInfo) {
    return {
      success: false,
      error: { code: "SLOT_NOT_FOUND", message: `Slot "${cart.slotId}" not found.` },
    };
  }

  // Capacity check + decrement.
  const decrement = decrementSlotCapacity(venue, cart.slotId);
  if (!decrement.ok) {
    if (decrement.reason === "FULL") {
      return {
        success: false,
        error: {
          code: "SLOT_FULL",
          message: `Slot "${cart.slotId}" is full. Pick another time.`,
        },
      };
    }
    return {
      success: false,
      error: { code: "SLOT_NOT_FOUND", message: `Slot "${cart.slotId}" not found.` },
    };
  }

  const deal = venue.deals.find((d) => d.id === cart.dealId);
  const state = await loadState();
  const orderId = nextBookingId(state, slotInfo.day.date);
  const booking: DineoutBooking = {
    orderId,
    cartId: cart.cartId,
    restaurantId: venue.id,
    restaurantName: venue.name,
    date: slotInfo.day.date,
    time: slotInfo.slot.label,
    slotId: cart.slotId,
    guestCount: cart.guestCount,
    dealId: cart.dealId,
    dealTitle: deal?.title ?? "Reservation",
    status: "CONFIRMED",
    createdAt: Date.now(),
  };
  await persistBooking(booking);
  deleteCart(cart.cartId);

  return {
    success: true,
    data: {
      orderId: booking.orderId,
      status: "CONFIRMED",
      restaurantId: booking.restaurantId,
      restaurantName: booking.restaurantName,
      date: booking.date,
      time: booking.time,
      guestCount: booking.guestCount,
      dealTitle: booking.dealTitle,
    },
    message: `Table confirmed at ${booking.restaurantName} on ${booking.date} ${booking.time}.`,
  };
}
