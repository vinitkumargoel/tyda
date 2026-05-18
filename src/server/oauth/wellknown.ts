import type { FastifyInstance } from "fastify";

export interface WellKnownOptions {
  issuer: string;
}

export function registerWellKnown(app: FastifyInstance, opts: WellKnownOptions): void {
  const { issuer } = opts;

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/auth/authorize`,
    token_endpoint: `${issuer}/auth/token`,
    revocation_endpoint: `${issuer}/auth/logout`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }));

  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: issuer,
    authorization_servers: [issuer],
  }));
}
