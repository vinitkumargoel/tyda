import { findBooking } from "./_helpers.js";
import type { Response } from "../../../shared/response.js";
import type { DineoutBooking } from "./_types.js";

interface Args {
  orderId: string;
}

export type GetBookingStatusResult = Response<DineoutBooking>;

export async function getBookingStatus(
  args: Args,
): Promise<GetBookingStatusResult> {
  const booking = await findBooking(args.orderId);
  if (!booking) {
    return {
      success: false,
      error: {
        code: "BOOKING_NOT_FOUND",
        message: `No booking with orderId "${args.orderId}".`,
      },
    };
  }
  return { success: true, data: booking };
}
