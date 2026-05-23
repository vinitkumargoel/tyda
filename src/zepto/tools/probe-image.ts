/** Dump a product's image fields so we know how to build the image URL. */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

async function main() {
  const s = loadSession();
  const store = s?.storeId;
  if (!store) throw new Error("no storeId in session");
  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();
  anon.storeId = store;
  const res = await anon.signed(
    "POST",
    `${ZEPTO_BFF}/user-search-service/api/v3/search`,
    { query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: store, storeIds: [store], intentId: "p", userSessionId: anon.sessionId },
    { "X-WITHOUT-BEARER": "true" },
  );
  const found: any[] = [];
  const dig = (o: any, d = 0) => {
    if (!o || typeof o !== "object" || d > 8) return;
    if (Array.isArray(o)) return o.forEach((x) => dig(x, d + 1));
    if (o.productVariant && (o.sellingPrice != null || o.mrp != null)) found.push(o);
    for (const k of Object.keys(o)) dig(o[k], d + 1);
  };
  dig(res.json);
  const p = found[0];
  console.log("product:", p.product?.name);
  console.log("productVariant.images:", JSON.stringify(p.productVariant?.images, null, 2)?.slice(0, 800));
  console.log("product.images:", JSON.stringify(p.product?.images)?.slice(0, 300));
  // hunt for any url-ish strings
  const urls = new Set<string>();
  const hunt = (o: any, d = 0) => {
    if (!o || typeof o !== "object" || d > 6) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string" && /\.(jpg|jpeg|png|webp)/i.test(v)) urls.add(`${k}: ${v}`);
      else dig(v, d + 1), hunt(v, d + 1);
    }
  };
  hunt(p);
  console.log("\nimage-ish strings on product:\n " + [...urls].slice(0, 6).join("\n "));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
