/**
 * Zepto full-catalog downloader (anonymous catalog plane — no login needed, only a
 * serviceable storeId + a fresh CSRF bootstrap).
 *
 * There is no single "all products" endpoint, and the category *landing* pages are
 * curated (~30-40 items each). To get the WHOLE store we use two complementary
 * sources and union them (dedup by storeProductId):
 *
 *   1. Landing BFS — `lms/api/v2/get_page` SUBCATEGORY, seeded from HOME's L1
 *      categories, expanding over every `primarySubcategoryId` seen. Gives the
 *      taxonomy (category/subcategory/L3 ids + names) and ~⅓ of the catalog.
 *   2. Search sweep — `user-search-service/api/v3/search` is the full product index
 *      (paginates 30/page, ~200/term). We sweep it with every subcategory / L3 /
 *      brand name harvested in step 1, which recalls the rest of the catalog.
 *
 * Search nodes are thinner (ids under different keys, no L3/subcat *names*), so we
 * normalize both shapes and cross-fill names from the nodes that have them. On the
 * reference dark store this converges to ~8.5k SKUs.
 *
 *   tsx src/zepto/cli.ts catalog                  # download to ./zepto-catalog/<storeId>/
 *   tsx src/zepto/cli.ts catalog --store <id>     # a specific dark store
 *   tsx src/zepto/cli.ts catalog --out <dir>      # output directory
 *   tsx src/zepto/cli.ts catalog --concurrency 8  # parallel fetches (default 8)
 *   tsx src/zepto/cli.ts catalog --no-sweep       # landings only (faster, partial)
 */
import { writeFileSync, mkdirSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { ZeptoHttp, ZEPTO_BFF } from "./auth/http-client.js";
import { loadSession } from "./auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p.replace(/^\//, "")}`;
const CDN = "https://cdn.zeptonow.com/production";
const GEO = { latitude: 12.9074, longitude: 77.6955 };
const WB = { "X-WITHOUT-BEARER": "true" };

/** Build a full-resolution CDN image URL from a productVariant image path. */
export const imageUrl = (path?: string) => (path ? `${CDN}/${path}` : "");

export interface L1Category {
  name: string;
  categoryId: string;
  subCategoryId: string; // the landing subcategory the HOME grid points at
}

/** A flattened, analysis-friendly product record (prices are in paise unless noted). */
export interface FlatProduct {
  storeProductId: string; // objectId — the per-store SKU id used by cart/create
  productId: string; // baseProductId / product.id — the catalog product id
  variantId: string; // productVariant.id
  name: string;
  brand: string;
  brandId: string;
  mrp: number;
  sellingPrice: number;
  discountedSellingPrice: number;
  discountAmount: number;
  discountPercent: number;
  superSaverSellingPrice: number;
  pricePerUom: number;
  pricingEntities: Record<string, number>;
  mrpRupees: number;
  priceRupees: number;
  packSize: string;
  uom: string;
  unitOfMeasure: string;
  availableQuantity: number;
  outOfStock: boolean;
  isActive: boolean;
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  l3Id: string;
  l3Name: string;
  l3CategoryIds: string[];
  description: string;
  ingredients: string;
  countryOfOrigin: string;
  manufacturerName: string;
  manufacturerAddress: string;
  minimumRequiredAge: number;
  tags: string[];
  images: string[];
  primaryImage: string;
  source: string; // "landing" | "search"
  storeId: string;
}

// ---------------- node accessors (handle BOTH the landing + search shapes) ------

const storeProductId = (p: any): string => p.objectId ?? p.id ?? "";
const productIdOf = (p: any): string => p.baseProductId ?? p.product?.id ?? "";
const variantIdOf = (p: any): string => p.productVariant?.id ?? "";
const categoryIdOf = (p: any): string => p.categoryId ?? p.primaryCategoryId ?? "";
const subcategoryIdOf = (p: any): string => p.primarySubcategoryId || p.product?.primarySubcategory || "";
const l3IdOf = (p: any): string => p.product?.l3CategoryDetails?.id ?? p.product?.l3CategoryIds?.[0] ?? "";
const categoryNameOf = (p: any): string => p.primaryCategoryName ?? "";
const subcategoryNameOf = (p: any): string => p.primarySubcategoryName ?? "";
const l3NameOf = (p: any): string => p.product?.l3CategoryDetails?.name ?? "";

/** Recursively pull every product node (has productVariant + a price field) out of a layout. */
function productNodes(obj: any, out: any[] = [], depth = 0): any[] {
  if (!obj || typeof obj !== "object" || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) productNodes(x, out, depth + 1);
    return out;
  }
  if (obj.productVariant && (obj.sellingPrice != null || obj.mrp != null)) out.push(obj);
  for (const k of Object.keys(obj)) productNodes(obj[k], out, depth + 1);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => sleep(ms + Math.floor(ms * 0.6 * (((Date.now() % 97) / 97) - 0.5)));

/** Status codes that mean "throttled / transient" → back off and retry. 299 is
 *  Zepto's anonymous-search burst-limit ("Please login to continue searching"). */
const isRetryable = (status: number) => status === 299 || status === 429 || status >= 500;

async function withRetry<T>(fn: () => Promise<T>, tries = 6, base = 800): Promise<T | null> {
  let delay = base;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch {
      if (i === tries - 1) return null;
      await sleep(delay);
      delay = Math.min(delay * 2, 16000);
    }
  }
  return null;
}

/** Run `worker` over `items` with a fixed-size pool. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let idx = 0;
  const run = async (): Promise<void> => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

/** The L1 categories from the HOME page (name + its landing subcategory). */
export async function fetchHomeCategories(anon: ZeptoHttp, storeId: string): Promise<L1Category[]> {
  const r = await anon.signed("POST", U("lms/api/v2/get_page"), { pageType: "HOME", storeId, storeIds: [storeId], ...GEO }, WB);
  if (r.status !== 200) throw new Error(`HOME get_page failed: HTTP ${r.status}`);
  const cats = new Map<string, L1Category>();
  const walk = (o: any): void => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return void o.forEach(walk);
    if (typeof o.deeplinkUrl === "string" && o.deeplinkUrl.includes("categoryId=") && o.id && o.name && !o.productVariant) {
      const m = o.deeplinkUrl.match(/categoryId=([0-9a-f-]+).*?subCategoryId=([0-9a-f-]+)/i);
      if (m && !cats.has(m[1])) cats.set(m[1], { name: o.name, categoryId: m[1], subCategoryId: m[2] });
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(r.json);
  return [...cats.values()];
}

/** Fetch one SUBCATEGORY landing → raw product nodes. */
async function fetchSubcategory(anon: ZeptoHttp, storeId: string, categoryId: string, subcategoryId: string): Promise<any[]> {
  const r = await anon.signed("POST", U("lms/api/v2/get_page"), { pageType: "SUBCATEGORY", storeId, storeIds: [storeId], ...GEO, categoryId, subcategoryId, pageNumber: 0 }, WB);
  if (r.status !== 200) {
    if (isRetryable(r.status)) throw new Error(`HTTP ${r.status}`);
    return [];
  }
  return productNodes(r.json);
}

/** Page a search query to the end (or maxPages) → raw product nodes. Throws on a
 *  throttle (299/429/5xx) so the caller's retry/backoff paces the sweep. */
async function searchAllPages(anon: ZeptoHttp, storeId: string, query: string, maxPages = 7): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await anon.signed(
      "POST",
      U("user-search-service/api/v3/search"),
      { query, pageNumber: page, mode: "AUTOSUGGEST", storeId, storeIds: [storeId], intentId: "catalog", userSessionId: anon.sessionId },
      WB,
    );
    if (r.status !== 200) {
      if (isRetryable(r.status)) throw new Error(`HTTP ${r.status}`);
      break;
    }
    const j = r.json as any;
    out.push(...productNodes(j));
    if (j?.hasReachedEnd) break;
    await jitter(120); // pace pages within a query
  }
  return out;
}

export interface CatalogResult {
  storeId: string;
  products: Map<string, any>; // storeProductId -> raw node (landing node preferred when both exist)
  l1: L1Category[];
  catNameById: Map<string, string>;
  subcatNameById: Map<string, string>;
  l3NameById: Map<string, string>;
  requests: number;
  subcategoriesVisited: number;
  searchTerms: number;
  converged: boolean;
}

/** Merge a batch of nodes into the result (landing nodes win ties; harvest names). */
function absorbNodes(res: CatalogResult, nodes: any[]): number {
  let fresh = 0;
  for (const p of nodes) {
    const id = storeProductId(p);
    if (id && !res.products.has(id)) {
      res.products.set(id, p);
      fresh++;
    }
    const cId = categoryIdOf(p), cName = categoryNameOf(p);
    if (cId && cName) res.catNameById.set(cId, cName);
    const sId = subcategoryIdOf(p), sName = subcategoryNameOf(p);
    if (sId && sName) res.subcatNameById.set(sId, sName);
    const lId = l3IdOf(p), lName = l3NameOf(p);
    if (lId && lName) res.l3NameById.set(lId, lName);
  }
  return fresh;
}

/** Download the whole catalog: landing BFS + search sweep, unioned + name-cross-filled. */
export async function downloadCatalog(opts: {
  storeId: string;
  concurrency?: number;
  searchConcurrency?: number;
  sweep?: boolean;
  maxRequests?: number;
  onProgress?: (s: { phase: string; requests: number; products: number; note?: string }) => void;
}): Promise<CatalogResult> {
  const { storeId } = opts;
  const concurrency = opts.concurrency ?? 8;
  // Anonymous search is burst-limited (HTTP 299), so the sweep runs gentler than the landings.
  const searchConcurrency = opts.searchConcurrency ?? 3;
  const sweep = opts.sweep ?? true;
  const maxRequests = opts.maxRequests ?? 8000;

  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();
  anon.storeId = storeId;

  const l1 = await fetchHomeCategories(anon, storeId);
  const res: CatalogResult = {
    storeId,
    products: new Map(),
    l1,
    catNameById: new Map(l1.map((c) => [c.categoryId, c.name])),
    subcatNameById: new Map(),
    l3NameById: new Map(),
    requests: 1,
    subcategoriesVisited: 0,
    searchTerms: 0,
    converged: true,
  };
  const progress = (phase: string, note?: string) => opts.onProgress?.({ phase, requests: res.requests, products: res.products.size, note });

  // ---- phase 1: landing BFS over subcategories ----
  const visited = new Set<string>();
  const catOfSub = new Map<string, string>();
  let frontier: string[] = [];
  for (const c of l1) {
    frontier.push(c.subCategoryId);
    catOfSub.set(c.subCategoryId, c.categoryId);
  }
  while (frontier.length && res.requests < maxRequests) {
    const batch = frontier.filter((s) => !visited.has(s));
    frontier = [];
    if (!batch.length) break;
    const nextSet = new Set<string>();
    await pool(batch, concurrency, async (sub) => {
      if (visited.has(sub)) return;
      visited.add(sub);
      res.requests++;
      const cat = catOfSub.get(sub) ?? l1[0]?.categoryId ?? "";
      const nodes = (await withRetry(() => fetchSubcategory(anon, storeId, cat, sub))) ?? [];
      absorbNodes(res, nodes);
      for (const p of nodes) {
        const psub = subcategoryIdOf(p);
        if (psub && !visited.has(psub) && !nextSet.has(psub)) {
          nextSet.add(psub);
          if (!catOfSub.has(psub)) catOfSub.set(psub, categoryIdOf(p) || cat);
        }
      }
      progress("landings");
    });
    frontier = [...nextSet];
  }
  res.subcategoriesVisited = visited.size;
  progress("landings", "done");

  // ---- phase 2: search sweep over harvested names (closure over new names) ----
  if (sweep) {
    const queried = new Set<string>();
    const norm = (s: string) => s.trim();
    const skip = new Set(["", "Unbranded", "Fruits", "Other", "Others"]);
    const collectSeeds = (): string[] => {
      const seeds = new Set<string>();
      for (const n of res.subcatNameById.values()) if (n && !skip.has(n)) seeds.add(norm(n));
      for (const n of res.l3NameById.values()) if (n && !skip.has(n)) seeds.add(norm(n));
      for (const p of res.products.values()) {
        const b = p.product?.brand;
        if (b && !skip.has(b)) seeds.add(norm(b));
      }
      for (const c of res.l1) seeds.add(norm(c.name));
      return [...seeds].filter((s) => !queried.has(s));
    };

    // Throttled terms (withRetry exhausted → null) are NOT marked done, so a later
    // round retries them; give up on a term only after `maxFails` throttled rounds.
    const failCount = new Map<string, number>();
    const maxRounds = 8, maxFails = 3;
    for (let round = 0; round < maxRounds; round++) {
      const seeds = collectSeeds(); // excludes already-succeeded terms
      if (!seeds.length) break;
      if (res.requests >= maxRequests) {
        res.converged = false;
        break;
      }
      await pool(seeds, searchConcurrency, async (term) => {
        if (queried.has(term) || res.requests >= maxRequests) return;
        const nodes = await withRetry(() => searchAllPages(anon, storeId, term));
        if (nodes === null) {
          const f = (failCount.get(term) ?? 0) + 1;
          failCount.set(term, f);
          if (f >= maxFails) queried.add(term); // give up after repeated throttling
          await jitter(300);
          return;
        }
        queried.add(term);
        res.requests += Math.max(1, Math.ceil(nodes.length / 30));
        absorbNodes(res, nodes);
        await jitter(80); // pace between terms to stay under the burst limit
        progress("search", `round ${round + 1}`);
      });
      progress("search", `round ${round + 1} done`);
    }
    res.searchTerms = queried.size;
  }

  return res;
}

/** Flatten a raw product node (either shape) into a clean record; names cross-filled. */
export function flattenProduct(
  p: any,
  storeId: string,
  names: { catNameById: Map<string, string>; subcatNameById: Map<string, string>; l3NameById: Map<string, string> },
): FlatProduct {
  const pv = p.productVariant ?? {};
  const prod = p.product ?? {};
  const images = (pv.images ?? []).map((im: any) => imageUrl(im?.path)).filter(Boolean);
  const pricingEntities: Record<string, number> = {};
  for (const e of p.pricingData?.pricingEntityPrices ?? []) {
    if (e?.pricingEntity != null) pricingEntities[e.pricingEntity] = e.discountedSellingPrice ?? e.sellingPrice ?? 0;
  }
  const tags = new Set<string>();
  for (const slot of Object.values(p.productCardTags ?? {})) if (Array.isArray(slot)) for (const t of slot) if (t?.tagName) tags.add(t.tagName);
  for (const t of Object.values(p.meta?.tagsV2 ?? {})) if ((t as any)?.tagName) tags.add((t as any).tagName);

  const sellingPrice = p.sellingPrice ?? p.discountedSellingPrice ?? 0;
  const categoryId = categoryIdOf(p);
  const subcategoryId = subcategoryIdOf(p);
  const l3Id = l3IdOf(p);
  const categoryName = categoryNameOf(p) || names.catNameById.get(categoryId) || "";
  const subcategoryName = subcategoryNameOf(p) || names.subcatNameById.get(subcategoryId) || "";
  const l3Name = l3NameOf(p) || names.l3NameById.get(l3Id) || "";

  return {
    storeProductId: storeProductId(p),
    productId: productIdOf(p),
    variantId: variantIdOf(p),
    name: prod.name ?? "",
    brand: prod.brand ?? "",
    brandId: prod.brandId ?? "",
    mrp: p.mrp ?? 0,
    sellingPrice,
    discountedSellingPrice: p.discountedSellingPrice ?? sellingPrice,
    discountAmount: p.discountAmount ?? 0,
    discountPercent: p.discountPercent ?? 0,
    superSaverSellingPrice: p.superSaverSellingPrice ?? 0,
    pricePerUom: p.pricePerUom ?? 0,
    pricingEntities,
    mrpRupees: (p.mrp ?? 0) / 100,
    priceRupees: sellingPrice / 100,
    packSize: pv.formattedPacksize ?? "",
    uom: p.uom ?? p.unitOfMeasure ?? "",
    unitOfMeasure: p.unitOfMeasure ?? p.uom ?? "",
    availableQuantity: p.availableQuantity ?? 0,
    outOfStock: !!p.outOfStock || (p.availableQuantity ?? 0) <= 0,
    isActive: p.isActive !== false,
    categoryId,
    categoryName,
    subcategoryId,
    subcategoryName,
    l3Id,
    l3Name,
    l3CategoryIds: prod.l3CategoryIds ?? (l3Id ? [l3Id] : []),
    description: Array.isArray(prod.description) ? prod.description.join("\n") : prod.description ?? "",
    ingredients: prod.ingredients ?? "",
    countryOfOrigin: prod.countryOfOrigin ?? "",
    manufacturerName: prod.manufacturerName ?? "",
    manufacturerAddress: prod.manufacturerAddress ?? "",
    minimumRequiredAge: prod.minimumRequiredAge ?? 0,
    tags: [...tags],
    images,
    primaryImage: images[0] ?? "",
    source: p.searchFeedBucket != null || p.recommendationId != null ? "search" : "landing",
    storeId,
  };
}

const namesOf = (res: CatalogResult) => ({ catNameById: res.catNameById, subcatNameById: res.subcatNameById, l3NameById: res.l3NameById });

const csvCell = (v: unknown): string => {
  const s = Array.isArray(v) ? v.join("|") : v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Write human-friendly outputs (jsonl/json/csv/taxonomy/meta) to <outDir>. */
export function writeCatalog(res: CatalogResult, outDir: string): { dir: string; count: number } {
  mkdirSync(outDir, { recursive: true });
  const names = namesOf(res);
  const flat = [...res.products.values()].map((p) => flattenProduct(p, res.storeId, names));
  flat.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.subcategoryName.localeCompare(b.subcategoryName) || a.name.localeCompare(b.name));

  const jl = createWriteStream(join(outDir, "products.jsonl"));
  for (const p of res.products.values()) jl.write(JSON.stringify(p) + "\n");
  jl.end();

  writeFileSync(join(outDir, "products.json"), JSON.stringify(flat, null, 2));

  const cols: (keyof FlatProduct)[] = [
    "storeProductId", "name", "brand", "categoryName", "subcategoryName", "l3Name",
    "packSize", "mrpRupees", "priceRupees", "discountPercent", "pricePerUom",
    "availableQuantity", "outOfStock", "source", "variantId", "productId", "primaryImage",
  ];
  writeFileSync(join(outDir, "products.csv"), [cols.join(","), ...flat.map((p) => cols.map((c) => csvCell(p[c])).join(","))].join("\n"));

  writeFileSync(
    join(outDir, "categories.json"),
    JSON.stringify(
      {
        storeId: res.storeId,
        l1Categories: res.l1,
        subcategories: [...res.subcatNameById.entries()].map(([id, name]) => ({ id, name })),
        l3categories: [...res.l3NameById.entries()].map(([id, name]) => ({ id, name })),
      },
      null,
      2,
    ),
  );

  const byCat: Record<string, number> = {};
  for (const p of flat) byCat[p.categoryName || "(unknown)"] = (byCat[p.categoryName || "(unknown)"] ?? 0) + 1;
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        storeId: res.storeId,
        method: "landing BFS + search sweep, unioned + name-cross-filled, dedup by storeProductId",
        totalProducts: res.products.size,
        requests: res.requests,
        subcategoriesVisited: res.subcategoriesVisited,
        searchTerms: res.searchTerms,
        converged: res.converged,
        productsByCategory: byCat,
      },
      null,
      2,
    ),
  );

  return { dir: resolve(outDir), count: res.products.size };
}

/** Emit normalized NDJSON collections for MongoDB, linked by natural Zepto UUIDs. */
export function writeMongoCollections(res: CatalogResult, outDir: string): {
  dir: string;
  collections: { name: string; file: string; count: number }[];
} {
  mkdirSync(outDir, { recursive: true });
  const names = namesOf(res);
  const flat = [...res.products.values()].map((p) => flattenProduct(p, res.storeId, names));

  const categories = new Map<string, any>();
  for (const c of res.l1) categories.set(c.categoryId, { _id: c.categoryId, name: c.name, landingSubcategoryId: c.subCategoryId, level: 1, storeId: res.storeId });

  const subcategories = new Map<string, any>();
  const l3categories = new Map<string, any>();
  const brands = new Map<string, any>();
  for (const p of flat) {
    if (p.categoryId && !categories.has(p.categoryId)) categories.set(p.categoryId, { _id: p.categoryId, name: p.categoryName, level: 1, storeId: res.storeId });
    if (p.subcategoryId && !subcategories.has(p.subcategoryId))
      subcategories.set(p.subcategoryId, { _id: p.subcategoryId, name: p.subcategoryName, categoryId: p.categoryId || null, categoryName: p.categoryName, level: 2, storeId: res.storeId });
    if (p.l3Id && !l3categories.has(p.l3Id)) l3categories.set(p.l3Id, { _id: p.l3Id, name: p.l3Name, subcategoryId: p.subcategoryId || null, categoryId: p.categoryId || null });
    if (p.brandId && !brands.has(p.brandId)) brands.set(p.brandId, { _id: p.brandId, name: p.brand });
  }

  const stores = [{ _id: res.storeId, productCount: res.products.size, subcategoriesVisited: res.subcategoriesVisited, searchTerms: res.searchTerms }];

  const products = flat.map((p) => ({
    _id: p.storeProductId,
    productId: p.productId,
    variantId: p.variantId,
    name: p.name,
    storeId: p.storeId,
    brandId: p.brandId || null,
    brandName: p.brand,
    categoryId: p.categoryId || null,
    categoryName: p.categoryName,
    subcategoryId: p.subcategoryId || null,
    subcategoryName: p.subcategoryName,
    l3Id: p.l3Id || null,
    l3Name: p.l3Name,
    l3CategoryIds: p.l3CategoryIds,
    pricing: {
      mrp: p.mrp,
      sellingPrice: p.sellingPrice,
      discountedSellingPrice: p.discountedSellingPrice,
      discountAmount: p.discountAmount,
      discountPercent: p.discountPercent,
      superSaverSellingPrice: p.superSaverSellingPrice,
      pricePerUom: p.pricePerUom,
      pricingEntities: p.pricingEntities,
      mrpRupees: p.mrpRupees,
      priceRupees: p.priceRupees,
    },
    packSize: p.packSize,
    uom: p.uom,
    unitOfMeasure: p.unitOfMeasure,
    availableQuantity: p.availableQuantity,
    outOfStock: p.outOfStock,
    isActive: p.isActive,
    description: p.description,
    ingredients: p.ingredients,
    countryOfOrigin: p.countryOfOrigin,
    manufacturerName: p.manufacturerName,
    manufacturerAddress: p.manufacturerAddress,
    minimumRequiredAge: p.minimumRequiredAge,
    tags: p.tags,
    images: p.images,
    primaryImage: p.primaryImage,
    source: p.source,
    raw: res.products.get(p.storeProductId),
  }));

  const emit = (name: string, docs: any[]) => {
    const file = join(outDir, `${name}.ndjson`);
    writeFileSync(file, docs.map((d) => JSON.stringify(d)).join("\n") + (docs.length ? "\n" : ""));
    return { name, file, count: docs.length };
  };

  const collections = [
    emit("stores", stores),
    emit("categories", [...categories.values()]),
    emit("subcategories", [...subcategories.values()]),
    emit("l3categories", [...l3categories.values()]),
    emit("brands", [...brands.values()]),
    emit("products", products),
  ];
  return { dir: resolve(outDir), collections };
}

const rupee = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** CLI entry: download the whole catalog for a store and write all output files. */
export async function cmdCatalog(argv: string[]): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const storeId = arg("--store") ?? loadSession()?.storeId;
  if (!storeId) {
    console.error("No storeId. Pass --store <id> or log in once (npm run zepto:login).");
    process.exit(2);
  }
  const concurrency = Number(arg("--concurrency") ?? 8);
  const sweep = !argv.includes("--no-sweep");
  const outDir = arg("--out") ?? join("zepto-catalog", storeId);

  console.log(`Downloading Zepto catalog for store ${storeId}`);
  console.log(`(anonymous catalog plane — no login; landing BFS${sweep ? " + search sweep" : " only"})\n`);

  const t0 = Date.now();
  let lastP = 0;
  const res = await downloadCatalog({
    storeId,
    concurrency,
    sweep,
    onProgress: (s) => {
      if (s.products - lastP >= 100) {
        process.stdout.write(`\r  [${s.phase}] ${s.requests} requests · ${s.products} products${s.note ? " · " + s.note : ""}            `);
        lastP = s.products;
      }
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write("\r" + " ".repeat(78) + "\r");

  const out = writeCatalog(res, outDir);
  writeMongoCollections(res, join(outDir, "mongo"));
  console.log(`✔ ${out.count} unique products in ${secs}s (${res.requests} requests · ${res.subcategoriesVisited} subcats · ${res.searchTerms} search terms${res.converged ? "" : " · HIT CAP"}).\n`);

  const names = namesOf(res);
  const flat = [...res.products.values()].map((p) => flattenProduct(p, storeId, names));
  const byCat = new Map<string, { n: number; min: number; max: number }>();
  for (const p of flat) {
    const k = p.categoryName || "(unknown)";
    const e = byCat.get(k) ?? { n: 0, min: Infinity, max: 0 };
    e.n++;
    if (p.sellingPrice > 0) e.min = Math.min(e.min, p.sellingPrice);
    e.max = Math.max(e.max, p.sellingPrice);
    byCat.set(k, e);
  }
  console.log("By category:");
  for (const [k, e] of [...byCat.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(5)}  ${k.padEnd(28)} ${rupee(isFinite(e.min) ? e.min : 0)}–${rupee(e.max)}`);
  }

  console.log(`\nWritten to ${out.dir}/`);
  console.log("  products.jsonl / products.json / products.csv / categories.json / meta.json");
  console.log("  mongo/*.ndjson   normalized collections for mongoimport");
}
