import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { decodeProtectedHeader, decodeJwt } from "jose";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server/http.js";
import { setStateDir } from "../../src/server/store.js";
import { resetKeyCache } from "../../src/server/oauth/jwt.js";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tyda-pkce-"));
  setStateDir(dir);
  resetKeyCache();
  process.env.OAUTH_ISSUER = "http://127.0.0.1:0";
  app = await buildApp({
    issuer: "http://127.0.0.1:0",
    autoApprove: false,
    heartbeatMs: 200,
  });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
});

function genPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function obtainCode(redirectUri: string, challenge: string, clientId: string, state: string): Promise<string> {
  // POST /auth/approve as the consent form would.
  const body = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    scope: "mcp:tools",
  });
  const res = await fetch(`${baseUrl}/auth/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const loc = res.headers.get("location");
  expect(loc).toBeTruthy();
  const url = new URL(loc!, baseUrl);
  const code = url.searchParams.get("code");
  expect(code).toBeTruthy();
  expect(url.searchParams.get("state")).toBe(state);
  return code!;
}

describe("oauth pkce", () => {
  it("GET /auth/authorize renders consent HTML when not auto-approved", async () => {
    const { challenge } = genPkce();
    const qs = new URLSearchParams({
      response_type: "code",
      client_id: "cli1",
      redirect_uri: "http://localhost:3000/cb",
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const res = await fetch(`${baseUrl}/auth/authorize?${qs.toString()}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Approve");
  });

  it("auto_approve=1 redirects with code immediately", async () => {
    const { challenge } = genPkce();
    const qs = new URLSearchParams({
      response_type: "code",
      client_id: "cli1",
      redirect_uri: "http://localhost:3000/cb",
      state: "s2",
      code_challenge: challenge,
      code_challenge_method: "S256",
      auto_approve: "1",
    });
    const res = await fetch(`${baseUrl}/auth/authorize?${qs.toString()}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toContain("code=");
    expect(loc).toContain("state=s2");
  });

  it("token exchange with matching verifier succeeds", async () => {
    const { verifier, challenge } = genPkce();
    const redirectUri = "http://localhost:3000/cb";
    const clientId = "cli2";
    const code = await obtainCode(redirectUri, challenge, clientId, "abc");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const res = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.access_token).toBe("string");
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(432_000);
    expect(body.refresh_token).toBeUndefined();

    const header = decodeProtectedHeader(body.access_token as string);
    expect(header.alg).toBe("RS256");
    const claims = decodeJwt(body.access_token as string);
    expect(claims.sub).toBe(clientId);
    expect(typeof claims.jti).toBe("string");
  });

  it("token exchange with wrong verifier returns 400 invalid_grant", async () => {
    const { challenge } = genPkce();
    const redirectUri = "http://localhost:3000/cb";
    const clientId = "cli3";
    const code = await obtainCode(redirectUri, challenge, clientId, "s3");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: "definitely-wrong-verifier",
    });
    const res = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });

  it("code is single-use", async () => {
    const { verifier, challenge } = genPkce();
    const redirectUri = "http://localhost:3000/cb";
    const clientId = "cli4";
    const code = await obtainCode(redirectUri, challenge, clientId, "s4");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const ok = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(ok.status).toBe(200);

    const replay = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    expect(replay.status).toBe(400);
  });

  it("bearer-protected route enforces auth and respects logout", async () => {
    const { verifier, challenge } = genPkce();
    const redirectUri = "http://localhost:3000/cb";
    const clientId = "cli5";
    const code = await obtainCode(redirectUri, challenge, clientId, "s5");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const tokRes = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    const tok = (await tokRes.json()) as { access_token: string };

    // Unauthorized: 401
    const noAuth = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(noAuth.status).toBe(401);

    // Authorized: 200
    const ok = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${tok.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(ok.status).toBe(200);

    // Logout.
    const lo = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: tok.access_token }),
    });
    expect(lo.status).toBe(200);

    // After logout: 401
    const post = await fetch(`${baseUrl}/food`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${tok.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(post.status).toBe(401);
  });

  it("well-known endpoints expose RFC 8414 + RFC 9728 metadata", async () => {
    const a = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(a.status).toBe(200);
    const aj = (await a.json()) as Record<string, unknown>;
    expect(aj.code_challenge_methods_supported).toEqual(["S256"]);
    expect(aj.grant_types_supported).toEqual(["authorization_code"]);
    expect(aj.token_endpoint_auth_methods_supported).toEqual(["none"]);

    const r = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(r.status).toBe(200);
    const rj = (await r.json()) as Record<string, unknown>;
    expect(rj.resource).toBeTruthy();
    expect(Array.isArray(rj.authorization_servers)).toBe(true);
  });
});
