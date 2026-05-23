/**
 * Input + progress helpers shared by the login flows.
 *
 * Two modes:
 *   - interactive (default): read phone/OTP from the terminal.
 *   - non-interactive (ZEPTO_NONINTERACTIVE=1): phone from ZEPTO_PHONE, OTP read from
 *     a watched file (~/.tyda-zepto/otp.inbox). Progress mirrors to login.status.
 *     This lets a runner send the OTP request while a human holding the phone drops
 *     the received code into the inbox file.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { ZEPTO_DIR, OTP_INBOX_PATH, STATUS_PATH } from "./session.js";

export const NONINTERACTIVE = process.env.ZEPTO_NONINTERACTIVE === "1";
const OTP_TIMEOUT_MS = Number(process.env.ZEPTO_OTP_TIMEOUT_MS ?? 240000);

export function writeStatus(stage: string, detail?: Record<string, unknown>): void {
  try {
    mkdirSync(ZEPTO_DIR, { recursive: true });
    writeFileSync(
      STATUS_PATH,
      JSON.stringify({ stage, ts: new Date().toISOString(), ...detail }, null, 2),
    );
  } catch {
    /* best effort */
  }
  console.log(`[status] ${stage}${detail ? " " + JSON.stringify(detail) : ""}`);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function getPhone(): Promise<string> {
  const raw = NONINTERACTIVE
    ? (process.env.ZEPTO_PHONE ?? "").trim()
    : await ask("Enter your Zepto phone number (10 digits, India +91): ");
  return raw.replace(/\D/g, "").slice(-10);
}

/** OTP: interactive prompt, or poll the inbox file in non-interactive mode. "" on timeout. */
export async function getOtp(): Promise<string> {
  if (!NONINTERACTIVE) return (await ask("Enter the OTP you received: ")).replace(/\D/g, "");

  if (existsSync(OTP_INBOX_PATH)) rmSync(OTP_INBOX_PATH, { force: true }); // clear stale
  writeStatus("waiting_otp", { inbox: OTP_INBOX_PATH, timeoutMs: OTP_TIMEOUT_MS });
  const deadline = Date.now() + OTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(OTP_INBOX_PATH)) {
      const digits = readFileSync(OTP_INBOX_PATH, "utf8").replace(/\D/g, "");
      if (digits.length >= 4) {
        rmSync(OTP_INBOX_PATH, { force: true });
        return digits;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "";
}
