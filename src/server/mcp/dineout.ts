import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { ALL_TOOLS, type ToolDef } from "../../shared/tool-index.js";
import { zodToOpenAI } from "../../shared/zod-to-openai.js";
import { logger } from "../logger.js";
import { getSavedLocations } from "../handlers/dineout/get_saved_locations.js";
import { searchRestaurantsDineout } from "../handlers/dineout/search_restaurants_dineout.js";
import { getRestaurantDetails } from "../handlers/dineout/get_restaurant_details.js";
import { getAvailableSlots } from "../handlers/dineout/get_available_slots.js";
import { createCart } from "../handlers/dineout/create_cart.js";
import { bookTable } from "../handlers/dineout/book_table.js";
import { getBookingStatus } from "../handlers/dineout/get_booking_status.js";
import { reportError } from "../handlers/dineout/report_error.js";

export interface MountDineoutOptions {
  authPreHandler: preHandlerHookHandler;
}

type ToolResult = { success: true; data: unknown; message?: string } | {
  success: false;
  error: { code?: string; message: string };
};

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
  return ALL_TOOLS.dineout.map((t: ToolDef) => {
    const oai = zodToOpenAI(t.inputSchema, t.name, t.description);
    return {
      name: t.name,
      description: t.description,
      inputSchema: oai.function.parameters,
    };
  });
}

const HANDLERS: Record<string, Handler> = {
  get_saved_locations: getSavedLocations as unknown as Handler,
  search_restaurants_dineout: searchRestaurantsDineout as unknown as Handler,
  get_restaurant_details: getRestaurantDetails as unknown as Handler,
  get_available_slots: getAvailableSlots as unknown as Handler,
  create_cart: createCart as unknown as Handler,
  book_table: bookTable as unknown as Handler,
  get_booking_status: getBookingStatus as unknown as Handler,
  report_error: reportError as unknown as Handler,
};

function validateArgs(name: string, raw: unknown): Record<string, unknown> {
  const tool = ALL_TOOLS.dineout.find((t) => t.name === name);
  if (!tool) return (raw ?? {}) as Record<string, unknown>;
  const schema = tool.inputSchema as z.ZodTypeAny;
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }
  // Fall back to the raw object; handlers do their own validation. We log so
  // strict schema regressions show up.
  logger.debug("dineout.args.invalid", {
    tool: name,
    issues: parsed.error.issues,
  });
  return (raw ?? {}) as Record<string, unknown>;
}

export function mountDineout(
  app: FastifyInstance,
  opts: MountDineoutOptions,
): void {
  app.post(
    "/dineout",
    { preHandler: opts.authPreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as JsonRpcRequest;
      const id = body.id ?? null;
      const method = body.method ?? "";
      reply.header("Content-Type", "application/json");

      if (method === "initialize") {
        const clientVersion =
          (body.params as Record<string, unknown> | undefined)?.protocolVersion ?? "2024-11-05";
        return {
          jsonrpc: "2.0",
          result: {
            protocolVersion: clientVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "tyda-dineout", version: "0.1.0" },
          },
          id,
        };
      }

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
          logger.error("dineout.handler.error", {
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

      // Unsupported method — be lenient and return empty tools/list as a default
      // to match the prior placeholder behavior.
      return {
        jsonrpc: "2.0",
        result: { tools: [] },
        id,
      };
    },
  );

  // The streamable-HTTP SSE GET is shared with the placeholder loop in http.ts.
  // We only own POST /dineout here.
}
