/**
 * Wave 2 / Track H — Dineout slash commands.
 *
 *  - /tables <area> [date]   — search restaurants near an area and surface
 *                              their free-slot count for `date` (default
 *                              tomorrow).
 *  - /book <slotId>          — create a free cart and book a table, default
 *                              2 guests.
 *  - /booking [orderId]      — look up a booking; falls back to the most
 *                              recent dineout booking when orderId is
 *                              omitted.
 */

import type { SlashContext } from "../types.js";
import type { SlashHandler } from "./misc.js";

interface VenueRow {
  restaurantId: string;
  name: string;
  area: string;
  rating: number;
}

interface SlotRow {
  slotId: string;
  displayTime: string;
  capacity: number;
}

interface DayRow {
  dateStr: string;
  slots: SlotRow[];
}

interface BookingRecord {
  orderId: string;
  restaurantName: string;
  date: string;
  time: string;
  guestCount: number;
  dealTitle: string;
  status: string;
}

/** Lift the actual payload out of an MCP CallToolResult. */
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

interface ToolEnvelope {
  success: boolean;
  data?: unknown;
  error?: { code?: string; message: string };
  message?: string;
}

function asEnvelope(raw: unknown): ToolEnvelope | null {
  const p = extractToolPayload(raw);
  if (!p || typeof p !== "object") return null;
  return p as ToolEnvelope;
}

function tomorrowIso(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Last booking id seen, scoped per SlashContext.state. */
const lastBookingByState = new WeakMap<SlashContext["state"], string>();

/** /tables <area> [date] */
async function tablesHandler(
  ctx: SlashContext,
  argv: string[],
): Promise<void> {
  const area = argv[0];
  if (!area) {
    ctx.push({ kind: "error", text: "usage: /tables <area> [date]" });
    return;
  }
  const date = argv[1] ?? tomorrowIso();

  let searchRaw: unknown;
  try {
    searchRaw = await ctx.mcp.call("dineout", "search_restaurants_dineout", {
      query: area,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `search failed: ${msg}` });
    return;
  }

  const env = asEnvelope(searchRaw);
  if (!env || env.success !== true) {
    const msg = env?.error?.message ?? "search failed";
    ctx.push({ kind: "error", text: msg });
    return;
  }
  const data = env.data as { results?: VenueRow[] } | undefined;
  const results = data?.results ?? [];
  if (results.length === 0) {
    ctx.push({ kind: "info", text: `No venues for "${area}".` });
    return;
  }

  const top = results[0]!;
  let slotsRaw: unknown;
  try {
    slotsRaw = await ctx.mcp.call("dineout", "get_available_slots", {
      restaurantId: top.restaurantId,
      date,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `slot lookup failed: ${msg}` });
    return;
  }
  const slotsEnv = asEnvelope(slotsRaw);
  let freeCount = 0;
  let dayLabel = date;
  if (slotsEnv?.success) {
    const days = (slotsEnv.data as { days?: DayRow[] } | undefined)?.days ?? [];
    const day = days[0];
    if (day) {
      dayLabel = day.dateStr;
      freeCount = day.slots.filter((s) => s.capacity > 0).length;
    }
  }

  ctx.push({ kind: "info", text: `Top match: ${top.name} (${top.area})` });
  ctx.push({
    kind: "info",
    text: `  ${dayLabel} — ${freeCount} free slot(s) available`,
  });
  if (results.length > 1) {
    ctx.push({ kind: "info", text: "Other venues:" });
    for (const r of results.slice(1)) {
      ctx.push({
        kind: "info",
        text: `  - ${r.name} (${r.area}, ${r.rating})`,
      });
    }
  }
  ctx.state.activeRestaurantId = top.restaurantId;
}

/** /book <slotId> [guests] */
async function bookHandler(ctx: SlashContext, argv: string[]): Promise<void> {
  const slotId = argv[0];
  if (!slotId) {
    ctx.push({ kind: "error", text: "usage: /book <slotId> [guests]" });
    return;
  }
  const guests = Number.parseInt(argv[1] ?? "2", 10);
  const guestCount = Number.isFinite(guests) && guests > 0 ? guests : 2;
  const restaurantId =
    ctx.state.activeRestaurantId ?? slotId.split("-").slice(0, 1).join("-");

  let cartRaw: unknown;
  try {
    cartRaw = await ctx.mcp.call("dineout", "create_cart", {
      restaurantId,
      slotId,
      guestCount,
      cartType: "DEAL_TICKET_PURCHASE",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `create_cart failed: ${msg}` });
    return;
  }
  const cartEnv = asEnvelope(cartRaw);
  if (!cartEnv || cartEnv.success !== true) {
    const msg = cartEnv?.error?.message ?? "create_cart failed";
    ctx.push({ kind: "error", text: msg });
    return;
  }
  const cartData = cartEnv.data as { cartId?: string } | undefined;
  const cartId = cartData?.cartId;
  if (!cartId) {
    ctx.push({ kind: "error", text: "create_cart returned no cartId" });
    return;
  }

  let bookRaw: unknown;
  try {
    bookRaw = await ctx.mcp.call("dineout", "book_table", { cartId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `book_table failed: ${msg}` });
    return;
  }
  const bookEnv = asEnvelope(bookRaw);
  if (!bookEnv || bookEnv.success !== true) {
    const msg = bookEnv?.error?.message ?? "book_table failed";
    ctx.push({ kind: "error", text: msg });
    return;
  }

  const b = bookEnv.data as BookingRecord | undefined;
  if (!b) {
    ctx.push({ kind: "error", text: "book_table returned no data" });
    return;
  }
  lastBookingByState.set(ctx.state, b.orderId);
  ctx.state.lastOrderId = b.orderId;
  ctx.push({
    kind: "info",
    text: `Booked: ${b.restaurantName} — ${b.date} ${b.time} for ${b.guestCount} guest(s)`,
  });
  ctx.push({
    kind: "info",
    text: `  ${b.dealTitle} — order ${b.orderId} (${b.status})`,
  });
}

/** /booking [orderId] */
async function bookingHandler(
  ctx: SlashContext,
  argv: string[],
): Promise<void> {
  let orderId: string | undefined = argv[0];
  if (!orderId) {
    orderId =
      lastBookingByState.get(ctx.state) ?? ctx.state.lastOrderId ?? undefined;
  }
  if (!orderId) {
    ctx.push({
      kind: "error",
      text: "no orderId — make a booking first or pass /booking <orderId>",
    });
    return;
  }
  let raw: unknown;
  try {
    raw = await ctx.mcp.call("dineout", "get_booking_status", { orderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `get_booking_status failed: ${msg}` });
    return;
  }
  const env = asEnvelope(raw);
  if (!env || env.success !== true) {
    const msg = env?.error?.message ?? "booking lookup failed";
    ctx.push({ kind: "error", text: msg });
    return;
  }
  const b = env.data as BookingRecord | undefined;
  if (!b) {
    ctx.push({ kind: "error", text: "no booking data" });
    return;
  }
  ctx.push({
    kind: "info",
    text: `${b.restaurantName} — ${b.date} ${b.time}`,
  });
  ctx.push({
    kind: "info",
    text: `  ${b.guestCount} guest(s), ${b.dealTitle}, status ${b.status}, order ${b.orderId}`,
  });
}

export const dineoutHandlers: Record<string, SlashHandler> = {
  tables: tablesHandler,
  book: bookHandler,
  booking: bookingHandler,
};
