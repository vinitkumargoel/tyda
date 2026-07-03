/**
 * Download the full Zepto catalog for a store and emit normalized NDJSON
 * collections (stores/categories/subcategories/l3categories/brands/products),
 * ready for `mongoimport`. No DB credentials live here — load step is run
 * separately (see the mongoimport commands the tool prints).
 *
 *   tsx src/zepto/tools/export-mongo.ts [--store <id>] [--out <dir>] [--concurrency <n>]
 */
import { downloadCatalog, writeCatalog, writeMongoCollections } from "../catalog.js";
import { loadSession } from "../auth/session.js";
import { join } from "node:path";

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const storeId = arg("--store") ?? loadSession()?.storeId;
  if (!storeId) { console.error("No storeId. Pass --store <id> or log in once."); process.exit(2); }
  const outDir = arg("--out") ?? join("zepto-catalog", storeId, "mongo");
  const concurrency = Number(arg("--concurrency") ?? 6);

  console.log(`Downloading Zepto catalog for store ${storeId} (anonymous plane; landing BFS + search sweep)…\n`);
  const t0 = Date.now();
  let last = 0;
  const res = await downloadCatalog({
    storeId,
    concurrency,
    onProgress: (s) => {
      if (s.products - last >= 100) {
        process.stdout.write(`\r  [${s.phase}] ${s.requests} requests · ${s.products} products${s.note ? " · " + s.note : ""}            `);
        last = s.products;
      }
    },
  });
  process.stdout.write("\r" + " ".repeat(78) + "\r");
  console.log(`✔ ${res.products.size} products · ${res.subcategoriesVisited} subcategories · ${res.searchTerms} search terms · ${res.requests} requests · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${res.converged ? "converged" : "HIT CAP"}\n`);

  // also write the human-friendly files (json/jsonl/csv/taxonomy/meta) next to mongo/
  writeCatalog(res, join(outDir, ".."));
  const out = writeMongoCollections(res, outDir);

  console.log("Normalized collections (NDJSON) →", out.dir);
  for (const c of out.collections) console.log(`  ${c.name.padEnd(15)} ${String(c.count).padStart(5)} docs   ${c.file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
