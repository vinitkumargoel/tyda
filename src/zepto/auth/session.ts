/**
 * Zepto session persistence.
 *
 * After a successful OTP login we hold the authenticated cookie set (XSRF-TOKEN,
 * csrfSecret, the httpOnly auth-session cookies, device_id, session_id) plus the
 * device/session UUIDs used to sign requests. We store that so the next run can
 * resume the signed session without a second OTP.
 *
 * Mirrors tyda's ~/.tyda-swiggy/token.json convention but for Zepto:
 *   ~/.tyda-zepto/session.json   (written 0600 — it grants account access)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { CONFIG_DIR, CONFIG_PATH, loadConfig, saveConfig } from "../config.js";

// Everything persists in the unified ~/.tyda/config.yml (see ../config.ts).
export const ZEPTO_DIR = CONFIG_DIR;
export const SESSION_PATH = CONFIG_PATH;

// Test/automation IPC (see ./prompt.ts) — transient files alongside the config.
export const OTP_INBOX_PATH = join(CONFIG_DIR, "otp.inbox");
export const STATUS_PATH = join(CONFIG_DIR, "login.status");

// Legacy location migrated on first read so an existing valid session carries over.
const LEGACY_SESSION = join(homedir(), ".tyda-zepto", "session.json");

/** Minimal view of the logged-in user as returned by verify-otp. */
export interface ZeptoUser {
  id?: string;
  /** Zepto returns the display name as `fullName`. */
  fullName?: string;
  name?: string;
  /** Zepto returns the number as `mobileNumber`. */
  mobileNumber?: string;
  phone?: string;
  email?: string;
  emailId?: string;
  referralCode?: string;
  [k: string]: unknown;
}

/** Human label for the user — name + phone, never the bare UUID. */
export function userLabel(user: ZeptoUser | null | undefined, phone?: string): string {
  const name = user?.fullName ?? user?.name;
  const num = user?.mobileNumber ?? phone;
  if (name) return num ? `${name} (+91 ${num})` : name;
  if (num) return `+91 ${num}`;
  return user?.id ?? "unknown";
}

export interface ZeptoSession {
  savedAt: string;
  phone: string;
  user: ZeptoUser | null;
  /** UUIDs used when signing — must be reused so future signatures stay consistent. */
  deviceId: string;
  sessionId: string;
  /** Cookie jar: name -> raw (wire) value. Part of the logged-in session. */
  cookies: Record<string, string>;
  /** Bearer JWT from verify-otp / refresh-auth (the authenticated identity). */
  token?: string;
  refreshToken?: string;
  /** JWT iat/exp (unix seconds) decoded from `token`, for refresh scheduling. */
  tokenIat?: number;
  tokenExp?: number;
  /** Active store id once serviceability is resolved (needed by data endpoints). */
  storeId?: string;
}

/** True if the bearer token is missing or within `skewSec` of expiry. */
export function isTokenExpired(session: ZeptoSession | null, skewSec = 60): boolean {
  if (!session?.token || !session.tokenExp) return true;
  return Date.now() / 1000 >= session.tokenExp - skewSec;
}

export interface CookieSummary {
  hasXsrf: boolean;
  hasCsrfSecret: boolean;
  isAuth: boolean;
  names: string[];
}

export function summarizeCookies(cookies: Record<string, string>): CookieSummary {
  const names = Object.keys(cookies);
  const get = (n: string) => names.find((k) => k.toLowerCase() === n.toLowerCase());
  const isAuthKey = get("IS_AUTH");
  return {
    hasXsrf: !!get("XSRF-TOKEN"),
    hasCsrfSecret: !!get("csrfSecret"),
    isAuth: isAuthKey ? cookies[isAuthKey]?.toLowerCase() === "true" : false,
    names,
  };
}

export function saveSession(session: ZeptoSession): string {
  const cfg = loadConfig();
  cfg.zepto = { ...(cfg.zepto ?? {}), session };
  return saveConfig(cfg);
}

export function loadSession(): ZeptoSession | null {
  const cfg = loadConfig();
  const s = cfg.zepto?.session as ZeptoSession | undefined;
  if (s) return s;
  // One-time migration from the legacy ~/.tyda-zepto/session.json.
  if (existsSync(LEGACY_SESSION)) {
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_SESSION, "utf8")) as ZeptoSession;
      saveSession(legacy);
      return legacy;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function hasSession(): boolean {
  return loadSession() !== null;
}
