import type { SlashContext } from "../types.js";
import type { SlashHandler } from "./food.js";

/**
 * Scripted recipes from spec/recipe-*.md. Each demo runs the canonical
 * tool sequence for one of the three Swiggy MCP servers so users can see
 * the full happy-path unfold without composing slash commands themselves.
 */

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function announce(ctx: SlashContext, line: string): Promise<void> {
  ctx.push({ kind: "info", text: line });
  await sleep(120);
}

async function runRecipe(
  ctx: SlashContext,
  steps: ReadonlyArray<{ slash: string; argv: string[]; note?: string }>,
): Promise<void> {
  const { REGISTRY } = await import("../registry.js");
  for (const step of steps) {
    if (step.note) await announce(ctx, step.note);
    const handler = REGISTRY.get(step.slash);
    if (!handler) {
      ctx.push({ kind: "error", text: `demo: unknown command /${step.slash}` });
      return;
    }
    ctx.push({ kind: "user", line: `/${step.slash} ${step.argv.join(" ")}`.trim() });
    try {
      await handler.handler(ctx, step.argv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.push({ kind: "error", text: `demo step failed: /${step.slash} — ${msg}` });
      return;
    }
    await sleep(220);
  }
}

const RECIPES: Record<string, ReadonlyArray<{ slash: string; argv: string[]; note?: string }>> = {
  biryani: [
    { slash: "address", argv: ["pick", "1"], note: "Picking Koramangala 4th Block as the delivery address." },
    { slash: "search", argv: ["biryani"], note: "Searching restaurants for biryani." },
    { slash: "menu", argv: ["1"], note: "Opening the top result's menu." },
    { slash: "add", argv: ["M01", "1"], note: "Adding the bestseller to the cart." },
    { slash: "cart", argv: [], note: "Reviewing the cart." },
    { slash: "coupon", argv: ["FLAT100"], note: "Applying coupon FLAT100." },
    { slash: "order", argv: [], note: "Placing the order." },
    { slash: "track", argv: [], note: "Tracking the order — the pinned tracker keeps you posted." },
  ],
  groceries: [
    { slash: "address", argv: ["pick", "1"], note: "Picking Koramangala 4th Block." },
    { slash: "products", argv: ["onion"], note: "Searching Instamart for onions." },
    { slash: "add", argv: ["IP012"], note: "Adding Red Onion (1 kg)." },
    { slash: "products", argv: ["milk"], note: "Searching for milk." },
    { slash: "add", argv: ["IP001"], note: "Adding Amul Taaza milk." },
    { slash: "cart", argv: [], note: "Reviewing the grocery cart." },
    { slash: "order", argv: [], note: "Placing the Instamart order." },
    { slash: "track", argv: [], note: "Tracking the grocery delivery." },
  ],
  tables: [
    { slash: "tables", argv: ["indiranagar"], note: "Finding tables in Indiranagar." },
    { slash: "book", argv: ["DO01-2026-05-19-19-30"], note: "Booking the first available 7:30 PM slot at Toit." },
    { slash: "booking", argv: [], note: "Confirming the booking details." },
  ],
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
    ctx.push({ kind: "info", text: `▶ running /demo ${name} — ${recipe.length} steps` });
    await runRecipe(ctx, recipe);
    ctx.push({ kind: "info", text: `✔ /demo ${name} complete` });
  },
};
