/**
 * Real Zepto OTP login over pure Node HTTP (no browser).
 *
 *   GET  www.zepto.com/auth/create-csrf-token         → XSRF-TOKEN + csrfSecret cookies
 *   POST bff-gateway.zepto.com/api/v1/user/customer/send-otp-sms/   (signed) → SMS
 *   POST <verify endpoint>                             (signed) → { user } + auth cookies
 *
 * On success the whole cookie jar + device/session UUIDs are persisted so later
 * tools can resume the signed session. Signing lives in ./signer; transport +
 * cookie jar in ./http-client.
 */
import { ZeptoHttp, SEND_OTP_URL, ZEPTO_WEB_ORIGIN, ZEPTO_BFF, decodeJwt } from "./http-client.js";
import { getPhone, getOtp, writeStatus } from "./prompt.js";
import { saveSession, summarizeCookies, type ZeptoSession, type ZeptoUser } from "./session.js";

const COUNTRY_CODE = "+91";

// verify-otp host/path is ambiguous from static analysis; try the documented one
// first, then fall back. A 404 means "wrong route, try next"; anything else means
// the route exists (and the OTP was actually checked).
const VERIFY_CANDIDATES = [
  `${ZEPTO_WEB_ORIGIN}/auth/verify-otp`,
  `${ZEPTO_BFF}/api/v1/user/customer/verify-otp`,
  `${ZEPTO_WEB_ORIGIN}/api/auth/verify-otp`,
];

export interface HttpLoginResult {
  ok: boolean;
  user: ZeptoUser | null;
  sessionPath?: string;
  reason?: string;
  verifyUrl?: string;
}

export async function httpLogin(): Promise<HttpLoginResult> {
  const http = new ZeptoHttp();

  writeStatus("bootstrapping_csrf");
  const csrfStatus = await http.bootstrapCsrf();
  if (!http.cookies["XSRF-TOKEN"]) {
    const r = { ok: false as const, user: null, reason: `CSRF bootstrap failed (HTTP ${csrfStatus})` };
    writeStatus("failed", r);
    return r;
  }
  console.log(`  ✓ CSRF bootstrapped (HTTP ${csrfStatus}); device_id=${http.deviceId.slice(0, 8)}…`);

  const phone = await getPhone();
  if (phone.length !== 10) {
    const r = { ok: false as const, user: null, reason: `invalid phone: "${phone}"` };
    writeStatus("failed", r);
    return r;
  }

  writeStatus("sending_otp", { phone });
  const send = await http.signed("POST", SEND_OTP_URL, { mobileNumber: phone, countryCode: COUNTRY_CODE });
  console.log(`  send-otp → HTTP ${send.status} ${truncate(send.text)}`);
  if (send.status !== 200) {
    const r = {
      ok: false as const,
      user: null,
      reason: `send-otp failed (HTTP ${send.status}): ${truncate(send.text)}`,
    };
    writeStatus("failed", r);
    return r;
  }
  writeStatus("otp_sent", { status: send.status });

  const otp = await getOtp();
  if (!otp) {
    const r = { ok: false as const, user: null, reason: "no OTP provided (timeout or empty)" };
    writeStatus("failed", r);
    return r;
  }

  writeStatus("verifying_otp");
  type Verified = { url: string; user: ZeptoUser | null; token?: string; refreshToken?: string };
  let verified: Verified | null = null;
  let lastReason = "";
  for (const url of VERIFY_CANDIDATES) {
    const res = await http.signed("POST", url, {
      mobileNumber: phone,
      countryCode: COUNTRY_CODE,
      otpToken: otp,
    });
    console.log(`  verify-otp @ ${url} → HTTP ${res.status} ${truncate(res.text)}`);
    if (res.status === 404) {
      lastReason = `all verify routes 404 (last ${url})`;
      continue; // wrong route, try next
    }
    const summary = summarizeCookies(http.cookies);
    const j = (res.json ?? {}) as Record<string, unknown>;
    const data = (j.data ?? {}) as Record<string, unknown>;
    const user = (j.user ?? data.user ?? null) as ZeptoUser | null;
    const token = (j.token ?? j.accessToken ?? data.token ?? data.accessToken) as string | undefined;
    const refreshToken = (j.refreshToken ?? j.refresh_token ?? data.refreshToken ?? data.refresh_token) as
      | string
      | undefined;
    if (res.status === 200 && (summary.isAuth || user || token)) {
      verified = { url, user, token, refreshToken };
      break;
    }
    lastReason = `verify-otp rejected (HTTP ${res.status}): ${truncate(res.text)}`;
    break;
  }

  if (!verified) {
    const r = { ok: false as const, user: null, reason: lastReason || "verify-otp failed" };
    writeStatus("failed", r);
    return r;
  }

  const claims = verified.token ? decodeJwt(verified.token) : null;
  const session: ZeptoSession = {
    savedAt: new Date().toISOString(),
    phone,
    user: verified.user,
    deviceId: http.deviceId,
    sessionId: http.sessionId,
    cookies: { ...http.cookies },
    token: verified.token,
    refreshToken: verified.refreshToken,
    tokenIat: typeof claims?.iat === "number" ? claims.iat : undefined,
    tokenExp: typeof claims?.exp === "number" ? claims.exp : undefined,
  };
  const sessionPath = saveSession(session);
  const exp = session.tokenExp ? new Date(session.tokenExp * 1000).toISOString() : "n/a";
  console.log(`  token captured: ${verified.token ? "yes" : "no"}  refresh: ${verified.refreshToken ? "yes" : "no"}  exp: ${exp}`);
  writeStatus("done", { ok: true, sessionPath, verifyUrl: verified.url, hasToken: !!verified.token });
  return { ok: true, user: verified.user, sessionPath, verifyUrl: verified.url };
}

function truncate(s: string, n = 160): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}
