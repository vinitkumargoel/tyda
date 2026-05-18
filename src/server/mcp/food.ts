/**
 * Food MCP server.
 *
 * Wires the 14 Food tools and exposes a `mountFood` helper that attaches a
 * minimal JSON-RPC over HTTP handler at `POST /food`. Follows the same
 * Streamable-HTTP-lite pattern used by Tracks G (Instamart) and H (Dineout):
 * the Wave 1 conformance hook already handles Origin, Accept, and session id.
 *
 * Carries `request.auth` (JWT claims set by the `requireAuth` pre-handler)
 * into the handler context, plus a process-singleton sim ticker so order
 * state advances over time without per-request bookkeeping.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { z } from "zod";
import { ALL_TOOLS, type ToolDef } from "../../shared/tool-index.js";
import { zodToOpenAI } from "../../shared/zod-to-openai.js";
import { logger } from "../logger.js";
import { mutate } from "../store.js";
import {
  spawnDriver,
  startTicker,
  type DriverState,
  type OrderTicker,
} from "../sim/index.js";
import type { TokenClaims } from "../oauth/jwt.js";
import type { HandlerContext } from "../handlers/food/_types.js";

// Handlers
import getAddresses from "../handlers/food/get_addresses.js";
import searchRestaurants from "../handlers/food/search_restaurants.js";
import searchMenu from "../handlers/food/search_menu.js";
import getRestaurantMenu from "../handlers/food/get_restaurant_menu.js";
import fetchFoodCoupons from "../handlers/food/fetch_food_coupons.js";
import applyFoodCoupon from "../handlers/food/apply_food_coupon.js";
import getFoodCart from "../handlers/food/get_food_cart.js";
import updateFoodCart from "../handlers/food/update_food_cart.js";
import flushFoodCart from "../handlers/food/flush_food_cart.js";
import placeFoodOrder from "../handlers/food/place_food_order.js";
import getFoodOrders from "../handlers/food/get_food_orders.js";
import getFoodOrderDetails from "../handlers/food/get_food_order_details.js";
import trackFoodOrder from "../handlers/food/track_food_order.js";
import reportError from "../handlers/food/report_error.js";

export interface MountFoodOpts {
  authPreHandler: preHandlerHookHandler;
}

type ToolResult =
  | { success: true; data: unknown; message?: string }
  | { success: false; error: { code?: string; message: string } };

type Handler = (
  args: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<ToolResult>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const HANDLERS: Record<string, Handler> = {
  get_addresses: getAddresses as unknown as Handler,
  search_restaurants: searchRestaurants as unknown as Handler,
  search_menu: searchMenu as unknown as Handler,
  get_restaurant_menu: getRestaurantMenu as unknown as Handler,
  fetch_food_coupons: fetchFoodCoupons as unknown as Handler,
  apply_food_coupon: applyFoodCoupon as unknown as Handler,
  get_food_cart: getFoodCart as unknown as Handler,
  update_food_cart: updateFoodCart as unknown as Handler,
  flush_food_cart: flushFoodCart as unknown as Handler,
  place_food_order: placeFoodOrder as unknown as Handler,
  get_food_orders: getFoodOrders as unknown as Handler,
  get_food_order_details: getFoodOrderDetails as unknown as Handler,
  track_food_order: trackFoodOrder as unknown as Handler,
  report_error: reportError as unknown as Handler,
};

function toolList(): unknown[] {
  return ALL_TOOLS.food.map((t: ToolDef) => {
    const oai = zodToOpenAI(t.inputSchema, t.name, t.description);
    return {
      name: t.name,
      description: t.description,
      inputSchema: oai.function.parameters,
    };
  });
}

function validateArgs(
  name: string,
  raw: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; issues: z.ZodIssue[] } {
  const tool = ALL_TOOLS.food.find((t) => t.name === name);
  if (!tool) return { ok: true, args: (raw ?? {}) as Record<string, unknown> };
  const parsed = (tool.inputSchema as z.ZodTypeAny).safeParse(raw ?? {});
  if (parsed.success) return { ok: true, args: parsed.data as Record<string, unknown> };
  logger.debug("food.args.invalid", { tool: name, issues: parsed.error.issues });
  return { ok: false, issues: parsed.error.issues };
}

/**
 * Build process-singleton sim context. The ticker advances any registered
 * order through PLACED → PREPARING → OUT_FOR_DELIVERY → DELIVERED at the
 * configured speed (default `fast`). When an order transitions to
 * OUT_FOR_DELIVERY we materialize a driver and persist rider info on the
 * order so `track_food_order` reads it.
 */
function createSimContext(): {
  ticker: OrderTicker;
  drivers: Map<string, DriverState>;
} {
  const drivers = new Map<string, DriverState>();
  const ticker = startTicker(
    () => Date.now(),
    (changed) => {
      for (const rec of changed) {
        void mutate((s) => {
          const order = s.orders.food.find((o) => o.id === rec.id);
          if (!order) return;
          order.state = rec.state;
          if (rec.state === "OUT_FOR_DELIVERY") {
            if (!drivers.has(rec.id)) {
              drivers.set(
                rec.id,
                spawnDriver({ lat: order.address.lat, lng: order.address.lng }),
              );
            }
            const d = drivers.get(rec.id)!;
            order.rider = {
              name: d.name,
              distanceKm: Number(d.distanceKm.toFixed(2)),
              etaMinutes: Math.max(1, Math.round(d.eta)),
            };
          }
          if (rec.state === "DELIVERED" || rec.state === "CANCELLED") {
            drivers.delete(rec.id);
          }
        }).catch((err) => {
          logger.error("food.ticker.persist_failed", {
            err: (err as Error).message,
          });
        });
      }
    },
  );
  return { ticker, drivers };
}

const ANONYMOUS_CLAIMS: TokenClaims = {
  sub: "anonymous",
  jti: "anonymous",
  client_id: "anonymous",
};

export function mountFood(
  app: FastifyInstance,
  opts: MountFoodOpts,
): void {
  const sim = createSimContext();

  app.post(
    "/food",
    { preHandler: opts.authPreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as JsonRpcRequest;
      const id = body.id ?? null;
      const method = body.method ?? "";
      reply.header("Content-Type", "application/json");

      // MCP initialize handshake — the SDK Client sends this on connect().
      if (method === "initialize") {
        const clientVersion =
          (body.params as Record<string, unknown> | undefined)?.protocolVersion ?? "2024-11-05";
        return {
          jsonrpc: "2.0",
          result: {
            protocolVersion: clientVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "tyda-food", version: "0.1.0" },
          },
          id,
        };
      }

      // Notifications have no id — ack with 204, no body.
      if (id === null && method.startsWith("notifications/")) {
        reply.code(202);
        return "";
      }

      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          result: { tools: toolList() },
          id,
        };
      }

      if (method === "tools/call") {
        const name = body.params?.name ?? "";
        const handler = HANDLERS[name];
        if (!handler) {
          return {
            jsonrpc: "2.0",
            error: { code: -32601, message: `Tool "${name}" not found.` },
            id,
          };
        }
        const validation = validateArgs(name, body.params?.arguments ?? {});
        if (!validation.ok) {
          return {
            jsonrpc: "2.0",
            error: {
              code: -32602,
              message: "Invalid params",
              data: validation.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
            },
            id,
          };
        }
        const args = validation.args;
        const ctx: HandlerContext = {
          auth: request.auth ?? ANONYMOUS_CLAIMS,
          ticker: sim.ticker,
          drivers: sim.drivers,
        };
        try {
          const result = await handler(args, ctx);
          return {
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: !result.success,
              structuredContent: result,
            },
            id,
          };
        } catch (err) {
          const e = err as Error;
          logger.error("food.handler.error", {
            tool: name,
            err: e.message,
          });
          return {
            jsonrpc: "2.0",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: { code: "INTERNAL", message: e.message },
                  }),
                },
              ],
              isError: true,
            },
            id,
          };
        }
      }

      return {
        jsonrpc: "2.0",
        error: { code: -32601, message: `Method not found: ${method}` },
        id,
      };
    },
  );
}
