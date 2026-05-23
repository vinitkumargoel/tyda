/**
 * Granular OTP login building blocks for interactive callers (the TUI).
 *
 * The CLI's http-login.ts runs the whole flow with prompts; a UI needs the two
 * halves separately so it can send the OTP, let the user type the code, then
 * verify — while keeping the SAME ZeptoHttp instance alive in between (it holds
 * the CSRF cookies + device/session ids that the verify signature depends on).
 */
import { ZeptoHttp, SEND_OTP_URL, ZEPTO_BFF, decodeJwt } from "./http-client.js";
import { saveSession, type ZeptoSession, type ZeptoUser } from "./session.js";

const COUNTRY_CODE = "+91";
const VERIFY_URL = `${ZEPTO_BFF}/api/v1/user/customer/verify-otp`;

export interface SendOtpResult {
  http?: ZeptoHttp;
  ok: boolean;
  reason?: string;
}

/** Bootstrap CSRF + request an OTP SMS. Returns the live client to pass to verifyOtp. */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return { ok: false, reason: `invalid phone: "${phone}"` };
  const http = new ZeptoHttp();
  const csrf = await http.bootstrapCsrf();
  if (!http.cookies["XSRF-TOKEN"]) return { ok: false, reason: `CSRF bootstrap failed (HTTP ${csrf})` };
  const res = await http.signed("POST", SEND_OTP_URL, { mobileNumber: digits, countryCode: COUNTRY_CODE });
  if (res.status !== 200) return { ok: false, reason: `send-otp failed (HTTP ${res.status}): ${res.text.slice(0, 120)}` };
  return { http, ok: true };
}

export interface VerifyOtpResult {
  ok: boolean;
  user?: ZeptoUser | null;
  session?: ZeptoSession;
  reason?: string;
}

/** Verify the OTP with the same client; on success saves the session and returns it. */
export async function verifyOtp(http: ZeptoHttp, phone: string, otp: string): Promise<VerifyOtpResult> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  const code = otp.replace(/\D/g, "");
  if (!code) return { ok: false, reason: "empty OTP" };
  const res = await http.signed("POST", VERIFY_URL, { mobileNumber: digits, countryCode: COUNTRY_CODE, otpToken: code });
  const j = (res.json ?? {}) as Record<string, unknown>;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const user = (j.user ?? data.user ?? null) as ZeptoUser | null;
  const token = (j.token ?? j.accessToken ?? data.token) as string | undefined;
  const refreshToken = (j.refreshToken ?? j.refresh_token ?? data.refreshToken) as string | undefined;
  if (res.status !== 200 || !(user || token)) {
    return { ok: false, reason: `verify failed (HTTP ${res.status}): ${(j.message as string) ?? res.text.slice(0, 120)}` };
  }
  const claims = token ? decodeJwt(token) : null;
  const session: ZeptoSession = {
    savedAt: new Date().toISOString(),
    phone: digits,
    user,
    deviceId: http.deviceId,
    sessionId: http.sessionId,
    cookies: { ...http.cookies },
    token,
    refreshToken,
    tokenIat: typeof claims?.iat === "number" ? (claims.iat as number) : undefined,
    tokenExp: typeof claims?.exp === "number" ? (claims.exp as number) : undefined,
  };
  saveSession(session);
  return { ok: true, user, session };
}
