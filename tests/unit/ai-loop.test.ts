import { describe, it, expect } from "vitest";
import type OpenAI from "openai";

import { runAiLoop } from "../../src/tui/ai/loop.js";
import type { OpenAIProvider } from "../../src/tui/ai/provider.js";
import type {
  McpDispatcher,
  ServerName,
  SlashCommand,
  SlashContext,
  TranscriptEntry,
} from "../../src/tui/slash/types.js";

interface CallRecord {
  server: ServerName;
  tool: string;
  args: Record<string, unknown>;
}

function makeCtx(): {
  ctx: SlashContext;
  entries: TranscriptEntry[];
  calls: CallRecord[];
} {
  const entries: TranscriptEntry[] = [];
  const calls: CallRecord[] = [];
  const mcp: McpDispatcher = {
    async ensureAuth() {
      /* no-op */
    },
    async call(server, tool, args) {
      calls.push({ server, tool, args });
      return { structuredContent: { restaurants: [{ id: "R1", name: "biryani king" }] } };
    },
  };
  const ctx: SlashContext = {
    mcp,
    push(entry) {
      entries.push(entry);
    },
    setTracker() {
      /* no-op */
    },
    exit() {
      /* no-op */
    },
    clearTranscript() {
      entries.length = 0;
    },
    state: {
      activeAddressId: null,
      activeRestaurantId: null,
      lastOrderId: null,
    },
    registry: new Map<string, SlashCommand>(),
  };
  return { ctx, entries, calls };
}

function makeChatResponse(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
  usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-test",
    choices: [
      {
        index: 0,
        message,
        finish_reason: message.tool_calls ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
    usage,
  };
}

describe("runAiLoop", () => {
  it("dispatches a tool_call then exits on the next assistant turn", async () => {
    const { ctx, entries, calls } = makeCtx();
    let turn = 0;
    const provider: OpenAIProvider = {
      async chat(_req) {
        turn += 1;
        if (turn === 1) {
          return makeChatResponse({
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "search_restaurants",
                  arguments: JSON.stringify({ query: "biryani" }),
                },
              },
            ],
          });
        }
        return makeChatResponse({
          role: "assistant",
          content: "Found one match: biryani king.",
          refusal: null,
        });
      },
    };

    await runAiLoop({
      prompt: "find me biryani nearby",
      ctx,
      provider,
      model: "gpt-test",
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.server).toBe("food");
    expect(calls[0]?.tool).toBe("search_restaurants");
    expect(calls[0]?.args).toEqual({ query: "biryani" });

    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("tool-call");
    expect(kinds).toContain("tool-response");
    // Final assistant text + usage footer
    const infos = entries.filter((e) => e.kind === "info") as Array<{
      kind: "info";
      text: string;
    }>;
    expect(infos.some((i) => i.text.includes("biryani king"))).toBe(true);
    expect(infos.some((i) => /tokens/.test(i.text))).toBe(true);
  });

  it("stops after maxSteps when the model keeps requesting tools", async () => {
    const { ctx, entries, calls } = makeCtx();
    const provider: OpenAIProvider = {
      async chat(_req) {
        return makeChatResponse({
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: `call_${Math.random()}`,
              type: "function",
              function: {
                name: "search_restaurants",
                arguments: JSON.stringify({ query: "x" }),
              },
            },
          ],
        });
      },
    };

    await runAiLoop({
      prompt: "loop forever",
      ctx,
      provider,
      model: "gpt-test",
      maxSteps: 3,
    });

    expect(calls.length).toBe(3);
    const infos = entries.filter((e) => e.kind === "info") as Array<{
      kind: "info";
      text: string;
    }>;
    expect(infos.some((i) => /max_steps reached/.test(i.text))).toBe(true);
  });

  it("includes a cost figure when pricing is configured", async () => {
    const { ctx, entries } = makeCtx();
    const provider: OpenAIProvider = {
      async chat(_req) {
        return makeChatResponse(
          {
            role: "assistant",
            content: "hi",
            refusal: null,
          },
          { prompt_tokens: 1_000_000, completion_tokens: 500_000, total_tokens: 1_500_000 },
        );
      },
    };
    await runAiLoop({
      prompt: "hi",
      ctx,
      provider,
      model: "gpt-test",
      pricing: { input: 0.15, output: 0.6 },
    });
    const infos = entries.filter((e) => e.kind === "info") as Array<{
      kind: "info";
      text: string;
    }>;
    // 1e6 * 0.15 / 1e6 + 5e5 * 0.6 / 1e6 = 0.15 + 0.30 = $0.45
    expect(infos.some((i) => /\$0\.45/.test(i.text))).toBe(true);
  });
});
