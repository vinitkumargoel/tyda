import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verify } from "./jwt.js";
import { mutate } from "../store.js";
import { logger } from "../logger.js";

interface LogoutBody {
  access_token?: string;
}

export function registerLogout(app: FastifyInstance): void {
  app.post("/auth/logout", async (request: FastifyRequest, reply: FastifyReply) => {
    let token: string | undefined;
    const auth = request.headers["authorization"];
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
      token = auth.slice(7).trim();
    }
    if (!token) {
      const body = (request.body ?? {}) as LogoutBody;
      if (typeof body.access_token === "string") token = body.access_token;
    }
    if (!token) {
      reply.code(400).send({ error: "invalid_request", error_description: "Missing access_token" });
      return;
    }
    try {
      const claims = await verify(token);
      await mutate((s) => {
        if (!s.auth.revokedJtis.includes(claims.jti)) {
          s.auth.revokedJtis.push(claims.jti);
        }
      });
      logger.info("oauth.logout", { sub: claims.sub, jti: claims.jti });
      reply.send({ ok: true });
    } catch (err) {
      logger.debug("oauth.logout.verify_failed", { err: (err as Error).message });
      // Still respond OK to avoid leaking validity, per RFC 7009.
      reply.send({ ok: true });
    }
  });
}
