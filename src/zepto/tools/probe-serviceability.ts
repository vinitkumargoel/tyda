/** Crack address → storeId. Lists saved addresses, then tries serviceability variants. */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p.replace(/^\//, "")}`;

async function main() {
  const s = loadSession();
  if (!s?.token) throw new Error("login first");
  const http = new ZeptoHttp({ deviceId: s.deviceId, sessionId: s.sessionId, cookies: s.cookies, token: s.token, storeId: s.storeId });

  const a = await http.signed("GET", U("api/v1/user/customer/addresses/"));
  const addrs = ((a.json as any)?.userAddresses ?? []) as any[];
  console.log(`addresses: ${addrs.length}`);
  addrs.forEach((ad, i) => console.log(`  ${i + 1}. ${ad.type} ${ad.buildingName ?? ""} (${ad.latitude}, ${ad.longitude}) id=${ad.id}`));
  const ad = addrs[0];
  if (!ad) return;
  const lat = ad.latitude, lng = ad.longitude;

  const trials: Array<{ label: string; method: "GET" | "POST"; url: string; body?: any }> = [
    { label: "GET latitude/longitude", method: "GET", url: U(`serviceability-service/api/v1/serviceability?latitude=${lat}&longitude=${lng}`) },
    { label: "GET lat/lng", method: "GET", url: U(`serviceability-service/api/v1/serviceability?lat=${lat}&lng=${lng}`) },
    { label: "GET lat/long", method: "GET", url: U(`serviceability-service/api/v1/serviceability?lat=${lat}&long=${lng}`) },
    { label: "GET addressId", method: "GET", url: U(`serviceability-service/api/v1/serviceability?addressId=${ad.id}`) },
    { label: "POST {latitude,longitude}", method: "POST", url: U("serviceability-service/api/v1/serviceability"), body: { latitude: lat, longitude: lng } },
    { label: "POST {lat,lng}", method: "POST", url: U("serviceability-service/api/v1/serviceability"), body: { lat, lng } },
    { label: "POST {latitude,longitude,addressId}", method: "POST", url: U("serviceability-service/api/v1/serviceability"), body: { latitude: lat, longitude: lng, addressId: ad.id } },
  ];

  for (const t of trials) {
    try {
      const r = await http.signed(t.method, t.url, t.body);
      const j = (r.json ?? {}) as any;
      // hunt for storeId in response
      const ids: string[] = [];
      const dig = (o: any, d = 0) => {
        if (!o || typeof o !== "object" || d > 6) return;
        for (const k of Object.keys(o)) {
          if (/^storeid$/i.test(k) && typeof o[k] === "string") ids.push(o[k]);
          else dig(o[k], d + 1);
        }
      };
      dig(j);
      const msg = j.message ?? (j.errors && JSON.stringify(j.errors)) ?? "";
      console.log(`${r.status}  ${t.label}  ${ids.length ? "storeIds=" + [...new Set(ids)].join(",") : ""} ${msg ? "« " + String(msg).slice(0, 80) + " »" : Object.keys(j).slice(0, 6).join(",")}`);
    } catch (e) {
      console.log(`ERR ${t.label}: ${(e as Error).message}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
