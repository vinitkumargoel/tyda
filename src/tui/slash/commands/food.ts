/**
 * Food-side slash command handlers.
 *
 * These are thin glue between the TUI and the Food MCP server: each one
 * formats the user's argv into a tool call, dispatches via `ctx.mcp.call`,
 * pushes a `tool-call` + `tool-response` pair to the transcript, and updates
 * the session state (active restaurant / last order id) where appropriate.
 *
 * `/track [orderId]` additionally installs a 5s poller through
 * `ctx.setTracker(...)`. `/track off` clears the tracker.
 */
import React from "react";
import { Box, Text } from "ink";
import type { SlashContext } from "../types.js";

/** Local alias for a slash handler (the same shape used by SlashCommand.handler). */
export type SlashHandler = (ctx: SlashContext, argv: string[]) => Promise<void>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface OkEnvelope<T = unknown> {
  success: true;
  data: T;
  message?: string;
}
interface ErrEnvelope {
  success: false;
  error: { code?: string; message: string };
}
type Envelope<T = unknown> = OkEnvelope<T> | ErrEnvelope;

interface CallToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Unwrap an MCP `callTool` response into our universal envelope.
 *
 * Prefers `structuredContent`; falls back to JSON-decoding the first text
 * content block. Throws if neither is present.
 */
function unwrap<T>(raw: unknown): Envelope<T> {
  const r = raw as CallToolResult;
  if (r?.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent as Envelope<T>;
  }
  const text = r?.content?.find((c) => c.type === "text")?.text;
  if (typeof text === "string") {
    return JSON.parse(text) as Envelope<T>;
  }
  throw new Error("Empty tool response");
}

function previewOf(env: Envelope): string {
  if (env.success) return env.message ?? "ok";
  return `error: ${env.error.message}`;
}

async function callTool<T>(
  ctx: SlashContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<Envelope<T>> {
  ctx.push({ kind: "tool-call", tool, argsPreview: JSON.stringify(args) });
  const started = Date.now();
  try {
    const raw = await ctx.mcp.call("food", tool, args);
    const env = unwrap<T>(raw);
    ctx.push({
      kind: "tool-response",
      tool,
      durationMs: Date.now() - started,
      ok: env.success,
      preview: previewOf(env),
    });
    return env;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({
      kind: "tool-response",
      tool,
      durationMs: Date.now() - started,
      ok: false,
      preview: `error: ${msg}`,
    });
    throw err;
  }
}

function requireAddress(ctx: SlashContext): string {
  const id = ctx.state.activeAddressId;
  if (!id) {
    throw new Error("No active address. Run /address use <n> first.");
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Domain types (lightweight; only the fields we read here)            */
/* ------------------------------------------------------------------ */

interface SearchRestaurantsResult {
  restaurants: Array<{
    id: string;
    name: string;
    area: string;
    cuisines: string[];
    rating: number;
    etaMinutes: number;
  }>;
  total: number;
}

interface MenuResult {
  restaurantId: string;
  restaurantName: string;
  categories: Array<{
    category: string;
    items: Array<{ id: string; name: string; price: number; veg: boolean }>;
  }>;
}

interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  lineTotal: number;
}
interface CartLike {
  restaurantId: string;
  restaurantName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  discount: number;
  total: number;
}

interface OrderRef {
  id: string;
  restaurantName: string;
  state: string;
  total: number;
  placedAt: string;
  etaMinutes: number;
}

interface TrackResult {
  orders: Array<{
    orderId: string;
    state: string;
    etaMinutes: number;
    restaurantName: string;
    rider?: { name: string; distanceKm: number; etaMinutes: number };
  }>;
}

/* ------------------------------------------------------------------ */
/* /search                                                             */
/* ------------------------------------------------------------------ */

const searchHandler: SlashHandler = async (ctx, argv) => {
  const query = argv.join(" ").trim();
  if (!query) {
    ctx.push({ kind: "error", text: "/search needs a query." });
    return;
  }
  const args: Record<string, unknown> = { query };
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  const env = await callTool<SearchRestaurantsResult>(ctx, "search_restaurants", args);
  if (!env.success) return;
  for (const r of env.data.restaurants) {
    ctx.push({
      kind: "info",
      text: `  ${r.id}  ${r.name} (${r.area}) — ${r.cuisines.join(", ")} — ${r.rating}★ — ${r.etaMinutes} min`,
    });
  }
  if (env.data.restaurants.length === 0) {
    ctx.push({ kind: "info", text: "  (no matches)" });
  }
};

/* ------------------------------------------------------------------ */
/* /menu                                                               */
/* ------------------------------------------------------------------ */

const menuHandler: SlashHandler = async (ctx, argv) => {
  const restaurantId = argv[0];
  if (!restaurantId) {
    ctx.push({ kind: "error", text: "/menu needs a restaurant id." });
    return;
  }
  const args: Record<string, unknown> = { restaurantId };
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  const env = await callTool<MenuResult>(ctx, "get_restaurant_menu", args);
  if (!env.success) return;
  ctx.state.activeRestaurantId = env.data.restaurantId;
  ctx.push({ kind: "info", text: `  ${env.data.restaurantName}` });
  for (const cat of env.data.categories) {
    ctx.push({ kind: "info", text: `  -- ${cat.category} --` });
    for (const it of cat.items) {
      const veg = it.veg ? "[v]" : "[nv]";
      ctx.push({ kind: "info", text: `  ${it.id}  ${veg} ${it.name} — ₹${it.price}` });
    }
  }
};

/* ------------------------------------------------------------------ */
/* /add (food side)                                                    */
/* ------------------------------------------------------------------ */

/**
 * `/add <id> [qty]` — id must start with `M` for food. If it starts with
 * `IP`, hand off to a clearer error so users know to switch carts.
 */
const addHandler: SlashHandler = async (ctx, argv) => {
  const id = argv[0];
  const qty = argv[1] ? Number(argv[1]) : 1;
  if (!id) {
    ctx.push({ kind: "error", text: "/add needs an id." });
    return;
  }
  if (/^IP/i.test(id)) {
    ctx.push({
      kind: "error",
      text: "use IP-prefix IDs for groceries (try the Instamart /add path)",
    });
    return;
  }
  if (!/^M\d+/i.test(id)) {
    ctx.push({
      kind: "error",
      text: `unknown id format: ${id} — expected M-prefix for food`,
    });
    return;
  }
  const restaurantId = ctx.state.activeRestaurantId;
  if (!restaurantId) {
    ctx.push({
      kind: "error",
      text: "no active restaurant — run /menu <restaurant-id> first",
    });
    return;
  }
  const args: Record<string, unknown> = {
    restaurantId,
    cartItems: [{ menuItemId: id.toUpperCase(), quantity: qty }],
  };
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  const env = await callTool<{ cart: CartLike | null }>(ctx, "update_food_cart", args);
  if (!env.success) return;
  const c = env.data.cart;
  if (c) {
    ctx.push({
      kind: "info",
      text: `  cart: ${c.items.length} items, total ₹${c.total}`,
    });
  }
};

/* ------------------------------------------------------------------ */
/* /cart, /clear                                                       */
/* ------------------------------------------------------------------ */

const cartHandler: SlashHandler = async (ctx) => {
  const args: Record<string, unknown> = {};
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  const env = await callTool<{ cart: CartLike | null; availablePaymentMethods: string[] }>(
    ctx,
    "get_food_cart",
    args,
  );
  if (!env.success) return;
  const c = env.data.cart;
  if (!c) {
    ctx.push({ kind: "info", text: "  cart is empty" });
    return;
  }
  ctx.push({ kind: "info", text: `  ${c.restaurantName}` });
  for (const it of c.items) {
    ctx.push({
      kind: "info",
      text: `    ${it.quantity}× ${it.name} — ₹${it.lineTotal}`,
    });
  }
  ctx.push({
    kind: "info",
    text: `  subtotal ₹${c.subtotal}  delivery ₹${c.deliveryFee}  fee ₹${c.platformFee}  discount ₹${c.discount}  total ₹${c.total}`,
  });
};

const clearHandler: SlashHandler = async (ctx) => {
  await callTool(ctx, "flush_food_cart", {});
};

/* ------------------------------------------------------------------ */
/* /coupon                                                             */
/* ------------------------------------------------------------------ */

const couponHandler: SlashHandler = async (ctx, argv) => {
  const code = argv[0];
  if (!code) {
    ctx.push({ kind: "error", text: "/coupon needs a code." });
    return;
  }
  const args: Record<string, unknown> = { couponCode: code };
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  await callTool(ctx, "apply_food_coupon", args);
};

/* ------------------------------------------------------------------ */
/* /order                                                              */
/* ------------------------------------------------------------------ */

const orderHandler: SlashHandler = async (ctx) => {
  const addressId = requireAddress(ctx);
  const env = await callTool<{ order: { id: string } }>(ctx, "place_food_order", {
    addressId,
  });
  if (!env.success) {
    if (env.error.code === "CART_LIMIT_EXCEEDED") {
      ctx.push({ kind: "error", text: env.error.message });
    }
    return;
  }
  ctx.state.lastOrderId = env.data.order.id;
  ctx.state.activeRestaurantId = null;
  ctx.push({ kind: "info", text: env.message ?? `order ${env.data.order.id} placed` });
};

/* ------------------------------------------------------------------ */
/* /track                                                              */
/* ------------------------------------------------------------------ */

function TrackerView({ tracked }: { tracked: TrackResult["orders"][number] }): React.ReactElement {
  const states = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
  const idx = Math.max(0, states.indexOf(tracked.state));
  const bar = states.map((s, i) => (i <= idx ? "█" : "░")).join("");
  return React.createElement(
    Box,
    { flexDirection: "column", borderStyle: "round", paddingX: 1 },
    React.createElement(
      Text,
      null,
      `Tracking ${tracked.orderId} — ${tracked.restaurantName}`,
    ),
    React.createElement(Text, null, `${bar}  ${tracked.state}`),
    React.createElement(
      Text,
      null,
      tracked.rider
        ? `Rider ${tracked.rider.name} — ${tracked.rider.distanceKm} km, ~${tracked.rider.etaMinutes} min`
        : `ETA ~${tracked.etaMinutes} min`,
    ),
  );
}

const trackHandler: SlashHandler = async (ctx, argv) => {
  if (argv[0] === "off") {
    ctx.setTracker(null);
    ctx.push({ kind: "info", text: "tracker detached" });
    return;
  }
  const orderId = argv[0] ?? ctx.state.lastOrderId;
  if (!orderId) {
    ctx.push({ kind: "error", text: "no order id and no recent order to track" });
    return;
  }
  const env = await callTool<TrackResult>(ctx, "track_food_order", { orderId });
  if (!env.success || env.data.orders.length === 0) return;
  const first = env.data.orders[0]!;
  ctx.setTracker(React.createElement(TrackerView, { tracked: first }));
  // Naive 5s poll — the dispatcher returns a fresh snapshot each tick.
  // The handler doesn't keep the timer alive itself; the App owns lifecycle.
  const handle: ReturnType<typeof setInterval> = setInterval(() => {
    void (async () => {
      try {
        const next = await ctx.mcp.call("food", "track_food_order", { orderId });
        const nextEnv = unwrap<TrackResult>(next);
        if (!nextEnv.success) return;
        const order = nextEnv.data.orders[0];
        if (!order) return;
        ctx.setTracker(React.createElement(TrackerView, { tracked: order }));
        if (order.state === "DELIVERED" || order.state === "CANCELLED") {
          clearInterval(handle);
        }
      } catch {
        clearInterval(handle);
      }
    })();
  }, 5000);
  if (typeof handle.unref === "function") handle.unref();
};

/* ------------------------------------------------------------------ */
/* /orders                                                             */
/* ------------------------------------------------------------------ */

const ordersHandler: SlashHandler = async (ctx) => {
  const args: Record<string, unknown> = {};
  const addr = ctx.state.activeAddressId;
  if (addr) args.addressId = addr;
  const env = await callTool<{ orders: OrderRef[] }>(ctx, "get_food_orders", args);
  if (!env.success) return;
  if (env.data.orders.length === 0) {
    ctx.push({ kind: "info", text: "  (no recent orders)" });
    return;
  }
  for (const o of env.data.orders) {
    ctx.push({
      kind: "info",
      text: `  ${o.id}  ${o.restaurantName} — ${o.state} — ₹${o.total}`,
    });
  }
};

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const foodHandlers: Record<string, SlashHandler> = {
  search: searchHandler,
  menu: menuHandler,
  add: addHandler,
  cart: cartHandler,
  clear: clearHandler,
  coupon: couponHandler,
  order: orderHandler,
  track: trackHandler,
  orders: ordersHandler,
};
