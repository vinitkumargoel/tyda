import { describe, it, expect } from "vitest";
import type React from "react";

import { parseSlash } from "../../src/tui/slash/parser.js";
import { instamartHandlers } from "../../src/tui/slash/commands/instamart.js";
import type {
  McpDispatcher,
  ServerName,
  SlashContext,
  TranscriptEntry,
} from "../../src/tui/slash/types.js";

interface CallLog {
  server: ServerName;
  tool: string;
  args: Record<string, unknown>;
}

function makeMcp(
  responder: (server: ServerName, tool: string, args: Record<string, unknown>) => unknown,
): { mcp: McpDispatcher; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const mcp: McpDispatcher = {
    async call(server, tool, args) {
      calls.push({ server, tool, args });
      const out = responder(server, tool, args);
      return Promise.resolve(out);
    },
    async ensureAuth() {
      // noop
    },
  };
  return { mcp, calls };
}

function makeCtx(
  mcp: McpDispatcher,
  state: Partial<SlashContext["state"]> = {},
): {
  ctx: SlashContext;
  entries: TranscriptEntry[];
  tracker: { current: React.ReactNode | null };
} {
  const entries: TranscriptEntry[] = [];
  const tracker = { current: null as React.ReactNode | null };
  const ctx: SlashContext = {
    mcp,
    push: (e) => {
      entries.push(e);
    },
    setTracker: (n) => {
      tracker.current = n;
    },
    exit: () => {},
    clearTranscript: () => {},
    state: {
      activeAddressId: state.activeAddressId ?? null,
      activeRestaurantId: state.activeRestaurantId ?? null,
      lastOrderId: state.lastOrderId ?? null,
    },
    registry: new Map(),
  };
  return { ctx, entries, tracker };
}

/** Build a mock CallToolResult envelope from a tool payload. */
function toolResult(envelope: unknown): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}

describe("instamart slash commands — parser", () => {
  it("parses /products with multi-word query", () => {
    expect(parseSlash("/products fresh milk")).toEqual({
      cmd: "products",
      argv: ["fresh", "milk"],
    });
  });

  it("parses /add with id and qty", () => {
    expect(parseSlash("/add IP001-1l 2")).toEqual({
      cmd: "add",
      argv: ["IP001-1l", "2"],
    });
  });
});

describe("instamart slash commands — dispatch", () => {
  it("/products requires an active address", async () => {
    const { mcp, calls } = makeMcp(() => ({}));
    const { ctx, entries } = makeCtx(mcp);
    await instamartHandlers.products!(ctx, ["milk"]);
    expect(calls).toHaveLength(0);
    expect(entries.some((e) => e.kind === "info" && /no address/.test(e.text))).toBe(true);
  });

  it("/products calls search_products and renders results", async () => {
    const { mcp, calls } = makeMcp((_s, tool) => {
      if (tool !== "search_products") throw new Error("unexpected tool");
      return toolResult({
        success: true,
        data: {
          products: [
            {
              id: "IP001",
              name: "Amul Milk",
              brand: "Amul",
              category: "Dairy",
              variants: [
                { spinId: "IP001-1l", label: "1 L", price: 58, available: true, stock: 100 },
                { spinId: "IP001-500ml", label: "500 ml", price: 30, available: false, stock: 0 },
              ],
            },
          ],
          page: 0,
          pageSize: 8,
          total: 1,
        },
      });
    });
    const { ctx, entries } = makeCtx(mcp, { activeAddressId: "addr_1" });
    await instamartHandlers.products!(ctx, ["milk"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe("search_products");
    expect(calls[0]!.args).toMatchObject({ query: "milk", addressId: "addr_1" });
    // Header + product + 2 variants
    const infoLines = entries.filter((e) => e.kind === "info");
    expect(infoLines.length).toBeGreaterThanOrEqual(4);
    expect(infoLines.some((e) => "text" in e && /OOS/.test(e.text))).toBe(true);
  });

  it("/add merges into existing cart and calls update_cart", async () => {
    const calls: CallLog[] = [];
    const mcp: McpDispatcher = {
      async call(server, tool, args) {
        calls.push({ server, tool, args });
        if (tool === "get_cart") {
          return toolResult({
            success: true,
            data: {
              cart: {
                addressId: "addr_1",
                items: [
                  {
                    spinId: "IP001-1l",
                    productId: "IP001",
                    name: "Amul Milk",
                    variantLabel: "1 L",
                    price: 58,
                    quantity: 1,
                  },
                ],
              },
              bill: { subtotal: 58, deliveryFee: 30, handlingFee: 2, discount: 0, total: 90, appliedCoupon: null },
              availablePaymentMethods: ["UPI"],
            },
          });
        }
        if (tool === "update_cart") {
          return toolResult({
            success: true,
            data: {
              cart: {
                addressId: "addr_1",
                items: [
                  {
                    spinId: "IP001-1l",
                    productId: "IP001",
                    name: "Amul Milk",
                    variantLabel: "1 L",
                    price: 58,
                    quantity: 3,
                  },
                ],
              },
              bill: { subtotal: 174, deliveryFee: 0, handlingFee: 2, discount: 0, total: 176, appliedCoupon: null },
            },
            message: "Cart updated.",
          });
        }
        throw new Error(`unexpected tool: ${tool}`);
      },
      async ensureAuth() {},
    };
    const { ctx, entries } = makeCtx(mcp, { activeAddressId: "addr_1" });
    await instamartHandlers.add!(ctx, ["IP001-1l", "2"]);
    expect(calls.map((c) => c.tool)).toEqual(["get_cart", "update_cart"]);
    expect(calls[1]!.args).toMatchObject({
      selectedAddressId: "addr_1",
      items: [{ spinId: "IP001-1l", quantity: 3 }],
    });
    expect(entries.some((e) => e.kind === "info")).toBe(true);
  });

  it("/add ignores non-Instamart ids (food-prefixed)", async () => {
    const { mcp, calls } = makeMcp(() => ({}));
    const { ctx } = makeCtx(mcp, { activeAddressId: "addr_1" });
    await instamartHandlers.add!(ctx, ["FD001"]);
    expect(calls).toHaveLength(0);
  });

  it("/clear calls clear_cart", async () => {
    const { mcp, calls } = makeMcp(() =>
      toolResult({ success: true, data: { cleared: true }, message: "cleared" }),
    );
    const { ctx, entries } = makeCtx(mcp, { activeAddressId: "addr_1" });
    await instamartHandlers.clear!(ctx, []);
    expect(calls[0]!.tool).toBe("clear_cart");
    expect(entries.some((e) => e.kind === "info")).toBe(true);
  });

  it("/orders renders order list", async () => {
    const { mcp, calls } = makeMcp(() =>
      toolResult({
        success: true,
        data: {
          orders: [
            {
              id: "IM-2026-05-18-0001",
              state: "PLACED",
              etaMinutes: 12,
              items: [],
              bill: { subtotal: 100, deliveryFee: 0, handlingFee: 2, discount: 0, total: 102, appliedCoupon: null },
            },
          ],
        },
      }),
    );
    const { ctx, entries } = makeCtx(mcp);
    await instamartHandlers.orders!(ctx, []);
    expect(calls[0]!.tool).toBe("get_orders");
    expect(
      entries.some((e) => e.kind === "info" && /IM-2026-05-18-0001/.test(e.text)),
    ).toBe(true);
  });
});
