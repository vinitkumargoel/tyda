/**
 * Smoke tests for the Food slash command handlers.
 *
 * Verifies that parsing `/search biryani` dispatches into
 * `food.search_restaurants` via the McpDispatcher contract, and that
 * `/menu <id>` dispatches into `food.get_restaurant_menu`.
 */
import { describe, it, expect } from "vitest";

import { parseSlash } from "../../src/tui/slash/parser.js";
import { REGISTRY } from "../../src/tui/slash/registry.js";
import type {
  McpDispatcher,
  ServerName,
  SlashContext,
  TranscriptEntry,
} from "../../src/tui/slash/types.js";

interface RecordedCall {
  server: ServerName;
  tool: string;
  args: Record<string, unknown>;
}

function makeCtx(calls: RecordedCall[], reply: unknown): SlashContext {
  const transcript: TranscriptEntry[] = [];
  const dispatcher: McpDispatcher = {
    async call(server, tool, args) {
      calls.push({ server, tool, args });
      return reply;
    },
    async ensureAuth() {},
  };
  return {
    mcp: dispatcher,
    push: (e) => {
      transcript.push(e);
    },
    setTracker: () => {},
    exit: () => {},
    clearTranscript: () => {},
    state: {
      activeAddressId: null,
      activeRestaurantId: null,
      lastOrderId: null,
    },
    registry: REGISTRY,
  };
}

describe("food slash commands", () => {
  it("/search biryani dispatches food.search_restaurants", async () => {
    const calls: RecordedCall[] = [];
    const ctx = makeCtx(calls, {
      structuredContent: {
        success: true,
        data: { restaurants: [], total: 0, nextOffset: null },
      },
    });
    const parsed = parseSlash("/search biryani")!;
    const command = REGISTRY.get(parsed.cmd)!;
    await command.handler(ctx, parsed.argv);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.server).toBe("food");
    expect(calls[0]!.tool).toBe("search_restaurants");
    expect(calls[0]!.args).toMatchObject({ query: "biryani" });
  });

  it("/menu 1 dispatches food.get_restaurant_menu", async () => {
    const calls: RecordedCall[] = [];
    const ctx = makeCtx(calls, {
      structuredContent: {
        success: true,
        data: {
          restaurantId: "1",
          restaurantName: "Test",
          page: 1,
          pageSize: 5,
          totalCategories: 0,
          categories: [],
          hasMore: false,
        },
      },
    });
    const parsed = parseSlash("/menu 1")!;
    const command = REGISTRY.get(parsed.cmd)!;
    await command.handler(ctx, parsed.argv);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.server).toBe("food");
    expect(calls[0]!.tool).toBe("get_restaurant_menu");
    expect(calls[0]!.args).toMatchObject({ restaurantId: "1" });
    expect(ctx.state.activeRestaurantId).toBe("1");
  });
});
