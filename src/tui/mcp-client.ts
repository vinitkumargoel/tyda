import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Config } from "./config.js";
import type { McpDispatcher, ServerName } from "./slash/types.js";
import { clearToken, loadToken, saveToken, type StoredToken } from "./token-store.js";
import { runPkceFlow } from "./oauth-flow.js";

export interface DispatcherOpts {
  config: Config;
  stateDir: string;
  /** For tests / non-interactive uses. */
  openBrowser?: (url: string) => void;
  /**
   * Override transport factory for tests. The default constructs a real
   * StreamableHTTPClientTransport with a fetch wrapper that injects the
   * `Authorization` header and `Origin: http://127.0.0.1`.
   */
  transportFactory?: (server: ServerName, getToken: () => string | null) => {
    callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
    close: () => Promise<void>;
  };
}

function pathFor(server: ServerName): string {
  switch (server) {
    case "food":
      return "food";
    case "im":
      return "im";
    case "dineout":
      return "dineout";
  }
}

/** Status-bearing error so the dispatcher can detect 401s from any layer. */
class AuthRequiredError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (e.status === 401 || e.code === 401) return true;
  if (typeof e.message === "string" && /\b401\b|unauthor/i.test(e.message)) return true;
  return false;
}

interface ConnectedClient {
  client: Client;
  close: () => Promise<void>;
}

/**
 * Build a real Streamable HTTP transport whose fetch injects the bearer token
 * (looked up at request time so token rotation works) plus an Origin header.
 */
type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

function buildRealTransport(
  baseUrl: string,
  getToken: () => string | null,
): StreamableHTTPClientTransport {
  const fetchWithAuth: FetchLike = async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    const token = getToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (!headers.has("Origin")) {
      headers.set("Origin", "http://127.0.0.1");
    }
    const res = await fetch(input as URL | string, { ...init, headers });
    if (res.status === 401) {
      // Surface as an AuthRequiredError up through the SDK so the dispatcher
      // can trigger re-auth.
      throw new AuthRequiredError();
    }
    return res;
  };
  return new StreamableHTTPClientTransport(new URL(baseUrl), {
    fetch: fetchWithAuth,
  });
}

class DispatcherImpl implements McpDispatcher {
  private readonly config: Config;
  private readonly stateDir: string;
  private readonly openBrowser?: (url: string) => void;
  private readonly transportFactory?: DispatcherOpts["transportFactory"];

  private cachedToken: StoredToken | null = null;
  private clients = new Map<ServerName, ConnectedClient | undefined>();
  private pendingAuth: Promise<void> | null = null;

  constructor(opts: DispatcherOpts) {
    this.config = opts.config;
    this.stateDir = opts.stateDir;
    if (opts.openBrowser) this.openBrowser = opts.openBrowser;
    if (opts.transportFactory) this.transportFactory = opts.transportFactory;
  }

  private currentToken(): string | null {
    return this.cachedToken?.accessToken ?? null;
  }

  async ensureAuth(): Promise<void> {
    if (this.pendingAuth) {
      await this.pendingAuth;
      return;
    }
    this.pendingAuth = (async () => {
      try {
        if (!this.cachedToken) {
          this.cachedToken = await loadToken(this.stateDir);
        }
        const now = Date.now();
        if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
          return;
        }
        // Need a fresh token.
        const issuer = this.config.swiggy.remote.replace(/\/+$/, "");
        const opts: Parameters<typeof runPkceFlow>[0] = { issuer };
        if (this.openBrowser) opts.openBrowser = this.openBrowser;
        const fresh = await runPkceFlow(opts);
        const stored: StoredToken = {
          accessToken: fresh.accessToken,
          expiresAt: fresh.expiresAt,
          issuer,
        };
        await saveToken(this.stateDir, stored);
        this.cachedToken = stored;
      } finally {
        this.pendingAuth = null;
      }
    })();
    await this.pendingAuth;
  }

  private async getOrConnect(server: ServerName): Promise<{
    callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  }> {
    if (this.transportFactory) {
      // Tests path: build a synthetic transport per call (cheap).
      return this.transportFactory(server, () => this.currentToken());
    }
    const cached = this.clients.get(server);
    if (cached) return { callTool: (p) => cached.client.callTool(p) };

    const baseUrl = `${this.config.swiggy.remote.replace(/\/+$/, "")}/${pathFor(server)}`;
    const transport = buildRealTransport(baseUrl, () => this.currentToken());
    const client = new Client({ name: "tyda-tui", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    const entry: ConnectedClient = {
      client,
      close: async () => {
        try {
          await client.close();
        } catch {
          /* ignore */
        }
      },
    };
    this.clients.set(server, entry);
    return { callTool: (p) => client.callTool(p) };
  }

  private async dropClient(server: ServerName): Promise<void> {
    const entry = this.clients.get(server);
    this.clients.delete(server);
    if (entry) await entry.close();
  }

  async call(server: ServerName, tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.cachedToken) {
      await this.ensureAuth();
    }
    const conn = await this.getOrConnect(server);
    try {
      return await conn.callTool({ name: tool, arguments: args });
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      // Clear token + connection and re-auth, then retry once.
      this.cachedToken = null;
      await clearToken(this.stateDir);
      await this.dropClient(server);
      await this.ensureAuth();
      const conn2 = await this.getOrConnect(server);
      return conn2.callTool({ name: tool, arguments: args });
    }
  }

  async close(): Promise<void> {
    const all = Array.from(this.clients.values()).filter((c): c is ConnectedClient => Boolean(c));
    this.clients.clear();
    await Promise.all(all.map((c) => c.close()));
  }
}

export function createDispatcher(opts: DispatcherOpts): McpDispatcher {
  return new DispatcherImpl(opts);
}

export { AuthRequiredError };
