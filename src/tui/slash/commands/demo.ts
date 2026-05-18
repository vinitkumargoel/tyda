import type { SlashContext } from "../types.js";
import type { SlashHandler } from "./food.js";

/**
 * Scripted recipes from spec/recipe-*.md. Each demo runs the canonical
 * tool sequence for one of the three Swiggy MCP servers so users can see
 * the full happy-path unfold without composing slash commands themselves.
 *
 * The biryani and groceries demos are programmatic (they capture IDs from
 * MCP responses) rather than static so they work with any fixture data.
 */

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function announce(ctx: SlashContext, line: string): Promise<void> {
  ctx.push({ kind: "info", text: line });
  await sleep(100);
}

/* ------------------------------------------------------------------ */
/* Generic MCP helper (mirrors food.ts but inlined so demo is self-    */
/* contained and works across all three servers)                       */
/* ------------------------------------------------------------------ */

interface OkEnv<T> { success: true; data: T; message?: string }
interface ErrEnv { success: false; error: { code?: string; message: string } }
type Env<T> = OkEnv<T> | ErrEnv;

interface RawResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

function unwrap<T>(raw: unknown): Env<T> {
  const r = raw as RawResult;
  if (r?.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent as Env<T>;
  }
  const text = r?.content?.find((c) => c.type === "text")?.text;
  if (typeof text === "string") return JSON.parse(text) as Env<T>;
  throw new Error("Empty tool response");
}

type Server = "food" | "im" | "dineout";

async function call<T>(
  ctx: SlashContext,
  server: Server,
  tool: string,
  args: Record<string, unknown>,
): Promise<Env<T>> {
  ctx.push({ kind: "tool-call", tool, argsPreview: JSON.stringify(args) });
  const t0 = Date.now();
  try {
    const raw = await ctx.mcp.call(server, tool, args);
    const env = unwrap<T>(raw);
    ctx.push({
      kind: "tool-response",
      tool,
      durationMs: Date.now() - t0,
      ok: env.success,
      preview: env.success ? (env.message ?? "ok") : `error: ${env.error.message}`,
    });
    return env;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({
      kind: "tool-response",
      tool,
      durationMs: Date.now() - t0,
      ok: false,
      preview: `error: ${msg}`,
    });
    return { success: false, error: { message: msg } };
  }
}

function fail(ctx: SlashContext, step: string, msg: string): void {
  ctx.push({ kind: "error", text: `demo step failed: ${step} — ${msg}` });
}

/* ------------------------------------------------------------------ */
/* Biryani recipe                                                      */
/* ------------------------------------------------------------------ */

interface Restaurant { id: string; name: string; area: string; cuisines: string[]; rating: number; etaMinutes: number }
interface MenuItem { id: string; name: string; price: number; veg: boolean }
interface MenuCategory { category: string; items: MenuItem[] }

async function demoBiryani(ctx: SlashContext): Promise<void> {
  // Step 1: pick address
  await announce(ctx, "Picking Koramangala 4th Block as the delivery address.");
  ctx.push({ kind: "user", line: "/address pick 1" });
  const { REGISTRY } = await import("../registry.js");
  const addrCmd = REGISTRY.get("address");
  if (addrCmd) {
    try { await addrCmd.handler(ctx, ["pick", "1"]); } catch { /* best-effort */ }
  }
  const addressId = ctx.state.activeAddressId;
  await sleep(220);

  // Step 2: search restaurants
  await announce(ctx, "Searching restaurants for biryani.");
  ctx.push({ kind: "user", line: "/search biryani" });
  const searchArgs: Record<string, unknown> = { query: "biryani" };
  if (addressId) searchArgs.addressId = addressId;
  const searchEnv = await call<{ restaurants: Restaurant[] }>(ctx, "food", "search_restaurants", searchArgs);
  if (!searchEnv.success) { fail(ctx, "/search", searchEnv.error.message); return; }
  const restaurants = searchEnv.data.restaurants;
  for (const r of restaurants) {
    ctx.push({ kind: "info", text: `  ${r.id}  ${r.name} (${r.area}) — ${r.cuisines.join(", ")} — ${r.rating}★ — ${r.etaMinutes} min` });
  }
  const topId = restaurants[0]?.id;
  if (!topId) { fail(ctx, "/search", "no restaurants returned"); return; }
  await sleep(220);

  // Step 3: open menu
  await announce(ctx, `Opening ${restaurants[0]?.name ?? topId}'s menu.`);
  ctx.push({ kind: "user", line: `/menu ${topId}` });
  const menuArgs: Record<string, unknown> = { restaurantId: topId };
  if (addressId) menuArgs.addressId = addressId;
  const menuEnv = await call<{ restaurantId: string; restaurantName: string; categories: MenuCategory[] }>(ctx, "food", "get_restaurant_menu", menuArgs);
  if (!menuEnv.success) { fail(ctx, "/menu", menuEnv.error.message); return; }
  ctx.state.activeRestaurantId = menuEnv.data.restaurantId;
  ctx.push({ kind: "info", text: `  ${menuEnv.data.restaurantName}` });
  for (const cat of menuEnv.data.categories) {
    ctx.push({ kind: "info", text: `  -- ${cat.category} --` });
    for (const it of cat.items) {
      ctx.push({ kind: "info", text: `  ${it.id}  ${it.veg ? "[v]" : "[nv]"} ${it.name} — ₹${it.price}` });
    }
  }
  const firstItem = menuEnv.data.categories[0]?.items[0];
  if (!firstItem) { fail(ctx, "/menu", "menu has no items"); return; }
  await sleep(220);

  // Step 4: add to cart
  await announce(ctx, `Adding ${firstItem.name} to the cart.`);
  ctx.push({ kind: "user", line: `/add ${firstItem.id} 1` });
  const addEnv = await call(ctx, "food", "update_food_cart", {
    restaurantId: topId,
    cartItems: [{ menuItemId: firstItem.id, quantity: 1 }],
  });
  if (!addEnv.success) { fail(ctx, "/add", (addEnv as ErrEnv).error.message); return; }
  await sleep(220);

  // Step 5: show cart
  await announce(ctx, "Reviewing the cart.");
  ctx.push({ kind: "user", line: "/cart" });
  const cartCmd = REGISTRY.get("cart");
  if (cartCmd) {
    try { await cartCmd.handler(ctx, []); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Step 6: coupon — BIRYANI20 applies to any cart with biryani items, no minimum
  await announce(ctx, "Applying coupon BIRYANI20 (20% off biryani, max ₹150).");
  ctx.push({ kind: "user", line: "/coupon BIRYANI20" });
  const couponCmd = REGISTRY.get("coupon");
  if (couponCmd) {
    try { await couponCmd.handler(ctx, ["BIRYANI20"]); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Step 7: place order
  await announce(ctx, "Placing the order.");
  ctx.push({ kind: "user", line: "/order" });
  const orderCmd = REGISTRY.get("order");
  if (orderCmd) {
    try {
      await orderCmd.handler(ctx, []);
    } catch (err) {
      fail(ctx, "/order", err instanceof Error ? err.message : String(err));
      return;
    }
  }
  await sleep(220);

  // Step 8: track
  await announce(ctx, "Tracking the order — the pinned tracker keeps you posted.");
  ctx.push({ kind: "user", line: "/track" });
  const trackCmd = REGISTRY.get("track");
  if (trackCmd) {
    try { await trackCmd.handler(ctx, []); } catch { /* tracker is optional */ }
  }
}

/* ------------------------------------------------------------------ */
/* Groceries recipe                                                    */
/* ------------------------------------------------------------------ */

interface Product { id: string; name: string; price: number; available: boolean; unit?: string }

async function demoGroceries(ctx: SlashContext): Promise<void> {
  const { REGISTRY } = await import("../registry.js");

  await announce(ctx, "Picking Koramangala 4th Block as the delivery address.");
  ctx.push({ kind: "user", line: "/address pick 1" });
  const addrCmd = REGISTRY.get("address");
  if (addrCmd) {
    try { await addrCmd.handler(ctx, ["pick", "1"]); } catch { /* best-effort */ }
  }
  const addressId = ctx.state.activeAddressId;
  await sleep(220);

  // Search for onions
  await announce(ctx, "Searching Instamart for onions.");
  ctx.push({ kind: "user", line: "/products onion" });
  const onionArgs: Record<string, unknown> = { query: "onion" };
  if (addressId) onionArgs.addressId = addressId;
  const onionEnv = await call<{ products: Product[] }>(ctx, "im", "search_products", onionArgs);
  if (!onionEnv.success) { fail(ctx, "/products", onionEnv.error.message); return; }
  const onionProducts = onionEnv.data.products.filter((p) => p.available);
  for (const p of onionEnv.data.products) {
    ctx.push({ kind: "info", text: `  ${p.id}  ${p.name}${p.unit ? ` — ${p.unit}` : ""} — ₹${p.price}${p.available ? "" : "  ⚠ out of stock"}` });
  }
  const onionId = onionProducts[0]?.id;
  if (!onionId) { fail(ctx, "/products", "no onion products available"); return; }
  await sleep(220);

  // Add onion
  await announce(ctx, `Adding ${onionProducts[0]?.name ?? onionId}.`);
  const addOnion = REGISTRY.get("add");
  if (addOnion) {
    ctx.push({ kind: "user", line: `/add ${onionId}` });
    try { await addOnion.handler(ctx, [onionId]); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Search for milk
  await announce(ctx, "Searching for milk.");
  ctx.push({ kind: "user", line: "/products milk" });
  const milkArgs: Record<string, unknown> = { query: "milk" };
  if (addressId) milkArgs.addressId = addressId;
  const milkEnv = await call<{ products: Product[] }>(ctx, "im", "search_products", milkArgs);
  if (!milkEnv.success) { fail(ctx, "/products", milkEnv.error.message); return; }
  const milkProducts = milkEnv.data.products.filter((p) => p.available);
  for (const p of milkEnv.data.products) {
    ctx.push({ kind: "info", text: `  ${p.id}  ${p.name}${p.unit ? ` — ${p.unit}` : ""} — ₹${p.price}${p.available ? "" : "  ⚠ out of stock"}` });
  }
  const milkId = milkProducts[0]?.id;
  if (milkId) {
    await announce(ctx, `Adding ${milkProducts[0]?.name ?? milkId}.`);
    const addMilk = REGISTRY.get("add");
    if (addMilk) {
      ctx.push({ kind: "user", line: `/add ${milkId}` });
      try { await addMilk.handler(ctx, [milkId]); } catch { /* best-effort */ }
    }
    await sleep(220);
  }

  // Cart
  await announce(ctx, "Reviewing the grocery cart.");
  const cartCmd = REGISTRY.get("cart");
  if (cartCmd) {
    ctx.push({ kind: "user", line: "/cart" });
    try { await cartCmd.handler(ctx, []); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Order
  await announce(ctx, "Placing the Instamart order.");
  const orderCmd = REGISTRY.get("order");
  if (orderCmd) {
    ctx.push({ kind: "user", line: "/order" });
    try { await orderCmd.handler(ctx, []); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Track
  await announce(ctx, "Tracking the grocery delivery.");
  const trackCmd = REGISTRY.get("track");
  if (trackCmd) {
    ctx.push({ kind: "user", line: "/track" });
    try { await trackCmd.handler(ctx, []); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ */
/* Tables recipe                                                       */
/* ------------------------------------------------------------------ */

interface DineoutVenue { id: string; name: string; area: string; rating: number; avgCostForTwo: number }
interface DineoutSlot { slotId: string; venueId: string; venueName?: string; date: string; time: string; availableSeats: number }

async function demoTables(ctx: SlashContext): Promise<void> {
  const { REGISTRY } = await import("../registry.js");

  // Find tables
  await announce(ctx, "Finding dineout tables in Indiranagar.");
  ctx.push({ kind: "user", line: "/tables indiranagar" });
  const tablesEnv = await call<{ venues?: DineoutVenue[]; slots?: DineoutSlot[] }>(ctx, "dineout", "search_restaurants_dineout", { area: "indiranagar" });
  if (!tablesEnv.success) { fail(ctx, "/tables", (tablesEnv as ErrEnv).error.message); return; }

  // Show venues and find a slot
  const venues = tablesEnv.data.venues ?? [];
  const slots = tablesEnv.data.slots ?? [];
  for (const v of venues) {
    ctx.push({ kind: "info", text: `  ${v.id}  ${v.name} (${v.area}) — ★${v.rating} — ₹${v.avgCostForTwo}/2` });
  }
  for (const s of slots) {
    ctx.push({ kind: "info", text: `  ${s.slotId}  ${s.venueName ?? s.venueId}  ${s.date} ${s.time} — ${s.availableSeats} seats` });
  }

  const firstSlot = slots[0];
  if (!firstSlot) { fail(ctx, "/tables", "no slots found"); return; }
  await sleep(220);

  // Book
  await announce(ctx, `Booking slot ${firstSlot.slotId}.`);
  ctx.push({ kind: "user", line: `/book ${firstSlot.slotId}` });
  const bookCmd = REGISTRY.get("book");
  if (bookCmd) {
    try { await bookCmd.handler(ctx, [firstSlot.slotId]); } catch { /* best-effort */ }
  }
  await sleep(220);

  // Show booking
  await announce(ctx, "Confirming the booking details.");
  const bookingCmd = REGISTRY.get("booking");
  if (bookingCmd) {
    ctx.push({ kind: "user", line: "/booking" });
    try { await bookingCmd.handler(ctx, []); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const RECIPES: Record<string, (ctx: SlashContext) => Promise<void>> = {
  biryani: demoBiryani,
  groceries: demoGroceries,
  tables: demoTables,
};

export const demoHandlers: Record<string, SlashHandler> = {
  demo: async (ctx, argv) => {
    const name = (argv[0] ?? "").toLowerCase();
    if (!name) {
      ctx.push({ kind: "info", text: "usage: /demo <biryani|groceries|tables>" });
      ctx.push({ kind: "info", text: "available recipes: " + Object.keys(RECIPES).join(", ") });
      return;
    }
    const recipe = RECIPES[name];
    if (!recipe) {
      ctx.push({ kind: "error", text: `unknown recipe "${name}" — try: ${Object.keys(RECIPES).join(", ")}` });
      return;
    }
    ctx.push({ kind: "info", text: `▶ running /demo ${name}` });
    try {
      await recipe(ctx);
      ctx.push({ kind: "info", text: `✔ /demo ${name} complete` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.push({ kind: "error", text: `demo aborted: ${msg}` });
    }
  },
};
