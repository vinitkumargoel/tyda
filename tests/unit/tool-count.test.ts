import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../../src/shared/tool-index.js";

const FOOD_TOOLS = [
  "get_addresses",
  "search_restaurants",
  "search_menu",
  "get_restaurant_menu",
  "fetch_food_coupons",
  "apply_food_coupon",
  "get_food_cart",
  "update_food_cart",
  "flush_food_cart",
  "place_food_order",
  "get_food_orders",
  "get_food_order_details",
  "track_food_order",
  "report_error",
];

const INSTAMART_TOOLS = [
  "get_addresses",
  "create_address",
  "delete_address",
  "search_products",
  "your_go_to_items",
  "get_cart",
  "update_cart",
  "clear_cart",
  "checkout",
  "get_orders",
  "get_order_details",
  "track_order",
  "report_error",
];

const DINEOUT_TOOLS = [
  "get_saved_locations",
  "search_restaurants_dineout",
  "get_restaurant_details",
  "get_available_slots",
  "create_cart",
  "book_table",
  "get_booking_status",
  "report_error",
];

describe("ALL_TOOLS manifest shape", () => {
  it("has 14 food tools, 13 instamart tools, 8 dineout tools", () => {
    expect(ALL_TOOLS.food).toHaveLength(14);
    expect(ALL_TOOLS.instamart).toHaveLength(13);
    expect(ALL_TOOLS.dineout).toHaveLength(8);
  });

  it("each food tool from the manifest is present exactly once", () => {
    const names = ALL_TOOLS.food.map((t) => t.name).sort();
    expect(names).toEqual([...FOOD_TOOLS].sort());
  });

  it("each instamart tool from the manifest is present exactly once", () => {
    const names = ALL_TOOLS.instamart.map((t) => t.name).sort();
    expect(names).toEqual([...INSTAMART_TOOLS].sort());
  });

  it("each dineout tool from the manifest is present exactly once", () => {
    const names = ALL_TOOLS.dineout.map((t) => t.name).sort();
    expect(names).toEqual([...DINEOUT_TOOLS].sort());
  });

  it("every tool def has name/description/mutating/inputSchema/outputSchema", () => {
    for (const server of ["food", "instamart", "dineout"] as const) {
      for (const tool of ALL_TOOLS[server]) {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.mutating).toBe("boolean");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      }
    }
  });

  it("marks the expected mutating tools as mutating", () => {
    const expectMutating: Array<[string, string]> = [
      ["food", "place_food_order"],
      ["food", "update_food_cart"],
      ["food", "flush_food_cart"],
      ["food", "apply_food_coupon"],
      ["food", "report_error"],
      ["instamart", "checkout"],
      ["instamart", "update_cart"],
      ["instamart", "clear_cart"],
      ["instamart", "create_address"],
      ["instamart", "delete_address"],
      ["instamart", "report_error"],
      ["dineout", "create_cart"],
      ["dineout", "book_table"],
      ["dineout", "report_error"],
    ];
    for (const [server, name] of expectMutating) {
      const tool = ALL_TOOLS[server as keyof typeof ALL_TOOLS].find(
        (t) => t.name === name,
      );
      expect(tool, `${server}.${name}`).toBeDefined();
      expect(tool!.mutating, `${server}.${name} should be mutating`).toBe(true);
    }
  });
});
