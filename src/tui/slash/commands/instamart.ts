/**
 * Wave 2 / Track G — Instamart slash commands.
 *
 *  - /products <query>          — search Instamart for the active address
 *  - /add <id> [qty]            — add an item to the Instamart cart
 *                                 (only when the id is an Instamart spinId /
 *                                  productId, i.e. starts with "IP")
 *  - /cart                      — show the Instamart cart with bill breakdown
 *  - /order                     — place the current cart via `checkout`
 *  - /track [orderId]           — poll Instamart order status every 5s
 *  - /orders                    — list recent Instamart orders
 *  - /clear                     — empty the Instamart cart
 */
import type React from "react";
import { createElement, Fragment } from "react";
import { Text } from "ink";
import type { SlashContext } from "../types.js";
import type { SlashHandler } from "./misc.js";

interface ToolEnvelope {
  success: boolean;
  data?: unknown;
  error?: { code?: string; message: string };
  message?: string;
}

function extractToolPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent;
  }
  if (Array.isArray(r.content)) {
    for (const block of r.content as Array<{ type?: string; text?: string }>) {
      if (block?.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text);
        } catch {
          // not JSON
        }
      }
    }
  }
  return raw;
}

function asEnvelope(raw: unknown): ToolEnvelope | null {
  const p = extractToolPayload(raw);
  if (!p || typeof p !== "object") return null;
  return p as ToolEnvelope;
}

interface SearchedVariantView {
  spinId: string;
  label: string;
  price: number;
  available: boolean;
}

interface SearchedProductView {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  variants: SearchedVariantView[];
}

interface CartItemView {
  spinId: string;
  productId: string;
  name: string;
  variantLabel: string;
  price: number;
  quantity: number;
}

interface CartView {
  items: CartItemView[];
  addressId: string | null;
}

interface BillView {
  subtotal: number;
  deliveryFee: number;
  handlingFee: number;
  discount: number;
  total: number;
  appliedCoupon: string | null;
}

interface OrderView {
  id: string;
  state: string;
  etaMinutes: number;
  items: Array<{ name: string; quantity: number; variantLabel: string; price: number }>;
  bill: BillView;
}

interface TrackingView {
  orderId: string;
  state: string;
  etaMinutes: number;
  driver: { name: string; distanceKm: number };
}

function requireActiveAddress(ctx: SlashContext): string | null {
  const id = ctx.state.activeAddressId;
  if (!id) {
    ctx.push({
      kind: "info",
      text: "no address selected — run /address",
    });
    return null;
  }
  return id;
}

function isInstamartId(raw: string): boolean {
  return /^IP\d+/i.test(raw);
}

function pickVariantSpinId(productOrSpin: string): { productId: string; spinIdHint: string | null } {
  // "IP012" -> productId, no variant hint -> first variant
  // "IP012-1kg" -> productId IP012, variantSuffix 1kg
  const m = productOrSpin.match(/^(IP\d+)(?:-(.+))?$/i);
  if (!m) return { productId: productOrSpin.toUpperCase(), spinIdHint: null };
  return { productId: m[1]!.toUpperCase(), spinIdHint: m[2] ? `${m[1]!.toUpperCase()}-${m[2]}` : null };
}

/* ----------------------------- /products ------------------------------ */

async function productsHandler(
  ctx: SlashContext,
  argv: string[],
): Promise<void> {
  const query = argv.join(" ").trim();
  if (!query) {
    ctx.push({ kind: "error", text: "usage: /products <query>" });
    return;
  }
  const addressId = requireActiveAddress(ctx);
  if (!addressId) return;

  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "search_products", { query, addressId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `search_products failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "search failed" });
    return;
  }
  const data = env.data as { products?: SearchedProductView[] } | undefined;
  const products = data?.products ?? [];
  if (products.length === 0) {
    ctx.push({ kind: "info", text: `No Instamart products match "${query}".` });
    return;
  }
  ctx.push({ kind: "info", text: `Found ${products.length} product(s):` });
  for (const p of products) {
    const brand = p.brand ? `${p.brand} ` : "";
    ctx.push({ kind: "info", text: `  ${p.id}  ${brand}${p.name} [${p.category}]` });
    for (const v of p.variants) {
      const oos = v.available ? "" : "  ⚠ OOS";
      ctx.push({
        kind: "info",
        text: `      ${v.spinId}  ${v.label}  ₹${v.price}${oos}`,
      });
    }
  }
}

/* -------------------------------- /add -------------------------------- */

async function addHandler(ctx: SlashContext, argv: string[]): Promise<void> {
  const idRaw = argv[0];
  if (!idRaw) {
    ctx.push({ kind: "error", text: "usage: /add <id> [qty]" });
    return;
  }
  // Only own Instamart-style ids here; Food handles its own.
  if (!isInstamartId(idRaw)) {
    return;
  }
  const qty = Number.parseInt(argv[1] ?? "1", 10);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const addressId = requireActiveAddress(ctx);
  if (!addressId) return;

  const { productId, spinIdHint } = pickVariantSpinId(idRaw);

  // We need the resolved spinId. If the user gave a full spinId we use it;
  // otherwise we ask search_products for the product to fetch the first
  // variant's spinId.
  let spinId = spinIdHint;
  if (!spinId) {
    let raw: unknown;
    try {
      raw = await ctx.mcp.call("im", "search_products", {
        query: productId,
        addressId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.push({ kind: "error", text: `lookup failed: ${msg}` });
      return;
    }
    const env = asEnvelope(raw);
    const hit = (env?.data as { products?: SearchedProductView[] } | undefined)
      ?.products?.find((p) => p.id.toUpperCase() === productId);
    if (!hit) {
      ctx.push({
        kind: "error",
        text: `no Instamart product found for ${productId}`,
      });
      return;
    }
    const variant = hit.variants.find((v) => v.available) ?? hit.variants[0];
    if (!variant) {
      ctx.push({ kind: "error", text: `${hit.name} has no variants` });
      return;
    }
    spinId = variant.spinId;
  }

  // Fetch the current cart so update_cart can preserve existing items
  // (update_cart REPLACES the cart per spec).
  let cartRaw: unknown;
  try {
    cartRaw = await ctx.mcp.call("im", "get_cart", {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `get_cart failed: ${msg}` });
    return;
  }
  const cartEnv = asEnvelope(cartRaw);
  const existing =
    (cartEnv?.data as { cart?: CartView } | undefined)?.cart?.items ?? [];

  // Merge: bump quantity if same spinId, else append.
  const merged: Array<{ spinId: string; quantity: number }> = [];
  let bumped = false;
  for (const it of existing) {
    if (it.spinId === spinId) {
      merged.push({ spinId: it.spinId, quantity: it.quantity + quantity });
      bumped = true;
    } else {
      merged.push({ spinId: it.spinId, quantity: it.quantity });
    }
  }
  if (!bumped) merged.push({ spinId, quantity });

  let updRaw: unknown;
  try {
    updRaw = await ctx.mcp.call("im", "update_cart", {
      selectedAddressId: addressId,
      items: merged,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `update_cart failed: ${msg}` });
    return;
  }
  const updEnv = asEnvelope(updRaw);
  if (!updEnv || updEnv.success !== true) {
    const msg = updEnv?.error?.message ?? "update_cart failed";
    if (updEnv?.error?.code === "ITEM_UNAVAILABLE") {
      ctx.push({ kind: "error", text: msg });
    } else {
      ctx.push({ kind: "error", text: msg });
    }
    return;
  }
  ctx.push({
    kind: "info",
    text: updEnv.message ?? `Added ${quantity} × ${spinId} to Instamart cart.`,
  });
}

/* ------------------------------- /cart -------------------------------- */

function renderCart(cart: CartView, bill: BillView): React.ReactNode {
  const lines: React.ReactNode[] = [];
  cart.items.forEach((it, idx) => {
    lines.push(
      createElement(
        Text,
        { key: `it-${idx}` },
        `  ${it.quantity} × ${it.name} (${it.variantLabel})  ₹${it.price * it.quantity}`,
      ),
    );
  });
  lines.push(createElement(Text, { key: "sep" }, "  ----"));
  lines.push(createElement(Text, { key: "sub" }, `  Subtotal:    ₹${bill.subtotal}`));
  lines.push(
    createElement(Text, { key: "del" }, `  Delivery:    ₹${bill.deliveryFee}`),
  );
  lines.push(
    createElement(Text, { key: "han" }, `  Handling:    ₹${bill.handlingFee}`),
  );
  if (bill.discount > 0) {
    lines.push(
      createElement(
        Text,
        { key: "dis" },
        `  Discount:   −₹${bill.discount}${bill.appliedCoupon ? ` (${bill.appliedCoupon})` : ""}`,
      ),
    );
  }
  lines.push(createElement(Text, { key: "tot" }, `  Total:       ₹${bill.total}`));
  return createElement(Fragment, null, ...lines);
}

async function cartHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "get_cart", {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `get_cart failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "get_cart failed" });
    return;
  }
  const data = env.data as
    | { cart?: CartView; bill?: BillView }
    | undefined;
  const cart = data?.cart;
  const bill = data?.bill;
  if (!cart || !bill) {
    ctx.push({ kind: "info", text: "Instamart cart is empty." });
    return;
  }
  if (cart.items.length === 0) {
    ctx.push({ kind: "info", text: "Instamart cart is empty." });
    return;
  }
  ctx.push({
    kind: "tool-response",
    tool: "get_cart",
    durationMs: 0,
    ok: true,
    preview: `Instamart cart — ${cart.items.length} item(s), total ₹${bill.total}`,
    render: renderCart(cart, bill),
  });
}

/* ------------------------------- /order ------------------------------- */

async function orderHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  const addressId = requireActiveAddress(ctx);
  if (!addressId) return;
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "checkout", { addressId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `checkout failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "checkout failed" });
    return;
  }
  const order = (env.data as { order?: OrderView } | undefined)?.order;
  if (!order) {
    ctx.push({ kind: "error", text: "checkout returned no order" });
    return;
  }
  ctx.state.lastOrderId = order.id;
  ctx.push({
    kind: "info",
    text: env.message ?? `Order ${order.id} placed.`,
  });
  ctx.push({
    kind: "info",
    text: `  ${order.id} — ETA ${order.etaMinutes} min — total ₹${order.bill.total}`,
  });
}

/* ------------------------------- /track ------------------------------- */

async function pollOnce(
  ctx: SlashContext,
  orderId: string,
): Promise<TrackingView | null> {
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "track_order", {
      orderId,
      lat: 12.9716,
      lng: 77.5946,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `track_order failed: ${msg}` });
    return null;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "track_order failed" });
    return null;
  }
  return env.data as TrackingView;
}

function renderTracking(t: TrackingView): React.ReactNode {
  return createElement(
    Fragment,
    null,
    createElement(Text, { key: "id" }, `Order ${t.orderId}`),
    createElement(Text, { key: "st" }, `  Status: ${t.state}`),
    createElement(Text, { key: "et" }, `  ETA:    ${t.etaMinutes} min`),
    createElement(
      Text,
      { key: "dr" },
      `  Rider:  ${t.driver.name} (${t.driver.distanceKm.toFixed(2)} km away)`,
    ),
  );
}

async function trackHandler(
  ctx: SlashContext,
  argv: string[],
): Promise<void> {
  if (argv[0] === "off") {
    ctx.setTracker(null);
    ctx.push({ kind: "info", text: "Tracking stopped." });
    return;
  }
  const orderId = argv[0] ?? ctx.state.lastOrderId;
  if (!orderId) {
    ctx.push({
      kind: "error",
      text: "no order id — pass /track <orderId> or place an order first",
    });
    return;
  }

  const first = await pollOnce(ctx, orderId);
  if (!first) return;
  ctx.setTracker(renderTracking(first));
  if (first.state === "DELIVERED" || first.state === "CANCELLED") {
    return;
  }

  const handle = setInterval(async () => {
    const t = await pollOnce(ctx, orderId);
    if (!t) {
      clearInterval(handle);
      ctx.setTracker(null);
      return;
    }
    ctx.setTracker(renderTracking(t));
    if (t.state === "DELIVERED" || t.state === "CANCELLED") {
      clearInterval(handle);
    }
  }, 5000);
  if (typeof handle.unref === "function") handle.unref();
}

/* ------------------------------ /orders ------------------------------- */

async function ordersHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "get_orders", {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `get_orders failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "get_orders failed" });
    return;
  }
  const orders =
    (env.data as { orders?: OrderView[] } | undefined)?.orders ?? [];
  if (orders.length === 0) {
    ctx.push({ kind: "info", text: "No Instamart orders yet." });
    return;
  }
  ctx.push({ kind: "info", text: `Instamart orders (${orders.length}):` });
  for (const o of orders) {
    ctx.push({
      kind: "info",
      text: `  ${o.id}  ${o.state}  ETA ${o.etaMinutes}m  total ₹${o.bill?.total ?? 0}`,
    });
  }
}

/* ------------------------------- /clear ------------------------------- */

async function clearHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("im", "clear_cart", {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `clear_cart failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    ctx.push({ kind: "error", text: env?.error?.message ?? "clear_cart failed" });
    return;
  }
  ctx.push({ kind: "info", text: env.message ?? "Instamart cart cleared." });
}

export const instamartHandlers: Record<string, SlashHandler> = {
  products: productsHandler,
  add: addHandler,
  cart: cartHandler,
  order: orderHandler,
  track: trackHandler,
  orders: ordersHandler,
  clear: clearHandler,
};
