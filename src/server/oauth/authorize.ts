import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { mutate } from "../store.js";
import { logger } from "../logger.js";

interface AuthorizeQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  auto_approve?: string;
}

interface ApproveBody {
  code_challenge?: string;
  redirect_uri?: string;
  client_id?: string;
  state?: string;
  scope?: string;
}

const CODE_TTL_MS = 120_000;

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConsent(params: Required<Pick<AuthorizeQuery, "client_id" | "redirect_uri" | "state" | "code_challenge">> & { scope: string }): string {
  const { client_id, redirect_uri, state, code_challenge, scope } = params;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Approve access</title></head>
<body style="font-family:system-ui;max-width:480px;margin:48px auto;padding:0 16px;">
<h1>Approve access</h1>
<p>Client <code>${htmlEscape(client_id)}</code> is requesting access.</p>
<p>Scope: <code>${htmlEscape(scope || "(none)")}</code></p>
<form method="POST" action="/auth/approve">
  <input type="hidden" name="client_id" value="${htmlEscape(client_id)}"/>
  <input type="hidden" name="redirect_uri" value="${htmlEscape(redirect_uri)}"/>
  <input type="hidden" name="state" value="${htmlEscape(state)}"/>
  <input type="hidden" name="code_challenge" value="${htmlEscape(code_challenge)}"/>
  <input type="hidden" name="scope" value="${htmlEscape(scope)}"/>
  <button type="submit" style="font-size:16px;padding:8px 16px;">Approve</button>
</form>
</body></html>`;
}

async function issueCode(params: { codeChallenge: string; redirectUri: string; clientId: string }): Promise<string> {
  const code = crypto.randomUUID();
  await mutate((s) => {
    s.auth.pendingCodes[code] = {
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      clientId: params.clientId,
      createdAt: Date.now(),
    };
    // Garbage-collect expired codes opportunistically.
    const now = Date.now();
    for (const [k, v] of Object.entries(s.auth.pendingCodes)) {
      if (now - v.createdAt > CODE_TTL_MS) {
        delete s.auth.pendingCodes[k];
      }
    }
  });
  return code;
}

function buildRedirect(redirectUri: string, code: string, state: string): string {
  const sep = redirectUri.includes("?") ? "&" : "?";
  return `${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}

export interface AuthorizeOptions {
  autoApprove: boolean;
}

export function registerAuthorize(app: FastifyInstance, opts: AuthorizeOptions): void {
  app.get("/auth/authorize", async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as AuthorizeQuery;
    if (q.response_type !== "code") {
      reply.code(400).send({ error: "unsupported_response_type" });
      return;
    }
    if (!q.client_id || !q.redirect_uri || !q.state || !q.code_challenge) {
      reply.code(400).send({ error: "invalid_request", error_description: "Missing required parameter" });
      return;
    }
    if (q.code_challenge_method !== "S256") {
      reply.code(400).send({ error: "invalid_request", error_description: "code_challenge_method must be S256" });
      return;
    }

    if (opts.autoApprove || q.auto_approve === "1") {
      const code = await issueCode({
        codeChallenge: q.code_challenge,
        redirectUri: q.redirect_uri,
        clientId: q.client_id,
      });
      logger.info("oauth.authorize.auto_approve", { client_id: q.client_id });
      reply.redirect(buildRedirect(q.redirect_uri, code, q.state), 302);
      return;
    }

    reply
      .header("Content-Type", "text/html; charset=utf-8")
      .send(renderConsent({
        client_id: q.client_id,
        redirect_uri: q.redirect_uri,
        state: q.state,
        code_challenge: q.code_challenge,
        scope: q.scope ?? "",
      }));
  });

  app.post("/auth/approve", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as ApproveBody;
    if (!body?.client_id || !body?.redirect_uri || !body?.state || !body?.code_challenge) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }
    const code = await issueCode({
      codeChallenge: body.code_challenge,
      redirectUri: body.redirect_uri,
      clientId: body.client_id,
    });
    logger.info("oauth.authorize.approved", { client_id: body.client_id });
    reply.redirect(buildRedirect(body.redirect_uri, code, body.state), 302);
  });
}
