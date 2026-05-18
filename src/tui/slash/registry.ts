import type { SlashCommand, SlashContext } from "./types.js";
import { foodHandlers } from "./commands/food.js";
import { instamartHandlers } from "./commands/instamart.js";
import { dineoutHandlers } from "./commands/dineout.js";
import { miscHandlers } from "./commands/misc.js";
import { compositeHandlers } from "./commands/composite.js";
import { demoHandlers } from "./commands/demo.js";
import { aiHandlers } from "./commands/ai.js";

async function helpHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  const visible = [...ctx.registry.values()].filter((c) => !c.hidden);
  const labelOf = (c: SlashCommand) => (c.args ? `/${c.name} ${c.args}` : `/${c.name}`);
  const width = visible.reduce((m, c) => Math.max(m, labelOf(c).length), 0);

  for (const c of visible) {
    const label = labelOf(c).padEnd(width + 2, " ");
    ctx.push({ kind: "info", text: `  ${label}${c.summary}` });
  }
}

async function quitHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  ctx.exit();
}

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    args: "",
    summary: "list commands",
    handler: helpHandler,
  },
  {
    name: "login",
    args: "",
    summary: "(re)run OAuth PKCE",
    handler: miscHandlers.login!,
  },
  {
    name: "address",
    args: "[list|use <n>|pick <n>|add \"<line>\"]",
    summary: "manage delivery addresses",
    handler: miscHandlers.address!,
    suggest: (argv) => {
      if (argv.length <= 1) return ["list", "use", "pick", "add"];
      return [];
    },
  },
  {
    name: "search",
    args: "<query>",
    summary: "find restaurants for delivery",
    handler: foodHandlers.search!,
  },
  {
    name: "menu",
    args: "<restaurant-id>",
    summary: "open a restaurant menu",
    handler: foodHandlers.menu!,
  },
  {
    name: "products",
    args: "<query>",
    summary: "search Instamart",
    handler: instamartHandlers.products!,
  },
  {
    name: "add",
    args: "<id> [qty]",
    summary: "add an item to the current cart (M* food, IP* instamart)",
    handler: compositeHandlers.add!,
  },
  {
    name: "remove",
    args: "<id>",
    summary: "remove an item from the current cart",
    handler: compositeHandlers.remove!,
  },
  {
    name: "clear",
    args: "",
    summary: "clear the current cart",
    handler: compositeHandlers.clear!,
  },
  {
    name: "cart",
    args: "",
    summary: "show the current cart",
    handler: compositeHandlers.cart!,
  },
  {
    name: "coupon",
    args: "<code>",
    summary: "apply a food coupon",
    handler: foodHandlers.coupon!,
  },
  {
    name: "order",
    args: "",
    summary: "place the current cart",
    handler: compositeHandlers.order!,
  },
  {
    name: "track",
    args: "[order-id|off]",
    summary: "live-track an order (off detaches)",
    handler: compositeHandlers.track!,
  },
  {
    name: "orders",
    args: "",
    summary: "list recent orders",
    handler: compositeHandlers.orders!,
  },
  {
    name: "tables",
    args: "<area>",
    summary: "find dineout tables",
    handler: dineoutHandlers.tables!,
  },
  {
    name: "book",
    args: "<slot-id>",
    summary: "book a dineout slot",
    handler: dineoutHandlers.book!,
  },
  {
    name: "booking",
    args: "<booking-id>",
    summary: "show a dineout booking",
    handler: dineoutHandlers.booking!,
  },
  {
    name: "demo",
    args: "<recipe>",
    summary: "run a canned demo recipe (biryani|groceries|tables)",
    handler: demoHandlers.demo!,
  },
  {
    // /ai stays in the static registry as `hidden: true`. cli.ts un-hides it
    // at runtime when the loaded config has a fully-resolved `llm` block.
    // The handler itself also gates on `ctx.config.llm` so direct invocation
    // (typing `/ai foo` even when hidden) prints a useful message rather
    // than blowing up.
    name: "ai",
    args: "<prompt>",
    summary: "hand off to the LLM agent",
    hidden: true,
    handler: aiHandlers.ai!,
  },
  {
    name: "quit",
    args: "",
    summary: "exit the TUI",
    handler: quitHandler,
  },
];

export const REGISTRY: ReadonlyMap<string, SlashCommand> = new Map(
  COMMANDS.map((c) => [c.name, c]),
);

export function suggestCommands(prefix: string, limit = 6): SlashCommand[] {
  const lower = prefix.toLowerCase();
  return COMMANDS.filter((c) => !c.hidden && c.name.startsWith(lower)).slice(0, limit);
}

/**
 * Toggle visibility of `/ai` in `/help` based on whether an LLM is configured.
 * Mutates the existing registry entry (rather than rebuilding the registry)
 * so suggest / help reflect the change without losing identity. Safe to call
 * once at app start.
 */
export function setAiCommandVisibility(visible: boolean): void {
  const cmd = REGISTRY.get("ai") as { hidden?: boolean } | undefined;
  if (cmd) cmd.hidden = !visible;
}
