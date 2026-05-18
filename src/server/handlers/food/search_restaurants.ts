/**
 * search_restaurants — find restaurants matching the user's query.
 *
 * Filters/scores `fixtures/restaurants.json` by query (matched against name +
 * cuisines), then ranks by `score + rating`. Page size defaults to 5; paging
 * is offset-based to match the input schema.
 */
import type { HandlerContext } from "./_types.js";
import { loadRestaurants, scoreRestaurant, type Restaurant } from "./_helpers.js";

interface Input {
  addressId?: string;
  query?: string;
  offset?: number;
  pageSize?: number;
}

interface ResultRestaurant {
  id: string;
  name: string;
  area: string;
  city: string;
  cuisines: string[];
  rating: number;
  ratingCount: number;
  costForTwo: number;
  currency: string;
  etaMinutes: number;
}

export interface SearchRestaurantsOutput {
  success: true;
  data: {
    restaurants: ResultRestaurant[];
    total: number;
    nextOffset: number | null;
  };
}

function summarize(r: Restaurant): ResultRestaurant {
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    city: r.city,
    cuisines: r.cuisines,
    rating: r.rating,
    ratingCount: r.ratingCount,
    costForTwo: r.costForTwo,
    currency: r.currency,
    etaMinutes: r.etaMinutes,
  };
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<SearchRestaurantsOutput> {
  const all = await loadRestaurants();
  const query = (input.query ?? "").trim();
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 5, 20));
  const offset = Math.max(0, input.offset ?? 0);

  const scored = all
    .map((r) => ({ r, score: scoreRestaurant(r, query) }))
    .filter((x) => query === "" || x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.rating - a.r.rating);

  const total = scored.length;
  const slice = scored.slice(offset, offset + pageSize).map((x) => summarize(x.r));
  const next = offset + pageSize < total ? offset + pageSize : null;

  return {
    success: true,
    data: { restaurants: slice, total, nextOffset: next },
  };
}
