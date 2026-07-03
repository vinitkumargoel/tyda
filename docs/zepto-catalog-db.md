# Zepto catalog → MongoDB (`zepto` database)

Full product catalog for a Zepto dark store, downloaded from the **anonymous catalog
plane** (no login needed — only a serviceable `storeId` + a fresh CSRF bootstrap) and
loaded into the production MongoDB as a normalized, linked schema.

## How the data is obtained

There is **no single "all products" endpoint**, and the category *landing* pages are
curated (~30–40 items each). The whole store is reached by unioning **two** sources
(dedup by `storeProductId`):

1. **Landing BFS** — `lms/api/v2/get_page` `SUBCATEGORY`, seeded from HOME's L1
   categories and expanded over every `primarySubcategoryId` seen. Gives the full
   **taxonomy** (category / subcategory / L3 ids + names) and ~⅓ of the catalog.
2. **Search sweep** — `user-search-service/api/v3/search` is the real product index
   (paginates 30/page, ~200/term). It's swept with every subcategory / L3 / brand
   name harvested in step 1, which recalls the rest of the catalog.

Search nodes are thinner (ids under different keys, no L3/subcategory *names*), so
both shapes are normalized and names are **cross-filled** from the nodes that have
them. Anonymous search is **burst-rate-limited** (HTTP 299 "please login to continue
searching"), so the sweep runs at low concurrency with jittered backoff and retries
throttled terms across rounds. On the reference store the union is **~5.7k–8.5k SKUs**
(re-running the sync converges upward as throttled terms succeed on later passes).

Code: `src/zepto/catalog.ts` (`downloadCatalog`, `flattenProduct`, `writeCatalog`,
`writeMongoCollections`). Discovery probes were one-off (`tools/probe-*.ts`).

## Update / refresh

**Incremental upsert (recommended)** — adds new products, updates existing, flags
delisted ones inactive (never deletes), and prints a change report:

```bash
ZEPTO_MONGO_URI='mongodb://admin:***@192.168.0.234:27017/zepto?authSource=admin' \
  npm run zepto:sync-mongo                 # --store <id> --no-sweep --keep-removed --concurrency 8
```

Re-run any time — it converges (each run also picks up products an earlier throttled
run missed). Writes a `sync-<ts>.json` changelog under `zepto-catalog/<storeId>/`.

**Full rebuild from files** (export then drop-load):

```bash
npm run zepto:export-mongo                 # → zepto-catalog/<storeId>/mongo/*.ndjson
URI="mongodb://admin:***@192.168.0.234:27017/zepto?authSource=admin"   # Tailscale: 100.105.72.106
D=zepto-catalog/<storeId>/mongo
for c in stores categories subcategories l3categories brands products; do
  mongoimport --uri "$URI" --collection "$c" --drop --type json --file "$D/$c.ndjson"
done
```

`npm run zepto:catalog` writes flat files only (`products.jsonl` / `.json` / `.csv` /
`categories.json` / `meta.json`) for non-DB use.

## Schema (collections, linked by natural Zepto UUIDs as `_id`)

| Collection | `_id` | Key fields | Links |
|---|---|---|---|
| `stores` | storeId | productCount, subcategoriesVisited | — |
| `categories` (L1) | categoryId | name, landingSubcategoryId, storeId | — |
| `subcategories` (L2) | subcategoryId | name, **categoryId**, categoryName, storeId | → `categories._id` |
| `l3categories` (L3) | l3Id | name, **subcategoryId**, **categoryId** | → `subcategories._id`, `categories._id` |
| `brands` | brandId | name | — |
| `products` | storeProductId | see below | → category/subcategory/l3/brand/store ids |

### `products` document

```
_id            storeProductId  (the per-store SKU id; this is what cart/create uses)
productId      baseProductId   (catalog product id, stable across stores)
variantId      productVariant.id
name, storeId
brandId  → brands._id          brandName
categoryId → categories._id    categoryName
subcategoryId → subcategories._id   subcategoryName
l3Id → l3categories._id        l3Name, l3CategoryIds[]
pricing {                      // all paise unless *Rupees
  mrp, sellingPrice, discountedSellingPrice, discountAmount, discountPercent,
  superSaverSellingPrice, pricePerUom,
  pricingEntities { SUPER_SAVER, ULTRA_SAVER, … },
  mrpRupees, priceRupees
}
packSize, uom, unitOfMeasure
availableQuantity, outOfStock, isActive
description, ingredients, countryOfOrigin, manufacturerName, manufacturerAddress, minimumRequiredAge
tags[], images[] (full-res CDN URLs), primaryImage
source         "landing" | "search"  (which plane first yielded the product)
delistedAt     ISO time, set by sync when a product vanished from the catalog (isActive:false)
raw { … }                      // the complete original API node — nothing lost
```

`raw` is the unflattened source node, so the document is lossless even though the
first-class fields above cover everything you'd normally query.

## Indexes

```js
db.products.createIndex({categoryId:1});
db.products.createIndex({subcategoryId:1});
db.products.createIndex({brandId:1});
db.products.createIndex({l3Id:1});
db.products.createIndex({storeId:1});
db.products.createIndex({name:1});
db.products.createIndex({"pricing.discountPercent":-1});
db.subcategories.createIndex({categoryId:1});
db.l3categories.createIndex({subcategoryId:1});
db.l3categories.createIndex({categoryId:1});
```

## Example queries

```js
// products in a category, cheapest first
db.products.find({categoryName:"Fruits & Vegetables"}).sort({"pricing.priceRupees":1});

// join product → category/subcategory/brand
db.products.aggregate([
  {$match:{name:/almond/i}},
  {$lookup:{from:"categories",localField:"categoryId",foreignField:"_id",as:"category"}},
  {$lookup:{from:"brands",localField:"brandId",foreignField:"_id",as:"brand"}},
  {$project:{name:1,price:"$pricing.priceRupees",category:{$first:"$category.name"},brand:{$first:"$brand.name"}}}
]);

// SKU count + avg discount per category
db.products.aggregate([
  {$group:{_id:"$categoryName",skus:{$sum:1},avgDiscount:{$avg:"$pricing.discountPercent"}}},
  {$sort:{skus:-1}}
]);
```

## Notes

- **One store.** `storeId d5da3809-…` (Bangalore). Every collection carries `storeId`,
  so a second store can be appended without `--drop` and queries can filter by it.
- **Anonymous plane.** The download needs no valid bearer token — the catalog is fetched
  with `X-WITHOUT-BEARER` + CSRF signing. Only a serviceable `storeId` is required.
- **Prices are paise** (₹ = paise / 100); `*Rupees` convenience fields are provided.
