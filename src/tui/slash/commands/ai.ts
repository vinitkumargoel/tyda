/**
 * Wave 4 — `/ai <prompt>` slash command.
 *
 * Decision: the registry keeps `hidden: true` at module load time; the
 * handler is also defensive — if no LLM is configured at invocation time
 * (or no SlashContext.config was wired in, e.g. legacy callers from Waves
 * 0–3 tests) it prints an info line and returns. This means /help only
 * lists `/ai` when the registry was constructed with `hidden: false`,
 * which we do at runtime in `cli.ts` based on the resolved `config.llm`.
 *
 * Consent (see `consent.ts`) currently runs as a *disclosure* prompt
 * because the TUI input subsystem cannot yet pause a handler for a y/N
 * answer. Real interactive consent is a future revision.
 */
import { createLlmProvider } from "../../ai/provider.js";
import { runAiLoop } from "../../ai/loop.js";
import { requireConsent } from "../../ai/consent.js";
import type { SlashContext } from "../types.js";

export type SlashHandler = (
  ctx: SlashContext,
  argv: string[],
) => Promise<void>;

async function aiHandler(ctx: SlashContext, argv: string[]): Promise<void> {
  const cfg = ctx.config?.llm;
  if (!cfg) {
    ctx.push({
      kind: "info",
      text:
        "/ai: no LLM configured — copy config.example.yml to ~/.tyda-swiggy/config.yml and set llm.{base_url,token,model}.",
    });
    return;
  }

  const prompt = argv.join(" ").trim();
  if (prompt.length === 0) {
    ctx.push({ kind: "error", text: "usage: /ai <prompt>" });
    return;
  }

  await requireConsent(ctx, cfg);

  let provider;
  try {
    provider = createLlmProvider(cfg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `/ai: ${msg}` });
    return;
  }

  const loopOpts: Parameters<typeof runAiLoop>[0] = {
    prompt,
    ctx,
    provider,
    model: cfg.model,
    maxSteps: cfg.maxSteps ?? 8,
    temperature: cfg.temperature ?? 0.2,
  };
  if (cfg.pricing) loopOpts.pricing = cfg.pricing;

  await runAiLoop(loopOpts);
}

export const aiHandlers: Record<string, SlashHandler> = {
  ai: aiHandler,
};
