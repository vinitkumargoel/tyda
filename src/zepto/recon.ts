/**
 * zepto recon — probe the authenticated API surface with the saved session.
 *
 *   tsx src/zepto/recon.ts
 *
 * Loads ~/.tyda-zepto/session.json, then walks a catalogue of READ-ONLY endpoints
 * (addresses, cart, payment, orders, profile, loyalty, search, …) recording HTTP
 * status + a compact response-shape summary. Mutating endpoints (place order, add
 * money, add address, apply coupon, checkout) are NOT called.
 *
 * Two phases: phase 1 needs no store (user/addresses/orders/loyalty) and is used
 * to resolve a storeId (from serviceability on a saved address, falling back to a
 * past order); phase 2 uses that storeId for cart/search/products. Results are
 * written to ~/.tyda-zepto/recon-<ts>.json and printed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ZeptoHttp, ZEPTO_BFF } from "./auth/http-client.js";
import { loadSession, saveSession, ZEPTO_DIR, isTokenExpired, userLabel } from "./auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p.replace(/^\//, "")}`;

interface Ctx {
  storeId?: string;
  storeIds: string[];
  lat?: number;
  lng?: number;
  addressId?: string;
  orderId?: string;
  orderStoreId?: string;
}

interface Probe {
  name: string;
  category: string;
  method: "GET" | "POST";
  phase: 1 | 2;
  /** Which auth world: bearer (account plane) or anon X-WITHOUT-BEARER (catalog plane). */
  auth: "bearer" | "anon";
  url: (c: Ctx) => string;
  body?: (c: Ctx) => Record<string, unknown> | undefined;
  extract?: (json: unknown, c: Ctx) => void;
  skip?: (c: Ctx) => string | null;
}

interface Result {
  name: string;
  category: string;
  method: string;
  path: string;
  status: number | string;
  ok: boolean;
  shape?: string;
  message?: string;
  note?: string;
}

function shape(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `[${shape(v[0], depth + 1)} ×${v.length}]` : "[]";
  const t = typeof v;
  if (t !== "object") return t;
  if (depth >= 3) return "{…}";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).slice(0, 16);
  return `{ ${keys.map((k) => `${k}: ${shape(o[k], depth + 1)}`).join(", ")}${
    Object.keys(o).length > 16 ? ", …" : ""
  } }`;
}

const PROBES: Probe[] = [
  // ---------- phase 1: account plane (bearer), no store needed ----------
  { name: "customer info v2", category: "user", phase: 1, auth: "bearer", method: "GET", url: () => U("api/v2/user/customer/info/") },
  { name: "referrals", category: "user", phase: 1, auth: "bearer", method: "GET", url: () => U("api/v1/user/customer/referrals/") },
  {
    name: "addresses",
    category: "address",
    phase: 1,
    auth: "bearer",
    method: "GET",
    url: () => U("api/v1/user/customer/addresses/"),
    extract: (j, c) => {
      const arr = (j as any)?.userAddresses ?? (j as any)?.addresses;
      const a = Array.isArray(arr) ? arr[0] : undefined;
      if (a) {
        c.addressId = a.id ?? a.addressId;
        c.lat = Number(a.latitude ?? a.lat);
        c.lng = Number(a.longitude ?? a.lng);
      }
    },
  },
  {
    name: "order history",
    category: "orders",
    phase: 1,
    auth: "bearer",
    method: "GET",
    url: () => U("api/v2/order/"),
    extract: (j, c) => {
      const arr = (j as any)?.orders;
      const o = Array.isArray(arr) ? arr[0] : undefined;
      if (o) {
        c.orderId = o.id ?? o.code;
        c.orderStoreId = o.storeId;
      }
    },
  },
  { name: "last ongoing order", category: "orders", phase: 1, auth: "bearer", method: "GET", url: () => U("post-order-service/api/v2/order/last-ongoing-order") },
  {
    name: "order status/details",
    category: "orders",
    phase: 1,
    auth: "bearer",
    method: "GET",
    url: (c) => U(`api/v3/order/${c.orderId}/status/`),
    skip: (c) => (c.orderId ? null : "no orderId"),
  },
  { name: "zepto pass overview", category: "loyalty", phase: 1, auth: "bearer", method: "GET", url: () => U("api/v1/pass/overview") },
  { name: "zepto coins balance", category: "loyalty", phase: 1, auth: "bearer", method: "GET", url: () => U("zepto-coins/api/v1/coin/balance") },
  { name: "zepto coins overview", category: "loyalty", phase: 1, auth: "bearer", method: "GET", url: () => U("zepto-coins/api/v1/coin/overview") },
  { name: "zepto coins ledgers", category: "loyalty", phase: 1, auth: "bearer", method: "GET", url: () => U("zepto-coins/api/v1/coin/ledgers") },

  // ---------- phase 2: catalog plane (anonymous X-WITHOUT-BEARER) ----------
  {
    name: "search (query=milk)",
    category: "catalog",
    phase: 2,
    auth: "anon",
    method: "POST",
    url: () => U("user-search-service/api/v3/search"),
    skip: (c) => (c.storeId ? null : "no storeId"),
    body: (c) => ({ query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: c.storeId, storeIds: [c.storeId], intentId: "recon", userSessionId: "recon" }),
  },
  {
    name: "search filters",
    category: "catalog",
    phase: 2,
    auth: "anon",
    method: "POST",
    url: () => U("user-search-service/api/v3/search/filters"),
    skip: (c) => (c.storeId ? null : "no storeId"),
    body: (c) => ({ query: "milk", pageNumber: 0, storeId: c.storeId, storeIds: [c.storeId] }),
  },
  {
    name: "lms get_page HOME",
    category: "catalog",
    phase: 2,
    auth: "anon",
    method: "POST",
    url: () => U("lms/api/v2/get_page"),
    skip: (c) => (c.storeId ? null : "no storeId"),
    body: (c) => ({ pageType: "HOME", storeId: c.storeId, storeIds: [c.storeId] }),
  },

  // ---------- cart plane (bearer + cartId): listed, not exercised here ----------
  {
    name: "cart (needs cartId via create)",
    category: "cart",
    phase: 2,
    auth: "bearer",
    method: "GET",
    url: () => U("cfs/api/v1/cart"),
  },
];

async function runProbe(http: ZeptoHttp, anon: ZeptoHttp, p: Probe, ctx: Ctx): Promise<Result> {
  const fullUrl = p.url(ctx);
  const path = new URL(fullUrl).pathname;
  const base = { name: p.name, category: p.category, method: p.method, path };
  const skip = p.skip?.(ctx);
  if (skip) return { ...base, status: "skip", ok: false, note: skip };
  const client = p.auth === "anon" ? anon : http;
  const extra: Record<string, string> = p.auth === "anon" ? { "X-WITHOUT-BEARER": "true" } : {};
  try {
    const res = await client.signed(p.method, fullUrl, p.body?.(ctx), extra);
    const ok = res.status >= 200 && res.status < 300;
    if (ok) p.extract?.(res.json, ctx);
    const msg = (res.json as any)?.message ?? (res.json as any)?.error;
    return {
      ...base,
      status: res.status,
      ok,
      shape: res.json !== undefined ? shape(res.json) : truncate(res.text),
      message: !ok && typeof msg === "string" ? msg : undefined,
    };
  } catch (e) {
    return { ...base, status: "ERR", ok: false, note: (e as Error).message };
  }
}

async function main() {
  const session = loadSession();
  if (!session) {
    console.error("No session. Run: npm run zepto:login");
    process.exit(2);
  }
  if (isTokenExpired(session)) {
    console.error("Token expired — run: npm run zepto:login (or refresh).");
  }
  console.log(`Session: ${userLabel(session.user, session.phone)}`);
  console.log(`Token: ${session.token ? "present" : "MISSING"}  expired=${isTokenExpired(session)}\n`);

  const http = new ZeptoHttp({
    deviceId: session.deviceId,
    sessionId: session.sessionId,
    cookies: session.cookies,
    token: session.token,
    storeId: session.storeId,
  });

  // Anonymous client for the catalog plane (its own CSRF, no bearer).
  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();

  const ctx: Ctx = { storeIds: [], storeId: session.storeId };
  const results: Result[] = [];

  for (const p of PROBES.filter((x) => x.phase === 1)) results.push(await runProbe(http, anon, p, ctx));

  // Resolve a storeId for phase 2 from a past order (serviceability needs a regionId).
  if (!ctx.storeId && ctx.orderStoreId) ctx.storeId = ctx.orderStoreId;
  http.storeId = ctx.storeId;
  anon.storeId = ctx.storeId;
  if (ctx.storeId && ctx.storeId !== session.storeId) {
    saveSession({ ...session, storeId: ctx.storeId });
  }

  for (const p of PROBES.filter((x) => x.phase === 2)) results.push(await runProbe(http, anon, p, ctx));

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(pad("ST", 7) + pad("CATEGORY", 14) + pad("ENDPOINT", 26) + "PATH");
  for (const r of results) {
    const mark = r.ok ? "✓" : r.status === "skip" ? "–" : "✗";
    const extra = r.message ? `  «${r.message}»` : r.note ? `  (${r.note})` : "";
    console.log(`${mark}${pad(String(r.status), 6)}${pad(r.category, 14)}${pad(r.name, 26)}${r.path}${extra}`);
  }
  console.log(`\nstoreId=${ctx.storeId ?? "(none)"}  addressId=${ctx.addressId ?? "(none)"}  orderId=${ctx.orderId ?? "(none)"}`);

  const out = join(ZEPTO_DIR, `recon-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ctx, results }, null, 2));
  console.log("Full →", out);
}

function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
