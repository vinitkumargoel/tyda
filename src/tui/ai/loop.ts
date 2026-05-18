/**
 * Wave 4 — `/ai` chat-completion ↔ tool-use loop.
 *
 * Drives an OpenAI-compatible chat-completion conversation that has access
 * to the 35 Swiggy MCP tools via function calling. Each tool call the model
 * emits is dispatched through `ctx.mcp.call(...)` and the result is appended
 * back to the message list. Caps at `maxSteps` iterations to bound runaway
 * behavior; emits a usage footer at the end.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SlashContext } from "../slash/types.js";
import type { OpenAIProvider } from "./provider.js";
import { buildToolBridge } from "./tool-bridge.js";

export interface RunAiLoopOpts {
  prompt: string;
  ctx: SlashContext;
  provider: OpenAIProvider;
  model: string;
  temperature?: number;
  maxSteps?: number;
  /** Optional input/output price per million tokens for the usage footer. */
  pricing?: { input: number; output: number };
}

const TOOL_RESULT_TRUNCATE_BYTES = 4 * 1024;

const SYSTEM_PROMPT =
  "You are the LLM agent driving the Swiggy MCP TUI (tyda). You can call " +
  "tools across three Swiggy servers:\n" +
  "  * Food     — restaurant search, menus, cart, coupons, place/track delivery orders.\n" +
  "  * Instamart — grocery search, cart, checkout, addresses, order tracking.\n" +
  "  * Dineout   — restaurant discovery, available slots, table booking, booking status.\n" +
  "Always confirm with the user before placing an order or making a booking. " +
  "Prefer the fewest tool calls that accomplish the task. Keep replies concise.";

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8") + "…[truncated]";
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return truncate(value, TOOL_RESULT_TRUNCATE_BYTES);
  try {
    return truncate(JSON.stringify(value), TOOL_RESULT_TRUNCATE_BYTES);
  } catch {
    return truncate(String(value), TOOL_RESULT_TRUNCATE_BYTES);
  }
}

function parseArgs(rawArgs: string | null | undefined): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function previewArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  } catch {
    return "{}";
  }
}

function formatUsageFooter(opts: {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  pricing?: { input: number; output: number };
}): string {
  const k = (opts.totalTokens / 1000).toFixed(1);
  let cost = "";
  if (opts.pricing) {
    const dollars =
      (opts.inputTokens * opts.pricing.input +
        opts.outputTokens * opts.pricing.output) /
      1_000_000;
    cost = ` · ~$${dollars.toFixed(2)}`;
  }
  return `${k}k tokens${cost} · ${opts.toolCalls} tool call${opts.toolCalls === 1 ? "" : "s"}`;
}

export async function runAiLoop(opts: RunAiLoopOpts): Promise<void> {
  const { prompt, ctx, provider, model } = opts;
  const maxSteps = opts.maxSteps ?? 8;
  const bridge = buildToolBridge();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const chatParams: Parameters<OpenAIProvider["chat"]>[0] = {
      messages,
      tools: bridge.tools,
      model,
    };
    if (opts.temperature !== undefined) chatParams.temperature = opts.temperature;

    let response;
    try {
      response = await provider.chat(chatParams);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.push({ kind: "error", text: `/ai: provider error: ${msg}` });
      return;
    }

    if (response.usage) {
      inputTokens += response.usage.prompt_tokens ?? 0;
      outputTokens += response.usage.completion_tokens ?? 0;
    }

    const choice = response.choices[0];
    if (!choice) {
      ctx.push({ kind: "error", text: "/ai: provider returned no choices" });
      return;
    }
    const message = choice.message;
    const requestedCalls = message.tool_calls ?? [];

    if (requestedCalls.length === 0) {
      const text = message.content;
      if (typeof text === "string" && text.length > 0) {
        ctx.push({ kind: "info", text });
      } else {
        ctx.push({ kind: "info", text: "(no reply)" });
      }
      ctx.push({
        kind: "info",
        text: formatUsageFooter({
          totalTokens: inputTokens + outputTokens,
          inputTokens,
          outputTokens,
          toolCalls,
          ...(opts.pricing ? { pricing: opts.pricing } : {}),
        }),
      });
      return;
    }

    // Echo the assistant turn (with tool_calls) back into the conversation
    // — required by the OpenAI protocol so each tool-message can reference
    // its tool_call_id.
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: requestedCalls,
    });

    for (const call of requestedCalls) {
      if (call.type !== "function") continue;
      const fnName = call.function.name;
      const entry = bridge.byName.get(fnName);
      const argsObj = parseArgs(call.function.arguments);

      if (!entry) {
        const errMsg = `unknown tool: ${fnName}`;
        ctx.push({ kind: "error", text: `/ai: ${errMsg}` });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: errMsg }),
        });
        continue;
      }

      toolCalls += 1;
      ctx.push({
        kind: "tool-call",
        tool: `${entry.server}:${entry.toolDef.name}`,
        argsPreview: previewArgs(argsObj),
      });

      const started = Date.now();
      let resultPayload: unknown;
      let ok = true;
      try {
        resultPayload = await ctx.mcp.call(
          entry.server,
          entry.toolDef.name,
          argsObj,
        );
      } catch (err) {
        ok = false;
        const msg = err instanceof Error ? err.message : String(err);
        resultPayload = { error: msg };
      }
      const durationMs = Date.now() - started;
      const serialized = serializeToolResult(resultPayload);

      ctx.push({
        kind: "tool-response",
        tool: `${entry.server}:${entry.toolDef.name}`,
        durationMs,
        ok,
        preview:
          serialized.length > 120 ? serialized.slice(0, 117) + "..." : serialized,
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: serialized,
      });
    }
  }

  ctx.push({
    kind: "info",
    text: "max_steps reached — stopping. Continue with /ai <follow-up>.",
  });
  ctx.push({
    kind: "info",
    text: formatUsageFooter({
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      toolCalls,
      ...(opts.pricing ? { pricing: opts.pricing } : {}),
    }),
  });
}
