import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { createDispatcher } from "../../src/tui/mcp-client.js";
import type { Config } from "../../src/tui/config.js";
import { saveToken, loadToken, type StoredToken } from "../../src/tui/token-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-disp-"));
}

function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

interface OAuthHandle {
  server: Server;
  issuer: string;
  port: number;
  issuedAccessTokens: string[];
  close(): Promise<void>;
}

async function startStubOAuth(accessTokenToIssue: string): Promise<OAuthHandle> {
  const codeToChallenge = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  const FIXED_CODE = "stub-code";
  const handle: OAuthHandle = {
    server: null as unknown as Server,
    issuer: "",
    port: 0,
    issuedAccessTokens: [],
    async close() {
      await new Promise<void>((res) => handle.server.close(() => res()));
    },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${handle.port}`);
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer: handle.issuer,
          authorization_endpoint: `${handle.issuer}/auth/authorize`,
          token_endpoint: `${handle.issuer}/auth/token`,
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const state = url.searchParams.get("state")!;
      const challenge = url.searchParams.get("code_challenge")!;
      const clientId = url.searchParams.get("client_id")!;
      codeToChallenge.set(FIXED_CODE, { challenge, redirectUri, clientId });
      const sep = redirectUri.includes("?") ? "&" : "?";
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `${redirectUri}${sep}code=${encodeURIComponent(FIXED_CODE)}&state=${encodeURIComponent(state)}`,
      );
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/token") {
      const text = await readBody(req);
      const params = new URLSearchParams(text);
      const code = params.get("code") ?? "";
      const verifier = params.get("code_verifier") ?? "";
      const pending = codeToChallenge.get(code);
      if (!pending || sha256Base64Url(verifier) !== pending.challenge) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      codeToChallenge.delete(code);
      handle.issuedAccessTokens.push(accessTokenToIssue);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: accessTokenToIssue,
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  handle.server = server;
  handle.port = addr.port;
  handle.issuer = `http://127.0.0.1:${addr.port}`;
  return handle;
}

class AuthErr extends Error {
  status = 401;
  constructor() {
    super("Unauthorized");
  }
}

const FAR_FUTURE = Date.now() + 24 * 3600 * 1000;

function makeConfig(remote: string): Config {
  return { swiggy: { remote, demoSpeed: "fast" } };
}

describe("dispatcher", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await tempDir();
  });

  it("calls the tool when token is fresh", async () => {
    const initial: StoredToken = {
      accessToken: "good",
      expiresAt: FAR_FUTURE,
      issuer: "http://127.0.0.1:9999",
    };
    await saveToken(stateDir, initial);

    const calls: { server: string; tool: string; token: string | null }[] = [];
    const dispatcher = createDispatcher({
      config: makeConfig("http://127.0.0.1:9999"),
      stateDir,
      transportFactory: (server, getToken) => ({
        callTool: async ({ name }) => {
          calls.push({ server, tool: name, token: getToken() });
          return { content: [{ type: "text", text: "ok" }] };
        },
        close: async () => {},
      }),
    });

    const result = (await dispatcher.call("food", "ping", {})) as { content: unknown };
    expect(result.content).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.server).toBe("food");
    expect(calls[0]!.token).toBe("good");
  });

  it("uses the cached token across multiple call()s without re-running PKCE", async () => {
    const initial: StoredToken = {
      accessToken: "token-A",
      expiresAt: FAR_FUTURE,
      issuer: "http://127.0.0.1:9999",
    };
    await saveToken(stateDir, initial);

    const tokens: (string | null)[] = [];
    let pkceCalls = 0;
    const dispatcher = createDispatcher({
      config: makeConfig("http://127.0.0.1:9999"),
      stateDir,
      openBrowser: () => {
        pkceCalls += 1;
      },
      transportFactory: (_server, getToken) => ({
        callTool: async () => {
          tokens.push(getToken());
          return { content: [] };
        },
        close: async () => {},
      }),
    });

    await dispatcher.call("food", "a", {});
    await dispatcher.call("im", "b", {});
    await dispatcher.call("dineout", "c", {});
    expect(tokens).toEqual(["token-A", "token-A", "token-A"]);
    expect(pkceCalls).toBe(0);
  });
});

describe("dispatcher re-auth on 401", () => {
  let stateDir: string;
  let oauth: OAuthHandle;

  beforeEach(async () => {
    stateDir = await tempDir();
    oauth = await startStubOAuth("fresh-token-from-pkce");
  });
  afterEach(async () => {
    await oauth.close();
  });

  it("clears the stale token and re-runs PKCE on 401, retrying once", async () => {
    // Seed disk with an "old" token that the server will reject.
    const stale: StoredToken = {
      accessToken: "stale",
      expiresAt: FAR_FUTURE, // not expired by clock — only the server rejects it
      issuer: oauth.issuer,
    };
    await saveToken(stateDir, stale);

    let attempt = 0;
    const tokensSeen: (string | null)[] = [];

    const dispatcher = createDispatcher({
      config: makeConfig(oauth.issuer),
      stateDir,
      openBrowser: (url) => {
        // Simulate the user's browser hitting the authorize endpoint and
        // following the redirect to the loopback callback.
        void fetch(url, { redirect: "follow" });
      },
      transportFactory: (_server, getToken) => ({
        callTool: async () => {
          attempt += 1;
          const token = getToken();
          tokensSeen.push(token);
          if (attempt === 1) {
            throw new AuthErr();
          }
          return { content: [{ type: "text", text: "ok-after-retry" }] };
        },
        close: async () => {},
      }),
    });

    const result = (await dispatcher.call("food", "ping", {})) as { content: unknown };
    expect(result).toBeDefined();
    expect(attempt).toBe(2);
    expect(tokensSeen[0]).toBe("stale");
    expect(tokensSeen[1]).toBe("fresh-token-from-pkce");
    // Disk now holds the fresh token.
    const final = await loadToken(stateDir);
    expect(final?.accessToken).toBe("fresh-token-from-pkce");
  });
});
