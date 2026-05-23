/**
 * One-off experiment: figure out the right method/params/auth for the commerce
 * plane (cart, search, store-products, serviceability). Prints raw status, the
 * `server`/`via` headers (to tell Kong vs CloudFront/WAF), and the message.
 *
 *   tsx src/zepto/probe-commerce.ts
 */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p.replace(/^\//, "")}`;

async function main() {
  const s = loadSession();
  if (!s) throw new Error("no session");
  const http = new ZeptoHttp({
    deviceId: s.deviceId,
    sessionId: s.sessionId,
    cookies: s.cookies,
    token: s.token,
    storeId: s.storeId,
  });
  const store = s.storeId!;
  console.log("storeId:", store, "\n");

  const trials: Array<{ label: string; method: "GET" | "POST"; url: string; body?: any; extra?: Record<string, string> }> = [
    // cart — try methods + storeId placements
    { label: "cart GET", method: "GET", url: U("cfs/api/v1/cart") },
    { label: "cart GET ?storeId", method: "GET", url: U(`cfs/api/v1/cart?storeId=${store}`) },
    { label: "cart POST {storeId}", method: "POST", url: U("cfs/api/v1/cart"), body: { storeId: store } },
    { label: "cart-service GET", method: "GET", url: U("cart-service/api/v1/cart") },
    // serviceability — try richer params
    { label: "svc GET lat/lng/placeId", method: "GET", url: U(`serviceability-service/api/v1/serviceability?latitude=${0}&longitude=${0}`) },
    // store-products — method/version
    { label: "store-products v3 POST", method: "POST", url: U("product-assortment-service/api/v3/store-products"), body: { storeId: store, pageNumber: 0, storeIds: [store] } },
    { label: "store-products v2 POST", method: "POST", url: U("product-assortment-service/api/v2/store-products"), body: { storeId: store, pageNumber: 0 } },
    // search — bearer vs anonymous (X-WITHOUT-BEARER)
    { label: "search bearer", method: "POST", url: U("user-search-service/api/v3/search"), body: { query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: store, storeIds: [store] } },
    { label: "search X-WITHOUT-BEARER", method: "POST", url: U("user-search-service/api/v3/search"), body: { query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: store, storeIds: [store] }, extra: { "X-WITHOUT-BEARER": "true" } },
  ];

  for (const t of trials) {
    try {
      // raw fetch through the client but capture headers too
      const res = await http.signed(t.method, t.url, t.body, t.extra);
      const msg = (res.json as any)?.message ?? (res.json as any)?.error ?? "";
      console.log(`${pad(t.label, 26)} ${res.status}  ${shortShape(res.json) || res.text.slice(0, 70)}  ${msg ? "« " + msg + " »" : ""}`);
    } catch (e) {
      console.log(`${pad(t.label, 26)} ERR ${(e as Error).message}`);
    }
  }
}

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}
function shortShape(j: unknown): string {
  if (j === null || typeof j !== "object") return "";
  const keys = Object.keys(j as object).slice(0, 8);
  return "{" + keys.join(",") + "}";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
