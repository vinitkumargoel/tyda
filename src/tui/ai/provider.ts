/**
 * Wave 4 — OpenAI-compatible LLM provider.
 *
 * Wraps the official `openai` SDK with a custom `baseURL` + bearer token so
 * the same code path works against the Requestly gateway, an Azure OpenAI
 * proxy, a self-hosted vLLM/ollama endpoint with the OpenAI shim, etc.
 *
 * We deliberately expose a small surface (`chat(...)`) instead of leaking
 * the full SDK so the loop can be unit-tested by handing in a fake provider.
 */
import OpenAI from "openai";
import type { Config } from "../config.js";
import type { OpenAIFunctionTool } from "../../shared/zod-to-openai.js";

export interface ChatRequest {
  messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: readonly OpenAIFunctionTool[];
  temperature?: number;
  model: string;
}

export interface OpenAIProvider {
  chat(req: ChatRequest): Promise<OpenAI.Chat.Completions.ChatCompletion>;
}

/**
 * Instantiate a provider against the supplied LLM config. `cfg.baseUrl` MUST
 * end with `/v1` (the OpenAI-compatible convention used by the Requestly
 * gateway and most third-party hosts).
 */
export function createLlmProvider(
  cfg: NonNullable<Config["llm"]>,
): OpenAIProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (!/\/v1$/.test(base)) {
    throw new Error(
      `createLlmProvider: cfg.baseUrl must end with "/v1" (got ${cfg.baseUrl})`,
    );
  }
  const client = new OpenAI({ baseURL: base, apiKey: cfg.token });
  return {
    async chat(req: ChatRequest) {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
        {
          model: req.model,
          messages: [...req.messages],
          ...(req.temperature !== undefined
            ? { temperature: req.temperature }
            : {}),
          ...(req.tools && req.tools.length > 0
            ? { tools: [...req.tools] }
            : {}),
        };
      return client.chat.completions.create(params);
    },
  };
}
