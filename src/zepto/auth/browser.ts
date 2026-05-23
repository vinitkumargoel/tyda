/**
 * Stealth Chromium launcher for the Zepto integration.
 *
 * Zepto sits behind AWS WAF + JA3/TLS fingerprinting. A bare HTTP client (curl,
 * axios, even Playwright's own request client) gets blocked; only requests made
 * from inside a real Chromium network stack pass. So every Zepto call — login and,
 * later, search/cart — runs through this browser context and is replayed via
 * `page.evaluate(fetch(...))`, which reuses Chromium's TLS handshake.
 *
 * playwright-extra + the puppeteer stealth plugin patch the headless tells
 * (navigator.webdriver, missing plugins, etc.) so headless passes the WAF too —
 * this is what makes "log in once, no visible browser" practical.
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";

chromium.use(StealthPlugin());

// A current desktop Chrome UA on macOS — must look like a real browser to the WAF.
export const ZEPTO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const ZEPTO_ORIGIN = "https://www.zepto.com";

export interface ZeptoBrowser {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export interface LaunchOpts {
  /** Show the browser window. Default: headless (env HEADED=1 overrides). */
  headed?: boolean;
  /** Seed the context with a previously saved Playwright storageState. */
  storageState?: string | Record<string, unknown>;
}

/** Launch a stealth Chromium primed to look like a real macOS desktop in India. */
export async function launchZeptoBrowser(opts: LaunchOpts = {}): Promise<ZeptoBrowser> {
  const headed = opts.headed ?? process.env.HEADED === "1";

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const ctx = await browser.newContext({
    userAgent: ZEPTO_UA,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1366, height: 820 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storageState: opts.storageState as any,
  });

  const page = await ctx.newPage();

  return {
    browser,
    ctx,
    page,
    close: async () => {
      await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
