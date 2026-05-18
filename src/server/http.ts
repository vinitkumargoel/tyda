import * as crypto from "node:crypto";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { registerAuthorize } from "./oauth/authorize.js";
import { registerToken } from "./oauth/token.js";
import { registerLogout } from "./oauth/logout.js";
import { registerWellKnown } from "./oauth/wellknown.js";
import { requireAuth } from "./oauth/jwt.js";
import { logger } from "./logger.js";
import { mountDineout } from "./mcp/dineout.js";
import { mountInstamart } from "./mcp/instamart.js";
import { mountFood } from "./mcp/food.js";

export interface AppOptions {
  issuer: string;
  autoApprove: boolean;
  heartbeatMs?: number;
  originAllowlist?: string[];
}

const MCP_PATHS = ["/food", "/im", "/dineout"] as const;

function isAllowedOrigin(origin: string, extraAllowlist: string[] = []): boolean {
  // Allow localhost / 127.0.0.1 on any port (DNS rebinding defense).
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  const proto = url.protocol;
  if ((proto === "http:" || proto === "https:") && (host === "127.0.0.1" || host === "localhost" || host === "[::1]")) {
    return true;
  }
  return extraAllowlist.includes(origin);
}

interface ParsedFormBody {
  [k: string]: string | undefined;
}

function parseUrlEncoded(body: string): ParsedFormBody {
  const out: ParsedFormBody = {};
  const params = new URLSearchParams(body);
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const allowlist = opts.originAllowlist ?? [];

  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  // Manual content-type parsers (avoid extra deps).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        if (!body || (typeof body === "string" && body.length === 0)) {
          done(null, {});
          return;
        }
        const text = typeof body === "string" ? body : body.toString("utf8");
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const text = typeof body === "string" ? body : body.toString("utf8");
        done(null, parseUrlEncoded(text));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // Origin/DNS-rebinding guard applied globally to MCP paths.
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!MCP_PATHS.includes(url as (typeof MCP_PATHS)[number])) return;
    const origin = request.headers["origin"];
    if (typeof origin === "string" && origin.length > 0) {
      if (!isAllowedOrigin(origin, allowlist)) {
        reply.code(403).send({ error: "forbidden_origin" });
        return;
      }
    }
    // Streamable HTTP Accept conformance.
    const accept = (request.headers["accept"] as string | undefined) ?? "";
    if (request.method === "POST") {
      if (!accept.includes("application/json")) {
        reply.code(406).send({ error: "not_acceptable", error_description: "Accept must include application/json" });
        return;
      }
    } else if (request.method === "GET") {
      if (!accept.includes("text/event-stream")) {
        reply.code(406).send({ error: "not_acceptable", error_description: "Accept must include text/event-stream" });
        return;
      }
    }

    // Session ID echo / mint.
    const incoming = request.headers["mcp-session-id"];
    let sessionId: string;
    if (typeof incoming === "string" && incoming.length > 0) {
      sessionId = incoming;
    } else if (request.method === "POST") {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = "";
    }
    if (sessionId) {
      reply.header("Mcp-Session-Id", sessionId);
    }
  });

  app.get("/healthz", async () => ({ ok: true }));

  // OAuth + well-known.
  registerWellKnown(app, { issuer: opts.issuer });
  registerAuthorize(app, { autoApprove: opts.autoApprove });
  registerToken(app);
  registerLogout(app);

  // Real Dineout MCP server (Wave 2, Track H). Replaces the POST /dineout placeholder.
  mountDineout(app, { authPreHandler: requireAuth });

  // Real Instamart MCP server (Wave 2, Track G). Replaces the POST /im placeholder.
  mountInstamart(app, { authPreHandler: requireAuth });

  // Real Food MCP server (Wave 2, Track F). Replaces the POST /food placeholder.
  mountFood(app, { authPreHandler: requireAuth });

  // MCP placeholder routes — POST: returns empty tools/list. GET: SSE heartbeat.
  for (const p of MCP_PATHS) {
    if (p !== "/dineout" && p !== "/im" && p !== "/food") {
      app.post(p, { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { id?: number | string | null; method?: string; jsonrpc?: string };
        reply.header("Content-Type", "application/json");
        return {
          jsonrpc: "2.0",
          result: { tools: [] },
          id: body.id ?? null,
        };
      });
    }

    app.get(p, { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      reply.raw.write(": heartbeat\n\n");
      const interval = setInterval(() => {
        try {
          reply.raw.write(": heartbeat\n\n");
        } catch {
          clearInterval(interval);
        }
      }, heartbeatMs);
      const close = (): void => {
        clearInterval(interval);
        try {
          reply.raw.end();
        } catch {
          // ignore
        }
      };
      request.raw.on("close", close);
      request.raw.on("end", close);
      // Hold the reply open.
      return reply;
    });
  }

  app.setErrorHandler((err: unknown, _request, reply) => {
    const e = err as { message?: string; stack?: string; statusCode?: number };
    logger.error("http.error", { err: e.message ?? "unknown", stack: e.stack });
    if (!reply.sent) {
      reply.code(e.statusCode ?? 500).send({ error: "server_error", error_description: e.message ?? "unknown" });
    }
  });

  return app;
}
