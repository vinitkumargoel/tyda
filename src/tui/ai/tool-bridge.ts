/**
 * Wave 4 — LLM tool bridge.
 *
 * Converts every Zod input schema in `ALL_TOOLS` into an OpenAI function-call
 * schema, and maintains a lookup table that maps the function name back to
 * the originating MCP server + tool definition so `runAiLoop` can dispatch
 * `tool_calls` into `ctx.mcp.call(...)`.
 *
 * Tool name collisions are possible across servers (e.g. `get_addresses`
 * exists on both `food` and `instamart`, and `report_error` exists on all
 * three). We disambiguate by prefixing colliding tools with the server tag:
 * `food__get_addresses`, `instamart__report_error`, etc. Tools whose names
 * are unique keep their bare name so the model sees the simplest possible
 * function surface.
 */
import { ALL_TOOLS, type ServerKey, type ToolDef } from "../../shared/tool-index.js";
import {
  zodToOpenAI,
  type OpenAIFunctionTool,
} from "../../shared/zod-to-openai.js";
import type { ServerName } from "../slash/types.js";

/**
 * Map a `ServerKey` (used by `ALL_TOOLS`) to the `ServerName` the MCP
 * dispatcher expects.
 */
function dispatcherServer(server: ServerKey): ServerName {
  switch (server) {
    case "food":
      return "food";
    case "instamart":
      return "im";
    case "dineout":
      return "dineout";
  }
}

export interface ToolBridgeEntry {
  /** Function name as exposed to the LLM (may be prefixed for collisions). */
  fnName: string;
  /** Dispatcher server identifier (`food`, `im`, `dineout`). */
  server: ServerName;
  /** Owning tool definition (carries the real MCP tool name + zod schemas). */
  toolDef: ToolDef;
}

export interface ToolBridge {
  /** Function-tool schemas to ship in the `tools` field of chat.completions. */
  tools: readonly OpenAIFunctionTool[];
  /** Lookup: fnName -> { server, toolDef }. */
  byName: ReadonlyMap<string, ToolBridgeEntry>;
}

/**
 * Build the full tool-bridge for `runAiLoop`. Walks `ALL_TOOLS`, converts
 * every input schema, and resolves any naming collisions by prefixing.
 */
export function buildToolBridge(): ToolBridge {
  // Pass 1: count tool-name occurrences across all servers.
  const nameCounts = new Map<string, number>();
  const servers: ServerKey[] = ["food", "instamart", "dineout"];
  for (const server of servers) {
    for (const tool of ALL_TOOLS[server]) {
      nameCounts.set(tool.name, (nameCounts.get(tool.name) ?? 0) + 1);
    }
  }

  // Pass 2: convert schemas, prefixing colliding names.
  const tools: OpenAIFunctionTool[] = [];
  const byName = new Map<string, ToolBridgeEntry>();
  for (const server of servers) {
    for (const tool of ALL_TOOLS[server]) {
      const collides = (nameCounts.get(tool.name) ?? 0) > 1;
      const fnName = collides ? `${server}__${tool.name}` : tool.name;
      const converted = zodToOpenAI(tool.inputSchema, fnName, tool.description);
      tools.push(converted);
      byName.set(fnName, {
        fnName,
        server: dispatcherServer(server),
        toolDef: tool,
      });
    }
  }

  return { tools, byName };
}

/** Convenience: return just the OpenAI function-tool array. */
export function getAllTools(): readonly OpenAIFunctionTool[] {
  return buildToolBridge().tools;
}
