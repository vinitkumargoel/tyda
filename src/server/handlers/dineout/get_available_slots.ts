import {
  loadVenues,
  findVenue,
  parseDate,
  slotReservationTime,
} from "./_helpers.js";
import type { Response } from "../../../shared/response.js";
import type { Deal } from "./_types.js";

interface Args {
  restaurantId: string;
  date?: string;
  dateRange?: { from: string; to: string };
}

interface SlotOut {
  slotId: string;
  displayTime: string;
  capacity: number;
  reservationTime: number;
  slotGroupName: "Breakfast" | "Lunch" | "Dinner";
  deals: Deal[];
}

interface DayOut {
  dateStr: string;
  slots: SlotOut[];
}

function groupOf(label: string): "Breakfast" | "Lunch" | "Dinner" {
  const [hStr] = label.split(":");
  const h = Number(hStr);
  if (h < 11) return "Breakfast";
  if (h < 17) return "Lunch";
  return "Dinner";
}

export type GetAvailableSlotsResult = Response<{
  restaurantId: string;
  days: DayOut[];
}>;

export async function getAvailableSlots(
  args: Args,
): Promise<GetAvailableSlotsResult> {
  const venues = await loadVenues();
  const v = findVenue(venues, args.restaurantId);
  if (!v) {
    return {
      success: false,
      error: {
        code: "RESTAURANT_NOT_FOUND",
        message: `No restaurant with id "${args.restaurantId}".`,
      },
    };
  }

  const dateFilter = args.date ? parseDate(args.date) : undefined;
  const from = args.dateRange?.from ? parseDate(args.dateRange.from) : undefined;
  const to = args.dateRange?.to ? parseDate(args.dateRange.to) : undefined;

  const days: DayOut[] = [];
  for (const day of v.slots) {
    if (dateFilter && day.date !== dateFilter) continue;
    if (from && day.date < from) continue;
    if (to && day.date > to) continue;
    const slots: SlotOut[] = day.windows.map((w) => ({
      slotId: w.id,
      displayTime: w.label,
      capacity: w.capacity,
      reservationTime: slotReservationTime(day.date, w.label),
      slotGroupName: groupOf(w.label),
      deals: v.deals,
    }));
    days.push({ dateStr: day.date, slots });
  }

  return {
    success: true,
    data: { restaurantId: v.id, days },
    message: `Returned ${days.length} day(s) of slots for ${v.name}.`,
  };
}
