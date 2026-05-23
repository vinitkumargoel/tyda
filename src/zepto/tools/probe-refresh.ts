/**
 * One-off: find the working token-refresh endpoint using the opaque refreshToken.
 *   tsx src/zepto/probe-refresh.ts
 */
import { ZeptoHttp, ZEPTO_BFF, ZEPTO_WEB_ORIGIN } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

async function main() {
  const s = loadSession();
  if (!s?.refreshToken) throw new Error("no refreshToken in session");
  const rt = s.refreshToken;

  const http = new ZeptoHttp({
    deviceId: s.deviceId,
    sessionId: s.sessionId,
    cookies: s.cookies,
    token: s.token,
    storeId: s.storeId,
  });

  const paths = [
    "api/v1/user/customer/refresh-token/",
    "api/v1/user/customer/refresh-auth",
    "api/v1/user/customer/refresh-auth/",
    "api/v1/user/customer/auth/refresh",
    "api/v1/user/customer/auth/refresh-token",
    "api/v1/user/customer/token/refresh",
    "api/v2/user/customer/refresh-token",
    "api/v2/user/customer/verify-otp",
    "api/v1/user/refresh-token",
    "api/v1/user/auth/refresh",
    "api/v1/auth/refresh-auth",
    "api/v1/user/customer/refresh-access-token",
  ];
  const cands: Array<{ url: string; body: Record<string, unknown>; hdr?: Record<string, string> }> = [];
  for (const p of paths) {
    cands.push({ url: `${ZEPTO_BFF}/${p}`, body: { refreshToken: rt } });
  }
  // header-based variants on the two most-likely paths
  cands.push({ url: `${ZEPTO_BFF}/api/v1/user/customer/refresh-token/`, body: {}, hdr: { "x-refresh-token": rt } });
  cands.push({ url: `${ZEPTO_BFF}/api/v1/user/customer/refresh-token/`, body: {}, hdr: { authorization: `Bearer ${rt}` } });
  void ZEPTO_WEB_ORIGIN;

  for (const c of cands) {
    try {
      const res = await http.signed("POST", c.url, c.body, c.hdr);
      const j = (res.json ?? {}) as any;
      const newTok = j.token ?? j.accessToken ?? j.data?.token;
      const msg = j.message ?? j.error ?? "";
      const path = new URL(c.url).pathname;
      console.log(
        `${res.status}  ${path}  body=${Object.keys(c.body)[0]}  ${newTok ? "→ NEW TOKEN ✓" : ""}  ${msg ? "« " + msg + " »" : ""}`,
      );
      if (newTok) {
        console.log("   WORKS. response keys:", Object.keys(j).join(", "));
        break;
      }
    } catch (e) {
      console.log("ERR", c.url, (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
