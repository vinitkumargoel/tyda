/**
 * Instamart MCP server.
 *
 * Wires the 13 Instamart tools and exposes a `mountInstamart` helper that
 * attaches a JSON-RPC handler at `POST /im`. Follows the same minimal
 * Streamable-HTTP pattern as Track H's `mountDineout`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { ALL_TOOLS, type ToolDef } from "../../shared/tool-index.js";
import { zodToOpenAI } from "../../shared/zod-to-openai.js";
import { logger } from "../logger.js";

// Handlers
import { getAddresses } from "../handlers/instamart/get_addresses.js";
import { createAddress } from "../handlers/instamart/create_address.js";
import { deleteAddress } from "../handlers/instamart/delete_address.js";
import { searchProducts } from "../handlers/instamart/search_products.js";
import { yourGoToItems } from "../handlers/instamart/your_go_to_items.js";
import { getCart } from "../handlers/instamart/get_cart.js";
import { updateCart } from "../handlers/instamart/update_cart.js";
import { clearCart } from "../handlers/instamart/clear_cart.js";
import { checkout } from "../handlers/instamart/checkout.js";
import { getOrders } from "../handlers/instamart/get_orders.js";
import { getOrderDetails } from "../handlers/instamart/get_order_details.js";
import { trackOrder } from "../handlers/instamart/track_order.js";
import { reportError } from "../handlers/instamart/report_error.js";

export interface MountInstamartOpts {
  authPreHandler: preHandlerHookHandler;
}

type ToolResult =
  | { success: true; data: unknown; message?: string }
  | { success: false; error: { code?: string; message: string } };

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

function toolList(): unknown[] {
  return ALL_TOOLS.instamart.map((t: ToolDef) => {
    const oai = zodToOpenAI(t.inputSchema, t.name, t.description);
    return {
      name: t.name,
      description: t.description,
      inputSchema: oai.function.parameters,
    };
  });
}

const HANDLERS: Record<string, Handler> = {
  get_addresses: (() => getAddresses()) as unknown as Handler,
  create_address: createAddress as unknown as Handler,
  delete_address: deleteAddress as unknown as Handler,
  search_products: searchProducts as unknown as Handler,
  your_go_to_items: yourGoToItems as unknown as Handler,
  get_cart: (() => getCart()) as unknown as Handler,
  update_cart: updateCart as unknown as Handler,
  clear_cart: (() => clearCart()) as unknown as Handler,
  checkout: checkout as unknown as Handler,
  get_orders: getOrders as unknown as Handler,
  get_order_details: getOrderDetails as unknown as Handler,
  track_order: trackOrder as unknown as Handler,
  report_error: reportError as unknown as Handler,
};

function validateArgs(name: string, raw: unknown): Record<string, unknown> {
  const tool = ALL_TOOLS.instamart.find((t) => t.name === name);
  if (!tool) return (raw ?? {}) as Record<string, unknown>;
  const schema = tool.inputSchema as z.ZodTypeAny;
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }
  logger.debug("instamart.args.invalid", {
    tool: name,
    issues: parsed.error.issues,
  });
  return (raw ?? {}) as Record<string, unknown>;
}

export function mountInstamart(
  app: FastifyInstance,
  opts: MountInstamartOpts,
): void {
  app.post(
    "/im",
    { preHandler: opts.authPreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as JsonRpcRequest;
      const id = body.id ?? null;
      const method = body.method ?? "";
      reply.header("Content-Type", "application/json");

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
        const args = validateArgs(name, body.params?.arguments ?? {});
        try {
          const result = await handler(args);
          return {
            jsonrpc: "2.0",
            result: {
              content: [
                { type: "text", text: JSON.stringify(result) },
              ],
              isError: !result.success,
              structuredContent: result,
            },
            id,
          };
        } catch (err) {
          const e = err as Error;
          logger.error("instamart.handler.error", {
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
        result: { tools: [] },
        id,
      };
    },
  );
}
