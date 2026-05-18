import { loadVenues, readSavedLocations } from "./_helpers.js";
import { loadState } from "../../store.js";
import type { Response } from "../../../shared/response.js";
import type { DineoutVenue } from "./_types.js";

interface SearchArgs {
  query?: string;
  entityType?: string;
  addressId?: string;
  locationId?: string;
  latitude?: number;
  longitude?: number;
  page?: number;
}

interface SearchResultRow {
  restaurantId: string;
  name: string;
  area: string;
  city: string;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  costForTwo: number;
  currency: string;
  highlights: string[];
  freeDealCount: number;
}

const PAGE_SIZE = 5;

function highlightsFor(v: DineoutVenue): string[] {
  const h: string[] = [];
  if (v.rating >= 4.5) h.push("Top Rated");
  if (v.cuisines.some((c) => c.toLowerCase().includes("beer"))) h.push("Brewery");
  if (v.cuisines.some((c) => c.toLowerCase().includes("coastal"))) h.push("Coastal Cuisine");
  if (v.openHours.endsWith("23:30") || v.openHours.endsWith("23:00")) h.push("Open Late");
  return h;
}

function toRow(v: DineoutVenue): SearchResultRow {
  const freeDealCount = v.deals.filter((d) => d.isFree).length;
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
    highlights: highlightsFor(v),
    freeDealCount,
  };
}

export type SearchRestaurantsDineoutResult = Response<{
  results: SearchResultRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}>;

export async function searchRestaurantsDineout(
  args: SearchArgs,
): Promise<SearchRestaurantsDineoutResult> {
  const venues = await loadVenues();
  const query = (args.query ?? "").trim().toLowerCase();

  // Resolve location filter from either `locationId`/`addressId` against saved
  // locations, or use raw lat/lng as a soft Bangalore-wide filter (currently
  // every fixture venue is in Bangalore, so this is a no-op unless query is
  // also empty).
  let areaFilter: string | undefined;
  const locId = args.locationId ?? args.addressId;
  if (locId) {
    const state = await loadState();
    const saved = readSavedLocations(state);
    const loc = saved.find((s) => s.id === locId);
    if (loc) areaFilter = loc.area.toLowerCase();
  }

  const matches = venues.filter((v) => {
    if (areaFilter && !v.area.toLowerCase().includes(areaFilter)) {
      // Be permissive: if no venues match the area, fall back below.
    }
    if (!query) return true;
    const hay = [
      v.name,
      v.area,
      v.city,
      ...v.cuisines,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });

  // If areaFilter narrowed nothing in, soften it.
  const filtered = areaFilter
    ? matches.filter((v) => v.area.toLowerCase().includes(areaFilter as string))
    : matches;
  const final = filtered.length > 0 ? filtered : matches;

  const page = Math.max(1, Math.floor(args.page ?? 1));
  const start = (page - 1) * PAGE_SIZE;
  const slice = final.slice(start, start + PAGE_SIZE);

  return {
    success: true,
    data: {
      results: slice.map(toRow),
      page,
      pageSize: PAGE_SIZE,
      total: final.length,
      hasMore: start + PAGE_SIZE < final.length,
    },
    message:
      slice.length === 0
        ? "No restaurants matched."
        : `Showing ${slice.length} of ${final.length} restaurant(s).`,
  };
}
