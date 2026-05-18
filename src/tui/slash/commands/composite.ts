import type { SlashContext } from "../types.js";
import { foodHandlers, type SlashHandler } from "./food.js";
import { instamartHandlers } from "./instamart.js";

/**
 * Several slash commands (/add, /cart, /order, /track, /orders, /clear, /remove)
 * are valid for both Food and Instamart. Route by ID prefix or by which cart
 * is active.
 *
 * ID conventions:
 *   M\d+    food menu item
 *   IP\d+   instamart product (variants are IP\d+-<size>)
 *   FD-...  food order id
 *   IM-...  instamart order id
 *   DO-...  dineout booking id
 */

function isInstamartId(id: string): boolean {
  return /^IP/i.test(id);
}

function pickActiveKind(ctx: SlashContext): "food" | "instamart" {
  return ctx.state.activeRestaurantId ? "food" : "instamart";
}

export const compositeHandlers: Record<string, SlashHandler> = {
  add: async (ctx, argv) => {
    const id = argv[0];
    if (!id) {
      ctx.push({ kind: "error", text: "usage: /add <id> [qty]" });
      return;
    }
    if (isInstamartId(id)) {
      return instamartHandlers.add!(ctx, argv);
    }
    return foodHandlers.add!(ctx, argv);
  },

  remove: async (ctx, argv) => {
    const id = argv[0];
    if (!id) {
      ctx.push({ kind: "error", text: "usage: /remove <id>" });
      return;
    }
    if (isInstamartId(id)) {
      const handler = instamartHandlers.remove;
      if (handler) return handler(ctx, argv);
      ctx.push({ kind: "info", text: "/remove for Instamart: set qty to 0 with /add <id> 0" });
      return;
    }
    const handler = foodHandlers.remove;
    if (handler) return handler(ctx, argv);
    ctx.push({ kind: "info", text: "/remove for Food: set qty to 0 with /add <id> 0" });
  },

  cart: async (ctx, argv) => {
    const kind = pickActiveKind(ctx);
    return kind === "instamart"
      ? instamartHandlers.cart!(ctx, argv)
      : foodHandlers.cart!(ctx, argv);
  },

  clear: async (ctx, argv) => {
    const kind = pickActiveKind(ctx);
    return kind === "instamart"
      ? instamartHandlers.clear!(ctx, argv)
      : foodHandlers.clear!(ctx, argv);
  },

  order: async (ctx, argv) => {
    const kind = pickActiveKind(ctx);
    return kind === "instamart"
      ? instamartHandlers.order!(ctx, argv)
      : foodHandlers.order!(ctx, argv);
  },

  track: async (ctx, argv) => {
    const arg = argv[0];
    if (arg === "off") {
      ctx.setTracker(null);
      ctx.push({ kind: "info", text: "tracker detached" });
      return;
    }
    const candidate = arg ?? ctx.state.lastOrderId ?? "";
    if (candidate.startsWith("IM-")) {
      return instamartHandlers.track!(ctx, argv);
    }
    if (candidate.startsWith("DO-")) {
      const handler = (await import("./dineout.js")).dineoutHandlers.booking;
      return handler ? handler(ctx, [candidate]) : Promise.resolve();
    }
    return foodHandlers.track!(ctx, argv);
  },

  orders: async (ctx, argv) => {
    ctx.push({ kind: "info", text: "— Food orders —" });
    await foodHandlers.orders!(ctx, argv);
    ctx.push({ kind: "info", text: "— Instamart orders —" });
    await instamartHandlers.orders!(ctx, argv);
  },
};
