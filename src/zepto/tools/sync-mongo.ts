/**
 * Incremental Zepto catalog → MongoDB sync (UPSERT, non-destructive).
 *
 * Downloads the live catalog, then ADDS new products and UPDATES existing ones in
 * the `zepto` DB (match on _id). Products that vanished from the catalog are flagged
 * inactive (isActive:false, outOfStock:true, delistedAt) rather than deleted. Prints
 * a change report (added / price-changed / stock-changed / delisted / back-in-stock)
 * and writes a timestamped changelog. Re-run any time — it converges (each run also
 * fills in products an earlier throttled run missed).
 *
 *   ZEPTO_MONGO_URI='mongodb://admin:***@192.168.0.234:27017/zepto?authSource=admin' \
 *     npm run zepto:sync-mongo -- [--store <id>] [--no-sweep] [--keep-removed] [--concurrency 8]
 *
 * The URI carries credentials, so it is passed via env — never hard-coded here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCatalog, writeMongoCollections, writeCatalog, flattenProduct } from "../catalog.js";
import { loadSession } from "../auth/session.js";

const COLLECTIONS = ["stores", "categories", "subcategories", "l3categories", "brands", "products"];

function mongosh(uri: string, js: string): string {
  return execFileSync("mongosh", [uri, "--quiet", "--eval", js], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
function mongoimportUpsert(uri: string, collection: string, file: string): string {
  return execFileSync(
    "mongoimport",
    ["--uri", uri, "--collection", collection, "--mode", "upsert", "--upsertFields", "_id", "--type", "json", "--file", file],
    { encoding: "utf8" },
  );
}

interface Fp { p?: number; m?: number; o?: boolean; n?: string }

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const uri = process.env.ZEPTO_MONGO_URI;
  if (!uri) { console.error("Set ZEPTO_MONGO_URI (mongodb://…/zepto?authSource=admin)."); process.exit(2); }
  const storeId = arg("--store") ?? loadSession()?.storeId;
  if (!storeId) { console.error("No storeId. Pass --store <id> or log in once."); process.exit(2); }
  const concurrency = Number(arg("--concurrency") ?? 8);
  const sweep = !argv.includes("--no-sweep");
  const markRemoved = !argv.includes("--keep-removed");
  const stamp = new Date().toISOString();

  // ---- 1. read current DB fingerprint (projected, small) ----
  console.log("Reading current DB state…");
  let existing = new Map<string, Fp>();
  try {
    const out = mongosh(uri, `db.products.find({storeId:${JSON.stringify(storeId)}},{pricing:{sellingPrice:1,mrp:1},outOfStock:1,name:1}).forEach(d=>print(JSON.stringify({_id:d._id,p:d.pricing&&d.pricing.sellingPrice,m:d.pricing&&d.pricing.mrp,o:d.outOfStock,n:d.name})))`);
    for (const line of out.split("\n")) { if (!line.trim()) continue; const d = JSON.parse(line); existing.set(d._id, { p: d.p, m: d.m, o: d.o, n: d.n }); }
  } catch { console.log("  (no existing products — first load)"); }
  console.log(`  ${existing.size} products currently in DB\n`);

  // ---- 2. download fresh catalog ----
  console.log(`Downloading catalog for store ${storeId} (${sweep ? "landings + search sweep" : "landings only"})…`);
  let lastP = 0;
  const res = await downloadCatalog({
    storeId, concurrency, sweep,
    onProgress: (s) => { if (s.products - lastP >= 100) { process.stdout.write(`\r  [${s.phase}] ${s.requests} req · ${s.products} products${s.note ? " · " + s.note : ""}        `); lastP = s.products; } },
  });
  process.stdout.write("\r" + " ".repeat(78) + "\r");
  console.log(`  fetched ${res.products.size} products · ${res.searchTerms} search terms · ${res.converged ? "converged" : "HIT CAP"}\n`);

  // ---- 3. diff ----
  const names = { catNameById: res.catNameById, subcatNameById: res.subcatNameById, l3NameById: res.l3NameById };
  const fresh = [...res.products.values()].map((p) => flattenProduct(p, storeId, names));
  const freshIds = new Set(fresh.map((p) => p.storeProductId));
  const added: string[] = [], priceChanged: any[] = [], stockChanged: string[] = [];
  for (const p of fresh) {
    const e = existing.get(p.storeProductId);
    if (!e) { added.push(p.name); continue; }
    if (e.p !== p.sellingPrice || e.m !== p.mrp) priceChanged.push({ name: p.name, from: (e.p ?? 0) / 100, to: p.sellingPrice / 100 });
    if (!!e.o !== !!p.outOfStock) stockChanged.push(`${p.outOfStock ? "→OOS" : "→back"} ${p.name}`);
  }
  const removed = [...existing.keys()].filter((id) => !freshIds.has(id));

  // ---- 4. write NDJSON + upsert ----
  const tmp = mkdtempSync(join(tmpdir(), "zepto-sync-"));
  writeMongoCollections(res, tmp);
  writeCatalog(res, join("zepto-catalog", storeId)); // refresh the on-disk flat files too
  console.log("Upserting collections:");
  for (const c of COLLECTIONS) {
    const r = mongoimportUpsert(uri, c, join(tmp, `${c}.ndjson`));
    const m = r.match(/(\d+) document\(s\) imported/);
    console.log(`  ${c.padEnd(14)} ${m ? m[1] : "?"} upserted`);
  }

  // ---- 5. flag delisted (non-destructive) ----
  if (markRemoved && removed.length) {
    const js = join(tmp, "mark-removed.js");
    writeFileSync(js, `db.products.updateMany({_id:{$in:${JSON.stringify(removed)}}},{$set:{isActive:false,outOfStock:true,delistedAt:${JSON.stringify(stamp)}}});`);
    mongosh(uri, `load(${JSON.stringify(js)})`);
  }

  // ---- 6. indexes (idempotent) ----
  mongosh(uri, `["categoryId","subcategoryId","brandId","l3Id","storeId","name"].forEach(f=>db.products.createIndex({[f]:1}));db.products.createIndex({"pricing.discountPercent":-1});db.subcategories.createIndex({categoryId:1});db.l3categories.createIndex({subcategoryId:1});`);

  // ---- 7. report + changelog ----
  console.log("\n──────── sync report ────────");
  console.log(`  added         : ${added.length}`);
  console.log(`  price changed : ${priceChanged.length}`);
  console.log(`  stock changed : ${stockChanged.length}`);
  console.log(`  delisted      : ${removed.length}${markRemoved ? " (flagged inactive)" : " (left as-is)"}`);
  console.log(`  DB total now  : ${existing.size + added.length}`);
  if (added.length) console.log("  e.g. new:", added.slice(0, 5).join(" · "));
  if (priceChanged.length) console.log("  e.g. price:", priceChanged.slice(0, 3).map((c) => `${c.name} ₹${c.from}→₹${c.to}`).join(" · "));

  const logPath = join("zepto-catalog", storeId, `sync-${stamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(logPath, JSON.stringify({ at: stamp, storeId, fetched: res.products.size, added: added.length, priceChanged, stockChanged, removed, converged: res.converged }, null, 2));
  console.log(`\nchangelog → ${logPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
