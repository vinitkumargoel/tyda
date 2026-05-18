import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../src/server/http.js";
import { setStateDir } from "../../src/server/store.js";
import { runPkceFlow } from "../../src/tui/oauth-flow.js";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Headless happy-path harness. Drives the mock end-to-end through the
 * biryani recipe via raw JSON-RPC over fetch (no Ink). Verifies the order
 * ticks through all states down to DELIVERED.
 */

const POLL_MS = 1_000;
const FINAL_STATE_TIMEOUT_MS = 45_000;

async function callTool(
  baseUrl: string,
  server: "food" | "im" | "dineout",
  tool: string,
  args: Record<string, unknown>,
  token: string,
): Promise<{ success: boolean; data?: any; error?: any; message?: string }> {
  const res = await fetch(`${baseUrl}/${server}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "http://127.0.0.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: tool, arguments: args },
      id: Math.floor(Math.random() * 1e9),
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { structuredContent?: any; content?: any[] }; error?: any };
  if (body.error) throw new Error(`tool ${tool} failed: ${JSON.stringify(body.error)}`);
  const result = body.result;
  if (!result) throw new Error(`tool ${tool} returned no result`);
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (typeof text === "string") return JSON.parse(text);
  throw new Error(`tool ${tool} returned unparseable result`);
}

describe("happy path — biryani end-to-end", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let token: string;
  const stateDir = mkdtempSync(join(tmpdir(), "tyda-e2e-"));

  beforeAll(async () => {
    setStateDir(stateDir);
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    app = await buildApp({
      issuer: baseUrl,
      autoApprove: true,
      heartbeatMs: 1_000,
    });
    await app.listen({ host: "127.0.0.1", port });
    // PKCE flow against the running server. The "browser" is a direct fetch.
    const tokenResult = await runPkceFlow({
      issuer: baseUrl,
      openBrowser: async (url) => {
        // Approve immediately.
        const r = await fetch(url, { redirect: "manual" });
        if (r.status >= 300 && r.status < 400) {
          const loc = r.headers.get("location");
          if (loc) await fetch(loc).catch(() => {});
        }
      },
    });
    token = tokenResult.accessToken;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it(
    "places a food order and tracks it through DELIVERED",
    async () => {
      // Food keeps its own address list (server-independence). It seeds presets
      // on first call; pull them out and use the first.
      const addrs = await callTool(baseUrl, "food", "get_addresses", {}, token);
      expect(addrs.success).toBe(true);
      const addressList: any[] = addrs.data.addresses ?? addrs.data.items ?? addrs.data;
      expect(Array.isArray(addressList) && addressList.length > 0).toBe(true);
      const foodAddressId = addressList[0].id;
      expect(typeof foodAddressId).toBe("string");

      const food = await callTool(baseUrl, "food", "search_restaurants", { query: "biryani" }, token);
      expect(food.success).toBe(true);
      const restaurants = food.data.restaurants ?? food.data.items ?? food.data;
      const first = Array.isArray(restaurants) ? restaurants[0] : restaurants[0];
      expect(first).toBeDefined();
      const restaurantId = first.id ?? first.restaurantId;
      expect(restaurantId).toBeTruthy();

      const menu = await callTool(baseUrl, "food", "get_restaurant_menu", { restaurantId }, token);
      expect(menu.success).toBe(true);
      const menuItems: any[] =
        menu.data.items ??
        menu.data.menu ??
        (menu.data.categories ? menu.data.categories.flatMap((c: any) => c.items ?? []) : []);
      expect(menuItems.length).toBeGreaterThan(0);
      const firstItem = menuItems[0];
      const menuItemId = firstItem.id ?? firstItem.menuItemId;

      const updated = await callTool(
        baseUrl,
        "food",
        "update_food_cart",
        { restaurantId, cartItems: [{ menuItemId, quantity: 1 }] },
        token,
      );
      expect(updated.success).toBe(true);

      const cart = await callTool(baseUrl, "food", "get_food_cart", {}, token);
      expect(cart.success).toBe(true);

      const placed = await callTool(baseUrl, "food", "place_food_order", { addressId: foodAddressId }, token);
      expect(placed.success).toBe(true);
      const orderId = placed.data.orderId ?? placed.data.order?.id ?? placed.data.id;
      expect(typeof orderId).toBe("string");

      // Poll track_food_order until DELIVERED. With fast demo speed:
      // PLACED(5s) → PREPARING(10s) → OFD(15s) → DELIVERED. ~30 seconds total.
      const deadline = Date.now() + FINAL_STATE_TIMEOUT_MS;
      let lastState = "";
      while (Date.now() < deadline) {
        const status = await callTool(baseUrl, "food", "track_food_order", { orderId }, token);
        expect(status.success).toBe(true);
        const state =
          status.data.state ??
          status.data.status ??
          status.data.order?.state ??
          status.data.orders?.[0]?.state ??
          "";
        if (state !== lastState) {
          lastState = state;
        }
        if (state === "DELIVERED") break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      expect(lastState).toBe("DELIVERED");
    },
    60_000,
  );
});
