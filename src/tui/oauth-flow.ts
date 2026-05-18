import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";

export interface RunPkceFlowOpts {
  issuer: string;
  clientId?: string;
  /** For tests: invoked with the full authorize URL instead of opening a browser. */
  openBrowser?: (url: string) => void;
  /**
   * Called with the authorize URL whether or not browser launch succeeds.
   * Use this to display the URL in the TUI so the user can paste it manually
   * on headless/SSH systems where the browser cannot open.
   */
  onAuthorizeUrl?: (url: string) => void;
  /** For tests: timeout for the callback listener (default 5 minutes). */
  timeoutMs?: number;
}

export interface PkceResult {
  accessToken: string;
  expiresAt: number;
}

interface DiscoveryDoc {
  authorization_endpoint?: string;
  token_endpoint?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function randomBase64UrlBytes(n: number): string {
  return base64url(randomBytes(n));
}

function sha256Base64Url(input: string): string {
  return base64url(createHash("sha256").update(input).digest());
}

function defaultOpenBrowser(url: string): boolean {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    let failed = false;
    child.on("error", () => { failed = true; });
    child.unref();
    return !failed;
  } catch {
    return false;
  }
}

async function fetchDiscovery(issuer: string): Promise<DiscoveryDoc | null> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (typeof json !== "object" || json === null) return null;
    return json as DiscoveryDoc;
  } catch {
    return null;
  }
}

interface CallbackResult {
  code: string;
  state: string;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export async function runPkceFlow(opts: RunPkceFlowOpts): Promise<PkceResult> {
  const issuer = opts.issuer.replace(/\/+$/, "");
  const clientId = opts.clientId ?? "tyda-tui";
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  const onAuthorizeUrl = opts.onAuthorizeUrl;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  const discovery = await fetchDiscovery(issuer);
  const authorizationEndpoint = discovery?.authorization_endpoint ?? `${issuer}/auth/authorize`;
  const tokenEndpoint = discovery?.token_endpoint ?? `${issuer}/auth/token`;

  const codeVerifier = randomBase64UrlBytes(32);
  const codeChallenge = sha256Base64Url(codeVerifier);
  const state = randomBase64UrlBytes(16);

  // Start the loopback listener first so we know the port.
  const server = createServer();
  let port = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("Failed to bind loopback port"));
        return;
      }
      port = addr.port;
      resolve();
    });
  });

  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Replace the server handler now that we know we need it.
  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("OAuth callback timed out"));
    }, timeoutMs);

    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`);
        clearTimeout(timer);
        reject(new Error(`Authorization error: ${error}`));
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (!code || !returnedState) {
        res.statusCode = 400;
        res.end("missing code or state");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><body style="font-family:system-ui;text-align:center;margin-top:64px;">` +
          `<h1>Authenticated</h1><p>You can close this tab and return to your terminal.</p>` +
          `</body></html>`,
      );
      clearTimeout(timer);
      resolve({ code, state: returnedState });
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Build authorize URL and open the browser.
  const authorizeUrl = new URL(authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "mcp:tools");

  const urlStr = authorizeUrl.toString();
  onAuthorizeUrl?.(urlStr);
  // Always write the URL to stderr before launching the browser. This covers
  // headless/SSH environments and the case where the default browser opener
  // fails asynchronously (spawn errors arrive via the child `error` event,
  // after the synchronous return, so we cannot reliably detect them).
  process.stderr.write(
    `\nOpen this URL in your browser to complete login:\n  ${urlStr}\n\n`,
  );
  try { openBrowser(urlStr); } catch { /* ignore — URL already visible */ }

  let callback: CallbackResult;
  try {
    callback = await callbackPromise;
  } finally {
    server.close();
  }

  if (callback.state !== state) {
    throw new Error("OAuth state mismatch — possible CSRF, aborting.");
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: callback.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token endpoint returned ${tokenRes.status}: ${text}`);
  }

  const tokenJson = (await tokenRes.json()) as TokenResponse;
  if (!tokenJson.access_token || typeof tokenJson.access_token !== "string") {
    throw new Error("Token endpoint did not return an access_token");
  }
  const expiresIn = typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : 3600;
  return {
    accessToken: tokenJson.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

