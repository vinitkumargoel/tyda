/**
 * Can the catalog (search) be reached over pure HTTP — anonymously (X-WITHOUT-BEARER)
 * or with the bearer? Tells us whether the commerce plane truly needs a browser.
 *   tsx src/zepto/tools/probe-search.ts
 */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

const SEARCH = `${ZEPTO_BFF}/user-search-service/api/v3/search`;

async function main() {
  const s = loadSession();
  const store = s?.storeId ?? "d5da3809-1327-4050-b59b-43342ea74482";

  // 1) anonymous: fresh CSRF, NO bearer, X-WITHOUT-BEARER:true
  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();
  anon.storeId = store;
  const body = { query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: store, storeIds: [store], intentId: "probe", userSessionId: anon.sessionId };
  const a = await anon.signed("POST", SEARCH, body, { "X-WITHOUT-BEARER": "true" });
  console.log("search  anon:", a.status, msg(a));

  // 2) authed bearer search (from session) — expected to fail (catalog wants cookie/anon)
  if (s?.token) {
    const authed = new ZeptoHttp({ deviceId: s.deviceId, sessionId: s.sessionId, cookies: s.cookies, token: s.token, storeId: store });
    const b = await authed.signed("POST", SEARCH, body);
    console.log("search  bearer:", b.status, msg(b));
  }

  // 3) rest of catalog plane, anonymously
  const U = (p: string) => `${ZEPTO_BFF}/${p}`;
  const wb = { "X-WITHOUT-BEARER": "true" };
  const cat: Array<[string, string, any]> = [
    ["store-products v3", U("product-assortment-service/api/v3/store-products"), { storeId: store, pageNumber: 0, storeIds: [store] }],
    ["homepage feed v2", U("product-assortment-service/api/v2/homepage/vertical-feed"), { storeId: store, pageNumber: 0 }],
    ["lms get_page HOME", U("lms/api/v2/get_page"), { pageType: "HOME", storeId: store, storeIds: [store] }],
    ["search filters", U("user-search-service/api/v3/search/filters"), { query: "milk", storeId: store, storeIds: [store] }],
  ];
  for (const [name, url, b] of cat) {
    const r = await anon.signed("POST", url, b, wb);
    console.log(`${name}: ${r.status} ${msg(r)}`);
  }
  // cart anon
  const c = await anon.signed("GET", U("cfs/api/v1/cart"), undefined, wb);
  console.log("cart anon GET:", c.status, msg(c));
}

function srv(r: { text: string }) {
  return "";
}
function msg(r: { json: unknown; text: string }) {
  const j = r.json as any;
  if (j?.message) return "« " + j.message + " »";
  if (j && typeof j === "object") return "{" + Object.keys(j).slice(0, 8).join(",") + "}";
  return r.text.slice(0, 80);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
