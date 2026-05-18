import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server/http.js";
import { setStateDir } from "../../src/server/store.js";
import { resetKeyCache, sign } from "../../src/server/oauth/jwt.js";

let app: FastifyInstance;
let baseUrl: string;
let bearer: string;

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-conf-"));
}

beforeAll(async () => {
  const dir = await tempDir();
  setStateDir(dir);
  resetKeyCache();
  process.env.OAUTH_ISSUER = "http://127.0.0.1:0";
  app = await buildApp({
    issuer: "http://127.0.0.1:0",
    autoApprove: false,
    heartbeatMs: 200,
  });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = address;
  bearer = await sign({ sub: "test-client", client_id: "test-client" });
});

afterAll(async () => {
  await app.close();
});

describe("streamable-http conformance", () => {
  it("POST /food with proper Accept returns JSON-RPC envelope", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 7 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jsonrpc: string; id: unknown; result: { tools: unknown[] } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(7);
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it("POST /food without Accept returns 406", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Deliberately no Accept header.
        Accept: "text/plain",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(406);
  });

  it("POST /food with disallowed Origin returns 403", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://evil.example.com",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /food with localhost Origin returns 200", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "http://localhost:3000",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 9 }),
    });
    expect(res.status).toBe(200);
  });

  it("echoes Mcp-Session-Id header", async () => {
    const sid = crypto.randomUUID();
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Mcp-Session-Id": sid,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe(sid);
  });

  it("mints Mcp-Session-Id on first POST without one", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("GET /food with text/event-stream returns 200 + heartbeat", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/food`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${bearer}`,
      },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      if (acc.includes(": heartbeat")) break;
    }
    expect(acc).toContain(": heartbeat");
    controller.abort();
  });

  it("POST /food without bearer returns 401", async () => {
    const res = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});

type JsonRpcError = { jsonrpc: string; id: unknown; error: { code: number; message: string; data?: unknown } };

async function post(
  url: string,
  body: unknown,
  auth: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("JSON-RPC error contracts", () => {
  const servers = ["food", "im", "dineout"] as const;

  for (const server of servers) {
    describe(`POST /${server}`, () => {
      it("returns -32602 Invalid params for missing required fields", async () => {
        // Each server has tools that require at least one field. Sending an
        // empty arguments object triggers Zod validation and the -32602 path.
        const toolName =
          server === "food" ? "search_restaurants"
          : server === "im" ? "search_products"
          : "search_restaurants_dineout";
        const { status, body } = await post(
          `${baseUrl}/${server}`,
          {
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: {} },
            id: 1,
          },
          bearer,
        );
        expect(status).toBe(200);
        const rpc = body as JsonRpcError;
        expect(rpc.jsonrpc).toBe("2.0");
        expect(rpc.error).toBeDefined();
        expect(rpc.error.code).toBe(-32602);
        expect(typeof rpc.error.message).toBe("string");
        expect(Array.isArray(rpc.error.data)).toBe(true);
      });

      it("returns -32601 Method not found for unknown JSON-RPC methods", async () => {
        const { status, body } = await post(
          `${baseUrl}/${server}`,
          {
            jsonrpc: "2.0",
            method: "rpc.discover",
            id: 2,
          },
          bearer,
        );
        expect(status).toBe(200);
        const rpc = body as JsonRpcError;
        expect(rpc.jsonrpc).toBe("2.0");
        expect(rpc.error).toBeDefined();
        expect(rpc.error.code).toBe(-32601);
        expect(typeof rpc.error.message).toBe("string");
      });
    });
  }
});
