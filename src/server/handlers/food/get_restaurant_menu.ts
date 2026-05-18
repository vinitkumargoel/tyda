/**
 * get_restaurant_menu — paginate a restaurant's menu by category.
 *
 * Default page size is 5 categories, max 8 per the schema. Returns the
 * categories on the requested page along with their items.
 */
import type { HandlerContext } from "./_types.js";
import {
  findRestaurant,
  loadRestaurants,
  type MenuItem,
} from "./_helpers.js";

interface Input {
  addressId?: string;
  restaurantId: string;
  page?: number;
  pageSize?: number;
}

interface CategoryBlock {
  category: string;
  items: MenuItem[];
}

export interface GetRestaurantMenuOutput {
  success: true | false;
  data?: {
    restaurantId: string;
    restaurantName: string;
    page: number;
    pageSize: number;
    totalCategories: number;
    categories: CategoryBlock[];
    hasMore: boolean;
  };
  error?: { code?: string; message: string };
}

export default async function handle(
  input: Input,
  _ctx: HandlerContext,
): Promise<GetRestaurantMenuOutput> {
  const all = await loadRestaurants();
  const r = findRestaurant(all, input.restaurantId);
  if (!r) {
    return {
      success: false,
      error: {
        code: "RESTAURANT_NOT_FOUND",
        message: `No restaurant with id ${input.restaurantId}`,
      },
    };
  }

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 5, 8));

  // Group by category preserving menu order.
  const byCategory = new Map<string, MenuItem[]>();
  for (const item of r.menu) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  const categories = [...byCategory.entries()].map(([category, items]) => ({
    category,
    items,
  }));

  const start = (page - 1) * pageSize;
  const slice = categories.slice(start, start + pageSize);

  return {
    success: true,
    data: {
      restaurantId: r.id,
      restaurantName: r.name,
      page,
      pageSize,
      totalCategories: categories.length,
      categories: slice,
      hasMore: start + pageSize < categories.length,
    },
  };
}
