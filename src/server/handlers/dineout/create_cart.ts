import {
  loadVenues,
  findVenue,
  findSlot,
  newCartId,
  putCart,
  slotReservationTime,
} from "./_helpers.js";
import type { Response } from "../../../shared/response.js";
import type { DineoutCart, DineoutCartType } from "./_types.js";

interface Args {
  restaurantId: string;
  slotId?: string;
  guestCount?: number;
  cartType?: DineoutCartType;
  dealId?: string;
}

export type CreateCartResult = Response<{
  cartId: string;
  cartType: DineoutCartType;
  restaurantId: string;
  slotId: string;
  reservationTime: number;
  guestCount: number;
  dealId: string;
  billToPay: 0;
  skipPayment: true;
}>;

export async function createCart(args: Args): Promise<CreateCartResult> {
  const cartType: DineoutCartType = args.cartType ?? "DEAL_TICKET_PURCHASE";

  if (cartType !== "DEAL_TICKET_PURCHASE") {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_CART_TYPE",
        message: `Cart type "${cartType}" is not supported in v1. Only DEAL_TICKET_PURCHASE.`,
      },
    };
  }

  if (!args.slotId) {
    return {
      success: false,
      error: { code: "MISSING_SLOT", message: "slotId is required." },
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

  const venues = await loadVenues();
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
  if (!deal) {
    return {
      success: false,
      error: {
        code: "NO_DEAL",
        message: `Restaurant "${venue.name}" has no deals.`,
      },
    };
  }
  if (!deal.isFree || deal.bookingPrice !== 0) {
    return {
      success: false,
      error: {
        code: "PAID_DEAL_REJECTED",
        message:
          "Only free reservations are supported (billToPay must be 0 and skipPayment true).",
      },
    };
  }

  const reservationTime = slotReservationTime(slotInfo.day.date, slotInfo.slot.label);
  const cart: DineoutCart = {
    cartId: newCartId(),
    cartType,
    restaurantId: venue.id,
    slotId: slotInfo.slot.id,
    reservationTime,
    guestCount,
    dealId: deal.id,
    billToPay: 0,
    skipPayment: true,
    createdAt: Date.now(),
  };
  putCart(cart);

  return {
    success: true,
    data: {
      cartId: cart.cartId,
      cartType: cart.cartType,
      restaurantId: cart.restaurantId,
      slotId: cart.slotId,
      reservationTime: cart.reservationTime,
      guestCount: cart.guestCount,
      dealId: cart.dealId,
      billToPay: 0,
      skipPayment: true,
    },
    message: `Cart created (billToPay=0, skipPayment=true).`,
  };
}
