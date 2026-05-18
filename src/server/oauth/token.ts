import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { mutate } from "../store.js";
import { sign } from "./jwt.js";
import { logger } from "../logger.js";

interface TokenBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  code_verifier?: string;
}

const CODE_TTL_MS = 120_000;
const EXPIRES_IN_SECONDS = 432_000; // 5 days

function sha256Base64Url(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

function badRequest(reply: FastifyReply, error: string, desc?: string): void {
  reply.code(400).send({ error, ...(desc ? { error_description: desc } : {}) });
}

export function registerToken(app: FastifyInstance): void {
  app.post("/auth/token", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as TokenBody;
    if (body.grant_type !== "authorization_code") {
      badRequest(reply, "unsupported_grant_type", "Only authorization_code is supported");
      return;
    }
    if (!body.code || !body.redirect_uri || !body.client_id || !body.code_verifier) {
      badRequest(reply, "invalid_request", "Missing required parameter");
      return;
    }

    let pending: { codeChallenge: string; redirectUri: string; clientId: string; createdAt: number } | undefined;
    await mutate((s) => {
      pending = s.auth.pendingCodes[body.code!];
      if (pending) {
        // Codes are single-use: remove regardless of outcome below.
        delete s.auth.pendingCodes[body.code!];
      }
    });

    if (!pending) {
      badRequest(reply, "invalid_grant", "Unknown or already-used authorization code");
      return;
    }
    if (Date.now() - pending.createdAt > CODE_TTL_MS) {
      badRequest(reply, "invalid_grant", "Authorization code expired");
      return;
    }
    if (pending.redirectUri !== body.redirect_uri) {
      badRequest(reply, "invalid_grant", "redirect_uri mismatch");
      return;
    }
    if (pending.clientId !== body.client_id) {
      badRequest(reply, "invalid_grant", "client_id mismatch");
      return;
    }
    const expectedChallenge = sha256Base64Url(body.code_verifier);
    if (expectedChallenge !== pending.codeChallenge) {
      badRequest(reply, "invalid_grant", "PKCE verifier mismatch");
      return;
    }

    const accessToken = await sign({
      sub: body.client_id,
      client_id: body.client_id,
    });

    logger.info("oauth.token.issued", { client_id: body.client_id });

    reply.send({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: EXPIRES_IN_SECONDS,
    });
  });
}
