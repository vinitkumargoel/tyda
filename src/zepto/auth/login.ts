/**
 * Browser-driven Zepto OTP login (FALLBACK).
 *
 * The default login path is pure HTTP (./http-login) — no browser needed, because
 * Zepto's auth endpoints are not JA3-gated. This Playwright path is kept as a
 * fallback in case Zepto later starts fingerprint-gating the auth surface too: it
 * drives the real login modal so Zepto's own JS does the CSRF bootstrap + signing,
 * then harvests the resulting cookie jar into the same session shape.
 *
 * Env: HEADED=1 show the window; ZEPTO_NONINTERACTIVE / ZEPTO_PHONE as in ./prompt.
 */
import { launchZeptoBrowser, ZEPTO_ORIGIN } from "./browser.js";
import { getPhone, getOtp, writeStatus } from "./prompt.js";
import { saveSession, summarizeCookies, type ZeptoSession, type ZeptoUser } from "./session.js";
import type { Page } from "playwright";

const SEND_OTP_RE = /send-otp/i;
const VERIFY_OTP_RE = /verify-otp/i;

interface AuthEvent {
  url: string;
  method: string;
  status?: number;
  body?: unknown;
}

export interface LoginResult {
  ok: boolean;
  user: ZeptoUser | null;
  sessionPath?: string;
  reason?: string;
  events: AuthEvent[];
}

async function openLoginModal(page: Page): Promise<void> {
  const loginBtn = page.getByRole("button", { name: /log\s*in|login|sign\s*in/i }).first();
  await loginBtn.click({ timeout: 15000 });
  await page
    .locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
}

async function submitPhone(page: Page, phone: string): Promise<void> {
  const field = page
    .locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]')
    .first();
  await field.click();
  await field.fill("");
  await field.type(phone, { delay: 40 });
  await page.waitForTimeout(400);
  const cont = page
    .getByRole("button", { name: /continue|proceed|get otp|send otp|verify|next/i })
    .first();
  if (await cont.count()) await cont.click({ timeout: 8000 }).catch(() => page.keyboard.press("Enter"));
  else await page.keyboard.press("Enter");
}

async function submitOtp(page: Page, otp: string): Promise<void> {
  const boxes = page.locator(
    'input[autocomplete="one-time-code"], input[maxlength="1"], input[inputmode="numeric"]',
  );
  const count = await boxes.count();
  if (count >= otp.length && count > 1) {
    for (let i = 0; i < otp.length; i++) {
      await boxes.nth(i).fill(otp[i]);
      await page.waitForTimeout(60);
    }
  } else {
    const single = page
      .locator(
        'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="number"], input[type="tel"]',
      )
      .last();
    await single.click();
    await single.fill("");
    await single.type(otp, { delay: 50 });
  }
  const verifyBtn = page.getByRole("button", { name: /verify|confirm|submit|continue/i }).first();
  if (await verifyBtn.count()) await verifyBtn.click({ timeout: 6000 }).catch(() => {});
  else await page.keyboard.press("Enter").catch(() => {});
}

export async function login(): Promise<LoginResult> {
  const events: AuthEvent[] = [];
  writeStatus("launching", { mode: "browser", headed: process.env.HEADED === "1" });
  const { page, ctx, close } = await launchZeptoBrowser();

  page.on("response", async (res) => {
    const url = res.url();
    if (SEND_OTP_RE.test(url) || VERIFY_OTP_RE.test(url)) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      events.push({ url, method: res.request().method(), status: res.status(), body });
    }
  });

  const finish = async (r: LoginResult): Promise<LoginResult> => {
    await close();
    writeStatus(r.ok ? "done" : "failed", { ok: r.ok, reason: r.reason });
    return r;
  };

  try {
    writeStatus("loading_site");
    await page.goto(ZEPTO_ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    writeStatus("opening_modal");
    await openLoginModal(page);

    const phone = await getPhone();
    if (phone.length !== 10) return finish({ ok: false, user: null, reason: `invalid phone: "${phone}"`, events });

    writeStatus("sending_otp", { phone });
    await submitPhone(page, phone);
    await page.waitForTimeout(2500);
    const sendEvt = events.find((e) => SEND_OTP_RE.test(e.url));
    if (sendEvt && sendEvt.status && sendEvt.status >= 400)
      return finish({ ok: false, user: null, reason: `send-otp failed (HTTP ${sendEvt.status})`, events });
    writeStatus("otp_sent", { observed: !!sendEvt, status: sendEvt?.status });

    const otp = await getOtp();
    if (!otp) return finish({ ok: false, user: null, reason: "no OTP provided", events });

    writeStatus("verifying_otp");
    await submitOtp(page, otp);
    await page.waitForTimeout(3000);
    const verifyEvt = events.find((e) => VERIFY_OTP_RE.test(e.url));
    if (verifyEvt && verifyEvt.status && verifyEvt.status >= 400)
      return finish({ ok: false, user: null, reason: `verify-otp failed (HTTP ${verifyEvt.status})`, events });

    // Harvest cookies into the shared session shape.
    const pwCookies = await ctx.cookies();
    const cookies: Record<string, string> = {};
    for (const c of pwCookies) cookies[c.name] = c.value;
    const summary = summarizeCookies(cookies);
    const user = (verifyEvt?.body as { user?: ZeptoUser } | undefined)?.user ?? null;
    if (!summary.isAuth && !user)
      return finish({ ok: false, user: null, reason: "verify-otp did not produce an authenticated session", events });

    const deviceId = cookies["device_id"] ?? "";
    const sessionId = cookies["session_id"] ?? "";
    const session: ZeptoSession = {
      savedAt: new Date().toISOString(),
      phone,
      user,
      deviceId,
      sessionId,
      cookies,
    };
    const sessionPath = saveSession(session);
    return finish({ ok: true, user, sessionPath, events });
  } catch (err) {
    return finish({ ok: false, user: null, reason: (err as Error).message, events });
  }
}
