import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getStateDir, mutate } from "../store.js";
import { logger } from "../logger.js";

const ALG = "RS256";

interface KeyMaterial {
  privateKey: KeyLike;
  publicKey: KeyLike;
}

let cached: KeyMaterial | null = null;

function keyFiles(): { privatePath: string; publicPath: string } {
  const dir = getStateDir();
  return {
    privatePath: path.join(dir, "oauth-private.pem"),
    publicPath: path.join(dir, "oauth-public.pem"),
  };
}

export async function getKeys(): Promise<KeyMaterial> {
  if (cached) return cached;
  const { privatePath, publicPath } = keyFiles();
  try {
    const [priv, pub] = await Promise.all([
      fs.readFile(privatePath, "utf8"),
      fs.readFile(publicPath, "utf8"),
    ]);
    const privateKey = (await importPKCS8(priv, ALG)) as KeyLike;
    const publicKey = (await importSPKI(pub, ALG)) as KeyLike;
    cached = { privateKey, publicKey };
    return cached;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
    const { privateKey, publicKey } = await generateKeyPair(ALG, { modulusLength: 2048 });
    const privPem = await exportPKCS8(privateKey as KeyLike);
    const pubPem = await exportSPKI(publicKey as KeyLike);
    await fs.mkdir(path.dirname(privatePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(privatePath, privPem, { mode: 0o600 });
    await fs.writeFile(publicPath, pubPem, { mode: 0o600 });
    logger.info("oauth.keys.generated", { dir: path.dirname(privatePath) });
    cached = { privateKey: privateKey as KeyLike, publicKey: publicKey as KeyLike };
    return cached;
  }
}

export function resetKeyCache(): void {
  cached = null;
}

export interface TokenClaims extends JWTPayload {
  sub: string;
  client_id: string;
  scope?: string;
  jti: string;
}

export interface SignInput {
  sub: string;
  client_id: string;
  scope?: string;
  jti?: string;
}

export async function sign(payload: SignInput): Promise<string> {
  const { privateKey } = await getKeys();
  const jti = payload.jti ?? crypto.randomUUID();
  const issuer = process.env.OAUTH_ISSUER ?? "http://127.0.0.1:8787";
  const jwt = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setSubject(payload.sub)
    .setExpirationTime("5d")
    .setJti(jti)
    .sign(privateKey);
  return jwt;
}

export async function verify(token: string): Promise<TokenClaims> {
  const { publicKey } = await getKeys();
  const issuer = process.env.OAUTH_ISSUER ?? "http://127.0.0.1:8787";
  const { payload } = await jwtVerify(token, publicKey, { issuer, algorithms: [ALG] });
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw new Error("invalid_claims");
  }
  const clientId = typeof payload["client_id"] === "string" ? (payload["client_id"] as string) : "";
  return {
    ...payload,
    sub: payload.sub,
    jti: payload.jti,
    client_id: clientId,
  };
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: TokenClaims;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
    reply.code(401).send({ error: "invalid_token", error_description: "Missing bearer token" });
    return;
  }
  const token = header.slice(7).trim();
  try {
    const claims = await verify(token);
    // Check revocation list.
    const revoked = await isRevoked(claims.jti);
    if (revoked) {
      reply.code(401).send({ error: "invalid_token", error_description: "Token revoked" });
      return;
    }
    request.auth = claims;
  } catch (err) {
    logger.debug("auth.verify.failed", { err: (err as Error).message });
    reply.code(401).send({ error: "invalid_token", error_description: "Token verification failed" });
  }
}

async function isRevoked(jti: string): Promise<boolean> {
  let revoked = false;
  await mutate((s) => {
    revoked = s.auth.revokedJtis.includes(jti);
  });
  return revoked;
}
