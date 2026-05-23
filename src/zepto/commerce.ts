/**
 * Zepto commerce: catalog search (anonymous plane) + cart (bearer plane).
 *
 * Verified live up to — but NOT including — placing an order. The cart write path
 * is `cfs/api/v1/cart/create` ("UpdateCartV2", set-cart semantics): it requires
 * latitude/longitude + addressId + deliveryInstructions{} in the body, a `storeIds`
 * header, and the items under the `cartProducts` field. It returns the whole cart
 * with the full bill (item total, delivery/handling fees, toPay), wallet balance,
 * coupons, COD availability and ETA.
 *
 *   tsx src/zepto/cli.ts search <query>          # anonymous catalog search
 *   tsx src/zepto/cli.ts cart-demo <query>       # search → add 1 → read bill → CLEAR (safe)
 *   tsx src/zepto/cli.ts cart-demo <query> --keep  # leave the item in the cart
 *   tsx src/zepto/cli.ts cart-clear              # empty the cart
 */
import { ZeptoHttp, ZEPTO_BFF } from "./auth/http-client.js";
import { loadSession, saveSession, type ZeptoSession } from "./auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p}`;

export interface Product {
  name: string;
  pvid: string;
  storeProductId: string;
  productId: string;
  price: number; // paise
  mrp: number;
  outOfStock: boolean;
  image: string; // CDN thumbnail URL ("" if none)
}

/** Build a CDN thumbnail URL from a productVariant image path (bigger source → sharper art). */
export function thumbUrl(path: string | undefined, w = 240): string {
  return path ? `https://cdn.zeptonow.com/production/tr:w-${w},h-${w}/${path}` : "";
}

export interface CartItem {
  productVariantId: string;
  storeProductId: string;
  productId: string;
  quantity: number;
}

export interface DeliveryCtx {
  latitude: number;
  longitude: number;
  addressId: string;
  storeId: string;
}

export interface BillSummary {
  itemCount: number;
  itemTotal: number;
  deliveryFee: number;
  handlingFee: number;
  toPay: number;
  grandTotal: number;
  eta: string;
  paymentFlow: string;
  walletBalance: number;
  cartId: string;
}

function findProducts(obj: any, out: any[] = [], depth = 0): any[] {
  if (!obj || typeof obj !== "object" || depth > 8) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) findProducts(x, out, depth + 1);
    return out;
  }
  if (obj.productVariant && (obj.sellingPrice != null || obj.mrp != null)) out.push(obj);
  for (const k of Object.keys(obj)) findProducts(obj[k], out, depth + 1);
  return out;
}

/** Anonymous catalog search (X-WITHOUT-BEARER). Returns simplified products. */
export async function searchProducts(query: string, storeId: string): Promise<Product[]> {
  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();
  anon.storeId = storeId;
  const res = await anon.signed(
    "POST",
    U("user-search-service/api/v3/search"),
    { query, pageNumber: 0, mode: "AUTOSUGGEST", storeId, storeIds: [storeId], intentId: "cli", userSessionId: anon.sessionId },
    { "X-WITHOUT-BEARER": "true" },
  );
  const raw = findProducts(res.json);
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of raw) {
    const pvid = p.productVariant?.id;
    if (!pvid || seen.has(pvid)) continue;
    seen.add(pvid);
    out.push({
      name: p.product?.name ?? "?",
      pvid,
      storeProductId: p.id ?? p.objectId,
      productId: p.product?.id,
      price: p.sellingPrice ?? p.discountedSellingPrice ?? 0,
      mrp: p.mrp ?? 0,
      outOfStock: !!p.outOfStock || (p.availableQuantity ?? 0) <= 0,
      image: thumbUrl(p.productVariant?.images?.[0]?.path),
    });
  }
  return out;
}

/**
 * Resolve the active storeId. Serviceability needs a regionId we don't have, so we
 * read it off the most recent order (works for any account that has ordered before).
 * Cached into the session.
 */
export async function resolveStoreId(http: ZeptoHttp, session: ZeptoSession): Promise<string | undefined> {
  if (session.storeId) return session.storeId;
  const r = await http.signed("GET", U("api/v2/order/"));
  const sid = ((r.json as any)?.orders ?? [])[0]?.storeId as string | undefined;
  if (sid) {
    session.storeId = sid;
    saveSession(session);
  }
  return sid;
}

/** Resolve delivery context (lat/lng + addressId from saved address, storeId from session/orders). */
export async function getDeliveryContext(http: ZeptoHttp, session: ZeptoSession): Promise<DeliveryCtx> {
  const a = await http.signed("GET", U("api/v1/user/customer/addresses/"));
  const addr = ((a.json as any)?.userAddresses ?? [])[0];
  if (!addr) throw new Error("no saved address on the account");
  const storeId = session.storeId ?? (await resolveStoreId(http, session));
  if (!storeId) throw new Error("could not resolve storeId (no past orders to read it from)");
  return { latitude: Number(addr.latitude), longitude: Number(addr.longitude), addressId: addr.id, storeId };
}

/** Set the cart to exactly these items (empty array clears it). Returns the raw cart. */
export async function setCart(http: ZeptoHttp, ctx: DeliveryCtx, cartProducts: CartItem[]): Promise<any> {
  const res = await http.signed(
    "POST",
    U("cfs/api/v1/cart/create"),
    {
      latitude: ctx.latitude,
      longitude: ctx.longitude,
      storeId: ctx.storeId,
      addressId: ctx.addressId,
      deliveryInstructions: {},
      cartProducts,
    },
    { storeIds: ctx.storeId, store_ids: ctx.storeId },
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`cart/create failed (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
  }
  return res.json;
}

export const addItem = (http: ZeptoHttp, ctx: DeliveryCtx, item: CartItem) => setCart(http, ctx, [item]);
export const clearCart = (http: ZeptoHttp, ctx: DeliveryCtx) => setCart(http, ctx, []);

export function billSummary(cart: any): BillSummary {
  const eta =
    (cart.storeLevelCartProducts ?? [])[0]?.title ??
    (cart.etaInMinutes ? `${cart.etaInMinutes} mins` : "");
  return {
    itemCount: cart.itemQuantityCount ?? 0,
    itemTotal: cart.itemTotalAmount ?? 0,
    deliveryFee: cart.deliveryFee ?? 0,
    handlingFee: (cart.fees ?? []).find((f: any) => /PACKAGING|HANDLING/i.test(f.type))?.amount ?? 0,
    toPay: cart.toPay ?? cart.grandTotalAmount ?? 0,
    grandTotal: cart.grandTotalAmount ?? 0,
    eta,
    paymentFlow: cart.paymentDetails?.paymentFlow ?? "?",
    walletBalance: cart.totalWalletBalance ?? 0,
    cartId: cart.cartId,
  };
}

const rupee = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

function clientFor(session: ZeptoSession): ZeptoHttp {
  return new ZeptoHttp({
    deviceId: session.deviceId,
    sessionId: session.sessionId,
    cookies: session.cookies,
    token: session.token,
    storeId: session.storeId,
  });
}

// ---------------- CLI entry points (used by cli.ts) ----------------

export async function cmdSearch(query: string): Promise<void> {
  const s = loadSession();
  if (!s?.token) {
    console.error("Log in first: npm run zepto:login");
    process.exit(2);
  }
  const storeId = s.storeId ?? (await resolveStoreId(clientFor(s), s));
  if (!storeId) {
    console.error("Could not resolve a storeId (no past orders). Place an order in the app first, or run recon.");
    process.exit(1);
  }
  const prods = await searchProducts(query || "milk", storeId);
  console.log(`search "${query}" @ store ${storeId}: ${prods.length} products\n`);
  for (const p of prods.slice(0, 10)) {
    console.log(`  ${p.outOfStock ? "✗OOS" : "✓   "} ${rupee(p.price)}  ${p.name}`);
  }
}

export async function cmdCartDemo(query: string, keep: boolean): Promise<void> {
  const s = loadSession();
  if (!s?.token) {
    console.error("Not logged in. Run: npm run zepto:login");
    process.exit(2);
  }
  const http = clientFor(s);
  const ctx = await getDeliveryContext(http, s);
  console.log(`store=${ctx.storeId}  addr=${ctx.addressId}  (${ctx.latitude},${ctx.longitude})\n`);

  const prods = await searchProducts(query || "milk", ctx.storeId);
  const pick = prods.find((p) => !p.outOfStock);
  if (!pick) {
    console.error(`No in-stock product for "${query}".`);
    process.exit(1);
  }
  console.log(`Adding: ${pick.name} @ ${rupee(pick.price)}`);

  const cart = await addItem(http, ctx, {
    productVariantId: pick.pvid,
    storeProductId: pick.storeProductId,
    productId: pick.productId,
    quantity: 1,
  });
  const b = billSummary(cart);
  console.log("\n── Cart bill ───────────────────────────────");
  console.log(`  cartId       : ${b.cartId}`);
  console.log(`  items        : ${b.itemCount}`);
  console.log(`  item total   : ${rupee(b.itemTotal)}`);
  console.log(`  delivery fee : ${rupee(b.deliveryFee)}`);
  console.log(`  handling fee : ${rupee(b.handlingFee)}`);
  console.log(`  TO PAY       : ${rupee(b.toPay)}`);
  console.log(`  ETA          : ${b.eta}`);
  console.log(`  payment flow : ${b.paymentFlow}`);
  console.log(`  wallet (Zepto Cash): ${rupee(b.walletBalance)}`);
  console.log("────────────────────────────────────────────");
  console.log("\n[STOP] Not placing the order (api/v3/order/) — by design.");

  if (keep) {
    console.log("Left the item in your cart (--keep). Clear with: npm run zepto:cart-clear");
  } else {
    await clearCart(http, ctx);
    console.log("Cleaned up: cart cleared (account left as found).");
  }
}

export async function cmdCartClear(): Promise<void> {
  const s = loadSession();
  if (!s?.token) {
    console.error("Not logged in. Run: npm run zepto:login");
    process.exit(2);
  }
  const http = clientFor(s);
  const ctx = await getDeliveryContext(http, s);
  const cart = await clearCart(http, ctx);
  console.log(`Cart cleared. items now: ${billSummary(cart).itemCount}`);
}

void saveSession; // reserved for future storeId persistence
