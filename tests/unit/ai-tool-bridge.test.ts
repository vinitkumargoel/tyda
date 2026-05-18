import { describe, it, expect } from "vitest";

import {
  buildToolBridge,
  getAllTools,
} from "../../src/tui/ai/tool-bridge.js";
import { ALL_TOOLS } from "../../src/shared/tool-index.js";

describe("ai/tool-bridge", () => {
  it("converts every tool across all 35 entries", () => {
    const tools = getAllTools();
    const total =
      ALL_TOOLS.food.length +
      ALL_TOOLS.instamart.length +
      ALL_TOOLS.dineout.length;
    expect(total).toBe(35);
    expect(tools.length).toBe(35);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.name).toBe("string");
      expect(t.function.parameters.type).toBe("object");
    }
  });

  it("disambiguates colliding tool names by prefixing the server", () => {
    const bridge = buildToolBridge();
    // get_addresses exists on both food and instamart, so both must be prefixed.
    expect(bridge.byName.has("get_addresses")).toBe(false);
    expect(bridge.byName.has("food__get_addresses")).toBe(true);
    expect(bridge.byName.has("instamart__get_addresses")).toBe(true);
    // report_error exists on all three servers.
    expect(bridge.byName.has("food__report_error")).toBe(true);
    expect(bridge.byName.has("instamart__report_error")).toBe(true);
    expect(bridge.byName.has("dineout__report_error")).toBe(true);
  });

  it("keeps unique tool names un-prefixed", () => {
    const bridge = buildToolBridge();
    // search_restaurants is unique to food.
    const entry = bridge.byName.get("search_restaurants");
    expect(entry).toBeDefined();
    expect(entry?.server).toBe("food");
    expect(entry?.toolDef.name).toBe("search_restaurants");
    // search_products is unique to instamart.
    const ip = bridge.byName.get("search_products");
    expect(ip?.server).toBe("im");
    expect(ip?.toolDef.name).toBe("search_products");
  });

  it("maps every fnName to the correct dispatcher server", () => {
    const bridge = buildToolBridge();
    let foodCount = 0;
    let imCount = 0;
    let dineoutCount = 0;
    for (const entry of bridge.byName.values()) {
      if (entry.server === "food") foodCount += 1;
      else if (entry.server === "im") imCount += 1;
      else if (entry.server === "dineout") dineoutCount += 1;
    }
    expect(foodCount).toBe(ALL_TOOLS.food.length);
    expect(imCount).toBe(ALL_TOOLS.instamart.length);
    expect(dineoutCount).toBe(ALL_TOOLS.dineout.length);
  });
});
