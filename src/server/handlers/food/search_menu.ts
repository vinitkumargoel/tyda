/**
 * search_menu — search dish names across all restaurants' menus.
 *
 * Returns matching menu items annotated with their parent restaurant. Items
 * are sorted by name-match strength, then by parent restaurant rating.
 */
import type { HandlerContext } from "./_types.js";
import { loadRestaurants } from "./_helpers.js";

interface Input {
  query: string;
  addressId?: string;
  restaurantIdOfAddedItem?: string;
  vegFilter?: number;
  offset?: number;
}

interface SearchMenuItem {
  restaurantId: string;
  restaurantName: string;
  menuItemId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  veg: boolean;
  variants: { id: string; label: string; price: number }[];
  addOns: { id: string; name: string; price: number }[];
}

export interface SearchMenuOutput {
  success: true;
  data: {
    items: SearchMenuItem[];
    total: number;
    nextOffset: number | null;
  };
}

const PAGE_SIZE = 10;

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<SearchMenuOutput> {
  const all = await loadRestaurants();
  const q = input.query.trim().toLowerCase();
  const vegOnly = input.vegFilter === 1;
  const offset = Math.max(0, input.offset ?? 0);

  const out: { item: SearchMenuItem; score: number; rating: number }[] = [];
  for (const r of all) {
    if (
      input.restaurantIdOfAddedItem &&
      r.id !== input.restaurantIdOfAddedItem
    ) {
      continue;
    }
    for (const m of r.menu) {
      if (!m.available) continue;
      if (vegOnly && !m.veg) continue;
      const name = m.name.toLowerCase();
      if (q && !name.includes(q)) continue;
      out.push({
        item: {
          restaurantId: r.id,
          restaurantName: r.name,
          menuItemId: m.id,
          name: m.name,
          description: m.description,
          price: m.price,
          category: m.category,
          veg: m.veg,
          variants: m.variants,
          addOns: m.addOns,
        },
        score: q && name.startsWith(q) ? 2 : 1,
        rating: r.rating,
      });
    }
  }
  out.sort((a, b) => b.score - a.score || b.rating - a.rating);

  const total = out.length;
  const slice = out.slice(offset, offset + PAGE_SIZE).map((x) => x.item);
  const next = offset + PAGE_SIZE < total ? offset + PAGE_SIZE : null;

  return {
    success: true,
    data: { items: slice, total, nextOffset: next },
  };
}
