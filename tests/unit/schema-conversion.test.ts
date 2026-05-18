import { describe, expect, it } from "vitest";
import { ALL_TOOLS, type ServerKey } from "../../src/shared/tool-index.js";
import { zodToOpenAI } from "../../src/shared/zod-to-openai.js";

describe("zod-to-openai conversion over ALL_TOOLS", () => {
  const servers: ServerKey[] = ["food", "instamart", "dineout"];

  it("converts every input schema across all 35 tools without throwing", () => {
    let total = 0;
    for (const server of servers) {
      for (const tool of ALL_TOOLS[server]) {
        const fn = () =>
          zodToOpenAI(tool.inputSchema, tool.name, tool.description);
        expect(fn, `${server}.${tool.name}`).not.toThrow();
        const result = fn();
        expect(result.type).toBe("function");
        expect(result.function.name).toBe(tool.name);
        expect(result.function.parameters.type).toBe("object");
        total += 1;
      }
    }
    expect(total).toBe(35);
  });

  it("produces correct per-server counts (14 / 13 / 8)", () => {
    expect(ALL_TOOLS.food.length).toBe(14);
    expect(ALL_TOOLS.instamart.length).toBe(13);
    expect(ALL_TOOLS.dineout.length).toBe(8);
  });

  it("snapshot: place_food_order converted schema", () => {
    const tool = ALL_TOOLS.food.find((t) => t.name === "place_food_order")!;
    const converted = zodToOpenAI(
      tool.inputSchema,
      tool.name,
      tool.description,
    );
    expect(converted).toEqual({
      type: "function",
      function: {
        name: "place_food_order",
        description: tool.description,
        parameters: {
          type: "object",
          properties: {
            addressId: {
              type: "string",
              description:
                "Address ID from the user's saved addresses (coordinates will be fetched automatically)",
            },
            paymentMethod: {
              type: "string",
              description:
                "Payment method to use. Check availablePaymentMethods from get_food_cart response. Auto-defaults to the user's available payment method if not specified.",
            },
          },
          required: ["addressId"],
          additionalProperties: false,
        },
      },
    });
  });

  it("snapshot: update_cart (instamart) converted schema with array of objects", () => {
    const tool = ALL_TOOLS.instamart.find((t) => t.name === "update_cart")!;
    const converted = zodToOpenAI(
      tool.inputSchema,
      tool.name,
      tool.description,
    );
    expect(converted.function.parameters.properties.items).toEqual({
      type: "array",
      description: "Array of items to add to cart",
      items: {
        type: "object",
        properties: {},
      },
    });
    expect(converted.function.parameters.required).toEqual([
      "selectedAddressId",
      "items",
    ]);
  });

  it("rejects unsupported Zod constructs", async () => {
    const { z } = await import("zod");
    const bad = z.object({ when: z.date() });
    expect(() => zodToOpenAI(bad, "bad", "bad")).toThrow(/unsupported/i);
  });

  it("rejects non-object top-level schemas", async () => {
    const { z } = await import("zod");
    const bad = z.string();
    expect(() => zodToOpenAI(bad, "bad", "bad")).toThrow(/must be a ZodObject/);
  });
});
