import type { OkResponse } from "../../../shared/response.js";
import { loadProducts, variantAvailable } from "./_helpers.js";
import type { SearchedProduct } from "./search_products.js";

export interface YourGoToItemsInput {
  addressId: string;
  offset?: number;
}

export async function yourGoToItems(
  _args: YourGoToItemsInput,
): Promise<OkResponse<{ items: SearchedProduct[] }>> {
  const products = await loadProducts();
  // Pick first 6 by id (mock "frequent" list).
  const head = products.slice(0, 6);
  const now = new Date();
  const items: SearchedProduct[] = head.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    veg: p.veg,
    imageUrl: p.imageUrl,
    variants: p.variants.map((v) => ({
      ...v,
      available: variantAvailable(v, now),
    })),
  }));
  return {
    success: true,
    data: { items },
    message: `Your Go-To items (${items.length}).`,
  };
}
