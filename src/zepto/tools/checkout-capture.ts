/**
 * Capture a REAL Zepto checkout from the browser.
 *
 * Opens zepto.com in a stealth (headed) browser. YOU log in, add an item, check
 * out, and pay in Zepto's own UI (Juspay handles the card/UPI). The script records
 * the order-create + payment payloads it sees — with cookies/Authorization/signing
 * headers and the OTP redacted — so we can implement the pure-HTTP order flow from
 * real data. Card/UPI data is entered on Juspay's domain and is NOT captured.
 *
 *   npm run zepto:checkout      (Ctrl+C when done; capture is saved continuously)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchZeptoBrowser, ZEPTO_ORIGIN } from "../auth/browser.js";
import { CONFIG_DIR } from "../config.js";

const CAPTURE_RE =
  /cfs\/api\/v1\/cart|api\/v3\/order|order-creation-service|payment-service|initiate-sdk|payment-status|order\/[^/]+\/status|verify-otp|send-otp/i;
const REDACT_BODY_RE = /send-otp|verify-otp/i;
const SECRET_HEADER_RE = /cookie|authorization|x-xsrf|csrf|request-signature|x-timezone/i;

interface Evt {
  dir: "req" | "res";
  t: string;
  method?: string;
  status?: number;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

const events: Evt[] = [];
const OUT = join(CONFIG_DIR, `checkout-capture-${Date.now()}.json`);

function save() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(events, null, 2));
}
function redactHeaders(h: Record<string, string>) {
  const c: Record<string, string> = {};
  for (const k of Object.keys(h)) c[k] = SECRET_HEADER_RE.test(k) ? "<redacted>" : h[k];
  return c;
}
const short = (u: string) => u.replace(/^https?:\/\/[^/]+/, "").slice(0, 80);

const { page, close } = await launchZeptoBrowser({ headed: true });

page.on("request", (req) => {
  const url = req.url();
  if (!CAPTURE_RE.test(url)) return;
  events.push({
    dir: "req",
    t: new Date().toISOString(),
    method: req.method(),
    url,
    headers: redactHeaders(req.headers()),
    body: REDACT_BODY_RE.test(url) ? "<redacted: otp>" : (req.postData()?.slice(0, 6000) ?? null),
  });
  save();
});

page.on("response", async (res) => {
  const url = res.url();
  if (!CAPTURE_RE.test(url)) return;
  let body: string | undefined;
  try {
    body = JSON.stringify(await res.json()).slice(0, 6000);
  } catch {
    body = undefined;
  }
  events.push({ dir: "res", t: new Date().toISOString(), status: res.status(), url, body });
  save();

  // Helpful live signals
  if (/api\/v3\/order\/?$|order-creation-service/i.test(url) && res.status() < 400) {
    const id = (() => {
      try {
        return (JSON.parse(body ?? "{}").orderId ?? JSON.parse(body ?? "{}").id) as string;
      } catch {
        return undefined;
      }
    })();
    console.log(`\n  ✓ ORDER CREATED  (${short(url)})  orderId=${id ?? "?"}`);
  }
  if (/payment-status/i.test(url)) console.log(`  • payment-status (${short(url)}) → ${res.status()}`);
  if (/initiate-sdk/i.test(url)) console.log(`  • payment initiated (${short(url)})`);
});

console.log("──────────────────────────────────────────────────────────────");
console.log(" Zepto checkout capture — a REAL order. Do this in the window:");
console.log("   1. Log in (your OTP)        2. Search + add an item");
console.log("   3. Go to cart → Pay         4. Complete payment (UPI/card)");
console.log(" Card/UPI is entered on Juspay and is NOT captured.");
console.log(` Capture (redacted) → ${OUT}`);
console.log(" Press Ctrl+C when the order is placed.");
console.log("──────────────────────────────────────────────────────────────");

await page.goto(ZEPTO_ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 60000 });

process.on("SIGINT", async () => {
  save();
  console.log(`\nSaved ${events.length} events → ${OUT}`);
  await close();
  process.exit(0);
});

// keep the browser open until Ctrl+C
await new Promise<void>(() => {});
