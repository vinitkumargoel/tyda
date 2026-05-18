/**
 * Wave 4 — first-run consent for the `/ai` slash command.
 *
 * The TUI shell does not currently expose a synchronous prompt for "y/N"
 * input from inside a handler, so v1 implements *disclosure consent*: on
 * the first invocation of `/ai` per session we print the full disclosure
 * block and then proceed. The user retains the ability to press Ctrl-C or
 * delete the LLM config if they disagree. A future revision can swap this
 * out for an actual interactive prompt without changing the handler API.
 */
import type { Config } from "../config.js";
import type { SlashContext } from "../slash/types.js";

/**
 * Per-session "already consented" flag. Module-level state is intentional —
 * a fresh `tyda` process starts a fresh session, so the disclosure is shown
 * exactly once per run.
 */
let consented = false;

/** Reset for tests. */
export function _resetConsent(): void {
  consented = false;
}

/**
 * Show the disclosure block on the first call of a session. Returns `true`
 * unconditionally for v1 (see file docstring). The signature is kept
 * Promise-returning so a future interactive implementation can capture an
 * answer without breaking callers.
 */
export async function requireConsent(
  ctx: SlashContext,
  cfg: NonNullable<Config["llm"]>,
): Promise<boolean> {
  if (consented) return true;
  consented = true;

  const provider = cfg.provider ?? "(unspecified)";
  ctx.push({
    kind: "info",
    text:
      "/ai will forward your prompts and Swiggy tool results to an external LLM.",
  });
  ctx.push({
    kind: "info",
    text: `  provider : ${provider}`,
  });
  ctx.push({
    kind: "info",
    text: `  endpoint : ${cfg.baseUrl}`,
  });
  ctx.push({
    kind: "info",
    text: `  model    : ${cfg.model}`,
  });
  ctx.push({
    kind: "info",
    text:
      "  Tool results (cart, addresses, orders) leave your machine. Press Ctrl-C to abort.",
  });
  return true;
}
