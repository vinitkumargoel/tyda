/**
 * Token status + refresh.
 *
 * verify-otp returns a JWT bearer (1 h) plus an opaque UUID refreshToken. The
 * bearer-refresh endpoint is NOT present in Zepto's web bundle — it belongs to the
 * native-app auth flow (the web client refreshes its *cookie* session via
 * `auth/refresh-auth`, a different world). We probed the obvious BFF candidates and
 * none route, so for the pure-HTTP bearer the working "refresh" is an OTP re-login.
 *
 * This module exposes the token status and a single `ensureUsableToken()` the rest
 * of the app calls before authenticated requests; if expired it raises a clear
 * "re-login" signal rather than failing deep in a 401. If Zepto's bearer-refresh
 * endpoint is found later, wire it into `tryRefresh()` and callers get it for free.
 */
import type { ZeptoSession } from "./session.js";

export interface TokenStatus {
  hasToken: boolean;
  hasRefreshToken: boolean;
  valid: boolean;
  expiresAt?: string;
  secondsLeft?: number;
}

export function tokenStatus(s: ZeptoSession | null): TokenStatus {
  if (!s?.token) return { hasToken: false, hasRefreshToken: !!s?.refreshToken, valid: false };
  if (!s.tokenExp) return { hasToken: true, hasRefreshToken: !!s.refreshToken, valid: true };
  const secondsLeft = Math.round(s.tokenExp - Date.now() / 1000);
  return {
    hasToken: true,
    hasRefreshToken: !!s.refreshToken,
    valid: secondsLeft > 0,
    expiresAt: new Date(s.tokenExp * 1000).toISOString(),
    secondsLeft,
  };
}

export function humanLeft(secondsLeft?: number): string {
  if (secondsLeft == null) return "unknown";
  if (secondsLeft <= 0) return "expired";
  const m = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export interface RefreshResult {
  ok: boolean;
  session?: ZeptoSession;
  reason?: string;
  needsRelogin?: boolean;
}

/**
 * Attempt to refresh the bearer using the refreshToken. No working endpoint is
 * currently known for the web/BFF bearer (native-app only), so this signals that a
 * re-login is required. Kept as the single seam to upgrade if the endpoint surfaces.
 */
export async function tryRefresh(session: ZeptoSession): Promise<RefreshResult> {
  if (!session.refreshToken) {
    return { ok: false, reason: "no refreshToken in session", needsRelogin: true };
  }
  return {
    ok: false,
    needsRelogin: true,
    reason:
      "Zepto's BFF does not expose a bearer-refresh endpoint (native-app flow only). " +
      "Re-login with OTP: npm run zepto:login",
  };
}
