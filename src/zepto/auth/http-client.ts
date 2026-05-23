/**
 * Pure-Node Zepto HTTP client — no browser, no curl.
 *
 * Zepto's AWS WAF gates the *search* service on TLS/JA3 fingerprint, but the auth
 * surface (create-csrf-token / send-otp / verify-otp) is reachable with an ordinary
 * Node `fetch` carrying a realistic header set (verified live). This client:
 *   - keeps a simple cookie jar (raw cookie values, as the wire carries them),
 *   - generates a stable device_id + session_id (UUID v4, like the web client),
 *   - bootstraps the CSRF cookies, and
 *   - signs every BFF call per ./signer (request-signature + x-timezone).
 *
 * The XSRF-TOKEN cookie value is url-encoded on the wire; the *signing secret* and
 * the x-xsrf-token header use the url-DECODED value (what the web client's
 * readCookie() returns).
 */
import { randomUUID } from "node:crypto";
import { sign } from "./signer.js";

export const ZEPTO_WEB_ORIGIN = "https://www.zepto.com";
export const ZEPTO_BFF = "https://bff-gateway.zepto.com";
export const CSRF_URL = `${ZEPTO_WEB_ORIGIN}/auth/create-csrf-token`;
export const SEND_OTP_URL = `${ZEPTO_BFF}/api/v1/user/customer/send-otp-sms/`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Captured verbatim from a live request (zepto-websrc/samples/auth-network-sample.json).
// The gateway echoes feature flags here; sending the real set keeps us indistinguishable.
const COMPATIBLE_COMPONENTS =
  ",NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,SUPERSTORE_V1,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,MARKETPLACE_REPLACEMENT,ZEPTO_PASS:5,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,TABBED_CAROUSEL_V2,24X7_ENABLED_V1,PROMO_CASH:0,HOMEPAGE_V2,SUPER_SAVER:1,NO_PLATFORM_CHECK_ENABLED_V2,HP_V4_FEED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,WIDGET_BASED_ETA,PC_REVAMP_1,NEW_ETA_BANNER,NO_COST_EMI_V1,ITEMISATION_ENABLED,SWAP_AND_SAVE_ON_CART,WIDGET_RESTRUCTURE,PRICING_CAMPAIGN_ID,BACHAT_FOR_ALL,TABBED_CAROUSEL_V3,CART_LMS:2,SAMPLING_UPSELL_CAMPAIGN,DISCOUNTED_ADDONS_ENABLED,UPSELL_COUPON_SS:0,SIZE_EXCHANGE_ENABLED,ENABLE_FLOATING_CART_BUTTON,SAMPLING_V3,HYBRID_CAMPAIGN,";

export interface SignedResponse {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
  requestId: string;
}

export class ZeptoHttp {
  /** name -> raw (wire) cookie value */
  readonly cookies: Record<string, string> = {};
  deviceId: string;
  sessionId: string;
  /** Bearer JWT returned by verify-otp / refresh-auth (token-based auth path). */
  token?: string;
  storeId?: string;

  constructor(
    opts: {
      deviceId?: string;
      sessionId?: string;
      cookies?: Record<string, string>;
      token?: string;
      storeId?: string;
    } = {},
  ) {
    this.deviceId = opts.deviceId ?? randomUUID();
    this.sessionId = opts.sessionId ?? randomUUID();
    this.token = opts.token;
    this.storeId = opts.storeId;
    if (opts.cookies) Object.assign(this.cookies, opts.cookies);
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private absorb(res: Response): void {
    const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (name) this.cookies[name] = value;
    }
  }

  /** url-decoded XSRF-TOKEN (signing secret + x-xsrf-token header). */
  xsrf(): string {
    const raw = this.cookies["XSRF-TOKEN"];
    return raw ? safeDecode(raw) : "";
  }

  csrfSecret(): string {
    const raw = this.cookies["csrfSecret"];
    return raw ? safeDecode(raw) : "";
  }

  private baseHeaders(): Record<string, string> {
    return {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-IN",
      origin: ZEPTO_WEB_ORIGIN,
      referer: `${ZEPTO_WEB_ORIGIN}/`,
      "user-agent": UA,
      "x-requested-with": "XMLHttpRequest",
    };
  }

  /** GET the CSRF bootstrap; stores XSRF-TOKEN + csrfSecret and seeds device/session cookies. */
  async bootstrapCsrf(): Promise<number> {
    const res = await fetch(CSRF_URL, { method: "GET", headers: this.baseHeaders() });
    this.absorb(res);
    // The web client generates these client-side; mirror them into the jar so the
    // cookie set and the signed headers agree.
    this.cookies["device_id"] = this.deviceId;
    this.cookies["session_id"] = this.sessionId;
    return res.status;
  }

  /** Make a signed BFF request. `body` is sent as JSON for non-GET. */
  async signed(
    method: string,
    fullUrl: string,
    body?: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<SignedResponse> {
    const u = new URL(fullUrl);
    const urlPath = u.pathname + (u.search ?? "");
    const m = method.toUpperCase();
    const bodyStr = m === "GET" ? undefined : JSON.stringify(body ?? {});
    const requestId = randomUUID();
    const secret = this.xsrf();

    const { signature, timezone } = sign({
      body: bodyStr,
      deviceId: this.deviceId,
      method: m,
      requestId,
      secret,
      url: urlPath,
    });

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      "content-type": "application/json",
      "x-xsrf-token": secret,
      "x-csrf-secret": this.csrfSecret(),
      "request-signature": signature,
      "x-timezone": timezone,
      requestid: requestId,
      request_id: requestId,
      deviceid: this.deviceId,
      device_id: this.deviceId,
      sessionid: this.sessionId,
      session_id: this.sessionId,
      platform: "WEB",
      app_sub_platform: "WEB",
      app_version: "15.23.1",
      appversion: "15.23.1",
      auth_revamp_flow: "v2",
      auth_from_cookie: "true",
      source: "DIRECT",
      tenant: "ZEPTO",
      marketplace_type: "SUPER_SAVER",
      compatible_components: COMPATIBLE_COMPONENTS,
      cookie: this.cookieHeader(),
      ...(this.token
        ? { authorization: `Bearer ${this.token}`, auth_revamp_flow: "v2" }
        : {}),
      ...(this.storeId ? { storeid: this.storeId, store_id: this.storeId } : {}),
      ...extraHeaders,
    };

    const res = await fetch(fullUrl, { method: m, headers, body: bodyStr });
    this.absorb(res);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, ok: res.ok, text, json, requestId };
  }
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Decode a JWT payload (no verification) — used to read iat/exp/sub. */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

