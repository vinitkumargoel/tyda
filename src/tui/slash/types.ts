import type React from "react";
import type { Config } from "../config.js";

/**
 * Shared types for the slash-command subsystem and the TUI shell.
 *
 * This file is the contract surface between Wave 1 Track D (TUI shell) and
 * Wave 1 Track E (MCP client + OAuth + config). Both sides must agree on
 * these shapes; do not break them without coordinating with Track E.
 */

export type ServerName = "food" | "im" | "dineout";

/**
 * A single entry rendered in the scrollable transcript.
 *
 * `tool-response.render` is an optional Ink node — when present, the
 * transcript renders it under the standard one-line status. Renderer
 * components live in `src/tui/ui/render/*` (Track I).
 */
export type TranscriptEntry =
  | { kind: "user"; line: string }
  | { kind: "tool-call"; tool: string; argsPreview: string }
  | {
      kind: "tool-response";
      tool: string;
      durationMs: number;
      ok: boolean;
      preview: string;
      render?: React.ReactNode;
    }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string };

/**
 * MCP dispatcher — Track E owns the real implementation. Track D ships a
 * stub that throws "not wired yet" from every method; Wave 2 commands
 * replace those stubs with real `mcp.call(...)` invocations.
 */
export interface McpDispatcher {
  call(
    server: ServerName,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  ensureAuth(): Promise<void>;
}

/**
 * Context passed to every slash command handler. Wave 2 commands read
 * `state` and call `push`/`setTracker` to render results.
 */
export interface SlashContext {
  mcp: McpDispatcher;
  push(entry: TranscriptEntry): void;
  setTracker(node: React.ReactNode | null): void;
  /** Request graceful exit of the Ink app. */
  exit(): void;
  /** Clear the transcript (Ctrl-L also triggers this). */
  clearTranscript(): void;
  state: {
    activeAddressId: string | null;
    activeRestaurantId: string | null;
    lastOrderId: string | null;
  };
  /** Lookup the full registry — used by /help. */
  registry: ReadonlyMap<string, SlashCommand>;
  /**
   * Resolved app config. Optional for backwards compatibility with Wave 1
   * test harnesses that pre-date Wave 4; the `/ai` handler is the only
   * consumer and gracefully falls back if absent.
   */
  config?: Config;
}

export interface SlashCommand {
  /** Bare command name without the leading slash, lowercased. */
  name: string;
  /** Help text for arguments, e.g. "<query>". Empty string if none. */
  args: string;
  /** One-line summary for /help. */
  summary: string;
  /** If true, omitted from /help. */
  hidden?: boolean;
  handler: (ctx: SlashContext, argv: string[]) => Promise<void>;
  /** Optional tab-completion suggestions for the current argv. */
  suggest?: (argv: string[]) => string[];
}
