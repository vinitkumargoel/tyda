import { loadVenues, findVenue } from "./_helpers.js";
import type { Response } from "../../../shared/response.js";
import type { Deal, DineoutVenue } from "./_types.js";

interface Args {
  restaurantId: string;
}

interface Details {
  restaurantId: string;
  name: string;
  area: string;
  city: string;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  costForTwo: number;
  currency: string;
  timings: string;
  address: string;
  coordinates: { lat: number; lng: number };
  deals: Deal[];
}

function toDetails(v: DineoutVenue): Details {
  return {
    restaurantId: v.id,
    name: v.name,
    area: v.area,
    city: v.city,
    cuisines: v.cuisines,
    rating: v.rating,
    ratingCount: v.ratingCount,
    costForTwo: v.costForTwo,
    currency: v.currency,
    timings: v.openHours,
    address: `${v.name}, ${v.area}, ${v.city}`,
    coordinates: { lat: v.lat, lng: v.lng },
    deals: v.deals,
  };
}

export type GetRestaurantDetailsResult = Response<Details>;

export async function getRestaurantDetails(
  args: Args,
): Promise<GetRestaurantDetailsResult> {
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
  return { success: true, data: toDetails(v) };
}
