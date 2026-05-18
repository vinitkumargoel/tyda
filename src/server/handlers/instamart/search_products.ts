import type { OkResponse } from "../../../shared/response.js";
import { loadProducts, variantAvailable } from "./_helpers.js";
import type { Product, ProductVariant } from "./_types.js";

export interface SearchProductsInput {
  query: string;
  addressId: string;
  page?: number;
  pageSize?: number;
  offset?: number;
}

export interface SearchedVariant extends ProductVariant {
  available: boolean;
}

export interface SearchedProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  veg: boolean;
  imageUrl: string | null;
  variants: SearchedVariant[];
}

export async function searchProducts(
  args: SearchProductsInput,
): Promise<
  OkResponse<{
    products: SearchedProduct[];
    page: number;
    pageSize: number;
    total: number;
  }>
> {
  const products = await loadProducts();
  const q = (args.query ?? "").trim().toLowerCase();
  const filtered = q
    ? products.filter((p: Product) => {
        const hay = [p.name, p.brand ?? "", p.category].join(" ").toLowerCase();
        return hay.includes(q);
      })
    : products;

  const pageSize = args.pageSize ?? 8;
  const page = args.page ?? (args.offset !== undefined ? Math.floor(args.offset / pageSize) : 0);
  const start = page * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  const now = new Date();

  const decorated: SearchedProduct[] = slice.map((p) => ({
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
    data: {
      products: decorated,
      page,
      pageSize,
      total: filtered.length,
    },
    message: `Found ${filtered.length} product(s) for "${args.query}".`,
  };
}
