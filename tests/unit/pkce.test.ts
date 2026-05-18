import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { runPkceFlow } from "../../src/tui/oauth-flow.js";

interface OAuthServerHandle {
  server: Server;
  port: number;
  issuer: string;
  seenVerifier: string | null;
  seenChallenge: string | null;
  exchangeStatus: number;
  /** Toggle to make the well-known endpoint 404. */
  serveDiscovery: boolean;
  close(): Promise<void>;
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

async function startOAuthServer(): Promise<OAuthServerHandle> {
  const FIXED_CODE = "test-fixed-code";
  const codeToChallenge = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();

  const handle: OAuthServerHandle = {
    server: null as unknown as Server,
    port: 0,
    issuer: "",
    seenVerifier: null,
    seenChallenge: null,
    exchangeStatus: 200,
    serveDiscovery: true,
    async close() {
      await new Promise<void>((res) => handle.server.close(() => res()));
    },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("bad");
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${handle.port}`);

    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      if (!handle.serveDiscovery) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer: handle.issuer,
          authorization_endpoint: `${handle.issuer}/auth/authorize`,
          token_endpoint: `${handle.issuer}/auth/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const challenge = url.searchParams.get("code_challenge");
      const clientId = url.searchParams.get("client_id");
      if (!redirectUri || !state || !challenge || !clientId) {
        res.statusCode = 400;
        res.end("missing params");
        return;
      }
      handle.seenChallenge = challenge;
      codeToChallenge.set(FIXED_CODE, { challenge, redirectUri, clientId });
      // Issue a 302 to the redirect URI with the fixed code.
      const sep = redirectUri.includes("?") ? "&" : "?";
      const location = `${redirectUri}${sep}code=${encodeURIComponent(FIXED_CODE)}&state=${encodeURIComponent(state)}`;
      res.statusCode = 302;
      res.setHeader("Location", location);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/token") {
      const text = await readBody(req);
      const params = new URLSearchParams(text);
      const grant = params.get("grant_type");
      const code = params.get("code");
      const verifier = params.get("code_verifier");
      const clientId = params.get("client_id");
      const redirectUri = params.get("redirect_uri");
      if (grant !== "authorization_code" || !code || !verifier || !clientId || !redirectUri) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }
      const pending = codeToChallenge.get(code);
      if (!pending) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const expected = sha256Base64Url(verifier);
      if (expected !== pending.challenge) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "pkce mismatch" }));
        return;
      }
      handle.seenVerifier = verifier;
      res.statusCode = handle.exchangeStatus;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "test-access-token",
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

describe("runPkceFlow", () => {
  let oauth: OAuthServerHandle;

  beforeEach(async () => {
    oauth = await startOAuthServer();
  });
  afterEach(async () => {
    await oauth.close();
  });

  it("completes the PKCE flow end to end (discovery path)", async () => {
    const result = await runPkceFlow({
      issuer: oauth.issuer,
      openBrowser: (url) => {
        // Simulate the browser hitting the authorize URL and following the
        // 302 to the loopback callback.
        void fetch(url, { redirect: "follow" });
      },
      timeoutMs: 5_000,
    });
    expect(result.accessToken).toBe("test-access-token");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(oauth.seenVerifier).toBeTruthy();
    expect(oauth.seenChallenge).toBe(sha256Base64Url(oauth.seenVerifier!));
  });

  it("falls back to /auth/* when discovery is 404", async () => {
    oauth.serveDiscovery = false;
    const result = await runPkceFlow({
      issuer: oauth.issuer,
      openBrowser: (url) => {
        void fetch(url, { redirect: "follow" });
      },
      timeoutMs: 5_000,
    });
    expect(result.accessToken).toBe("test-access-token");
  });
});
