/**
 * zepto CLI — for now just authentication.
 *
 *   tsx src/zepto/cli.ts login           # real OTP login over pure HTTP (default, no browser)
 *   tsx src/zepto/cli.ts login --browser # fallback: drive the real login modal via Playwright
 *   tsx src/zepto/cli.ts status          # show whether a saved session exists + summary
 *
 * The eventual MCP server + TUI (mirroring tyda's Swiggy build) will reuse the
 * harvested session; this is the first slice: get logged in.
 */
import { httpLogin } from "./auth/http-login.js";
import { loadSession, hasSession, SESSION_PATH, summarizeCookies, userLabel } from "./auth/session.js";
import { tokenStatus, humanLeft, tryRefresh } from "./auth/refresh.js";
import { cmdSearch, cmdCartDemo, cmdCartClear } from "./commerce.js";
import { cmdCatalog } from "./catalog.js";

async function cmdLogin(useBrowser: boolean): Promise<void> {
  if (useBrowser) {
    const { login } = await import("./auth/login.js"); // lazy: only needs Playwright in this path
    const res = await login();
    report(res.ok, res.user, res.sessionPath, res.reason);
    return;
  }
  const res = await httpLogin();
  if (res.ok && res.verifyUrl) console.log(`  (verified via ${res.verifyUrl})`);
  report(res.ok, res.user, res.sessionPath, res.reason);
}

function report(
  ok: boolean,
  user: import("./auth/session.js").ZeptoUser | null,
  sessionPath: string | undefined,
  reason: string | undefined,
): void {
  if (ok) {
    console.log("\n✔ Logged in to Zepto.");
    if (user) console.log(`  User: ${userLabel(user)}`);
    console.log(`  Session saved → ${sessionPath}`);
    process.exit(0);
  }
  console.error("\n✘ Login failed:", reason);
  process.exit(1);
}

function cmdStatus(): void {
  if (!hasSession()) {
    console.log("No Zepto session. Run: npm run zepto:login");
    process.exit(2);
  }
  const s = loadSession();
  if (!s) {
    console.log(`Session file present but unreadable: ${SESSION_PATH}`);
    process.exit(2);
  }
  const sum = summarizeCookies(s.cookies ?? {});
  const ts = tokenStatus(s);
  console.log("Zepto session:");
  console.log(`  saved at : ${s.savedAt}`);
  console.log(`  phone    : +91 ${s.phone}`);
  console.log(`  user     : ${userLabel(s.user, s.phone)}`);
  console.log(`  token    : ${ts.hasToken ? (ts.valid ? `valid (${humanLeft(ts.secondsLeft)} left, exp ${ts.expiresAt})` : "EXPIRED") : "MISSING"}`);
  console.log(`  refresh  : ${ts.hasRefreshToken ? "present" : "missing"}`);
  console.log(`  storeId  : ${s.storeId ?? "(unresolved)"}`);
  console.log(`  cookies  : ${sum.names.length} (${sum.names.join(", ")})`);
  console.log(`  file     : ${SESSION_PATH}`);
  process.exit(ts.valid ? 0 : 3);
}

async function cmdRefresh(): Promise<void> {
  const s = loadSession();
  if (!s) {
    console.log("No session. Run: npm run zepto:login");
    process.exit(2);
  }
  const ts = tokenStatus(s);
  if (ts.valid) {
    console.log(`Token still valid — ${humanLeft(ts.secondsLeft)} left (exp ${ts.expiresAt}). No refresh needed.`);
    process.exit(0);
  }
  console.log("Token expired. Attempting refresh…");
  const r = await tryRefresh(s);
  if (r.ok) {
    console.log("✔ Refreshed.");
    process.exit(0);
  }
  console.log(`Cannot refresh: ${r.reason}`);
  if (r.needsRelogin) {
    console.log("→ Re-logging in via OTP…\n");
    const res = await httpLogin();
    report(res.ok, res.user, res.sessionPath, res.reason);
  }
  process.exit(1);
}

const cmd = process.argv[2] ?? "status";
const useBrowser = process.argv.includes("--browser");
switch (cmd) {
  case "login":
    void cmdLogin(useBrowser);
    break;
  case "status":
    cmdStatus();
    break;
  case "refresh":
    void cmdRefresh();
    break;
  case "search":
    void cmdSearch(process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" "));
    break;
  case "cart-demo":
    void cmdCartDemo(
      process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" "),
      process.argv.includes("--keep"),
    );
    break;
  case "cart-clear":
    void cmdCartClear();
    break;
  case "catalog":
    void cmdCatalog(process.argv.slice(3));
    break;
  default:
    console.error(
      `Unknown command: ${cmd}\nUsage: tsx src/zepto/cli.ts [login [--browser]|status|refresh|search <q>|cart-demo <q> [--keep]|cart-clear|catalog [--store <id>] [--out <dir>] [--concurrency <n>]]`,
    );
    process.exit(1);
}
