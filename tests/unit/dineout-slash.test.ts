import { describe, it, expect, beforeEach } from "vitest";

import { dineoutHandlers } from "../../src/tui/slash/commands/dineout.js";
import type {
  McpDispatcher,
  ServerName,
  SlashCommand,
  SlashContext,
  TranscriptEntry,
} from "../../src/tui/slash/types.js";

interface CallRecord {
  server: ServerName;
  tool: string;
  args: Record<string, unknown>;
}

interface Harness {
  ctx: SlashContext;
  entries: TranscriptEntry[];
  calls: CallRecord[];
  setNextResponse: (server: ServerName, tool: string, value: unknown) => void;
}

function makeHarness(): Harness {
  const entries: TranscriptEntry[] = [];
  const calls: CallRecord[] = [];
  const responses = new Map<string, unknown>();

  const mcp: McpDispatcher = {
    async ensureAuth() {
      /* no-op */
    },
    async call(server, tool, args) {
      calls.push({ server, tool, args });
      const key = `${server}:${tool}`;
      if (responses.has(key)) return responses.get(key);
      return { structuredContent: { success: true, data: {} } };
    },
  };

  const ctx: SlashContext = {
    mcp,
    push(entry) {
      entries.push(entry);
    },
    setTracker() {
      /* no-op */
    },
    exit() {
      /* no-op */
    },
    clearTranscript() {
      entries.length = 0;
    },
    state: {
      activeAddressId: null,
      activeRestaurantId: null,
      lastOrderId: null,
    },
    registry: new Map<string, SlashCommand>(),
  };

  return {
    ctx,
    entries,
    calls,
    setNextResponse(server, tool, value) {
      responses.set(`${server}:${tool}`, value);
    },
  };
}

function infoTexts(entries: TranscriptEntry[]): string[] {
  return entries
    .filter((e) => e.kind === "info" || e.kind === "error")
    .map((e) => (e as { text: string }).text);
}

describe("/tables", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("errors when no area is provided", async () => {
    await dineoutHandlers.tables!(h.ctx, []);
    expect(infoTexts(h.entries).some((t) => /usage/.test(t))).toBe(true);
  });

  it("calls search then get_available_slots and renders free slot count", async () => {
    h.setNextResponse("dineout", "search_restaurants_dineout", {
      structuredContent: {
        success: true,
        data: {
          results: [
            { restaurantId: "DO01", name: "Toit", area: "Indiranagar", rating: 4.6 },
            { restaurantId: "DO02", name: "Truffles", area: "Koramangala", rating: 4.4 },
          ],
          page: 1,
          pageSize: 5,
          total: 2,
          hasMore: false,
        },
      },
    });
    h.setNextResponse("dineout", "get_available_slots", {
      structuredContent: {
        success: true,
        data: {
          restaurantId: "DO01",
          days: [
            {
              dateStr: "2026-05-19",
              slots: [
                { slotId: "s1", displayTime: "19:00", capacity: 5 },
                { slotId: "s2", displayTime: "19:30", capacity: 0 },
                { slotId: "s3", displayTime: "20:00", capacity: 3 },
              ],
            },
          ],
        },
      },
    });

    await dineoutHandlers.tables!(h.ctx, ["Indiranagar", "2026-05-19"]);

    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]!.tool).toBe("search_restaurants_dineout");
    expect(h.calls[1]!.tool).toBe("get_available_slots");
    expect(h.calls[1]!.args).toMatchObject({
      restaurantId: "DO01",
      date: "2026-05-19",
    });

    const texts = infoTexts(h.entries).join("\n");
    expect(texts).toMatch(/Toit/);
    expect(texts).toMatch(/2 free slot/);
    expect(h.ctx.state.activeRestaurantId).toBe("DO01");
  });
});

describe("/book", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("errors when no slotId is given", async () => {
    await dineoutHandlers.book!(h.ctx, []);
    expect(infoTexts(h.entries).some((t) => /usage/.test(t))).toBe(true);
  });

  it("chains create_cart -> book_table and reports confirmation", async () => {
    h.ctx.state.activeRestaurantId = "DO01";
    h.setNextResponse("dineout", "create_cart", {
      structuredContent: {
        success: true,
        data: { cartId: "cart_abc" },
      },
    });
    h.setNextResponse("dineout", "book_table", {
      structuredContent: {
        success: true,
        data: {
          orderId: "DO-2026-05-19-0001",
          restaurantName: "Toit",
          date: "2026-05-19",
          time: "19:00",
          guestCount: 2,
          dealTitle: "Free Beer",
          status: "CONFIRMED",
        },
      },
    });

    await dineoutHandlers.book!(h.ctx, ["DO01-2026-05-19-19-00"]);

    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]!.tool).toBe("create_cart");
    expect(h.calls[0]!.args).toMatchObject({
      restaurantId: "DO01",
      slotId: "DO01-2026-05-19-19-00",
      guestCount: 2,
    });
    expect(h.calls[1]!.tool).toBe("book_table");
    expect(h.calls[1]!.args).toMatchObject({ cartId: "cart_abc" });

    expect(h.ctx.state.lastOrderId).toBe("DO-2026-05-19-0001");
    const texts = infoTexts(h.entries).join("\n");
    expect(texts).toMatch(/Booked/);
    expect(texts).toMatch(/DO-2026-05-19-0001/);
  });

  it("reports SLOT_FULL errors from book_table", async () => {
    h.ctx.state.activeRestaurantId = "DO01";
    h.setNextResponse("dineout", "create_cart", {
      structuredContent: { success: true, data: { cartId: "cart_x" } },
    });
    h.setNextResponse("dineout", "book_table", {
      structuredContent: {
        success: false,
        error: { code: "SLOT_FULL", message: "Slot is full" },
      },
    });
    await dineoutHandlers.book!(h.ctx, ["DO01-2026-05-19-19-00"]);
    expect(infoTexts(h.entries).some((t) => /Slot is full/.test(t))).toBe(true);
  });
});

describe("/booking", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("requires an orderId when none is cached", async () => {
    await dineoutHandlers.booking!(h.ctx, []);
    expect(infoTexts(h.entries).some((t) => /no orderId/.test(t))).toBe(true);
  });

  it("uses the most recent booking from state when no orderId given", async () => {
    h.ctx.state.lastOrderId = "DO-2026-05-19-0007";
    h.setNextResponse("dineout", "get_booking_status", {
      structuredContent: {
        success: true,
        data: {
          orderId: "DO-2026-05-19-0007",
          restaurantName: "Toit",
          date: "2026-05-19",
          time: "19:00",
          guestCount: 4,
          dealTitle: "Free Beer",
          status: "CONFIRMED",
        },
      },
    });
    await dineoutHandlers.booking!(h.ctx, []);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.args).toMatchObject({ orderId: "DO-2026-05-19-0007" });
    const texts = infoTexts(h.entries).join("\n");
    expect(texts).toMatch(/Toit/);
    expect(texts).toMatch(/4 guest/);
  });
});
