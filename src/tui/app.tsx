import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { Config } from "./config.js";
import { parseSlash } from "./slash/parser.js";
import { REGISTRY } from "./slash/registry.js";
import type {
  McpDispatcher,
  SlashContext,
  TranscriptEntry,
} from "./slash/types.js";
import { PinnedTracker } from "./ui/pinned-tracker.jsx";
import { SlashInput } from "./ui/input.jsx";
import { theme } from "./ui/theme.js";
import { Transcript } from "./ui/transcript.jsx";

export interface AppProps {
  /** Remote MCP server URL, surfaced in the header banner. */
  remoteUrl: string;
  /** Dispatcher for slash handlers; Wave 1 ships a "not wired yet" stub. */
  mcp: McpDispatcher;
  /** Resolved config (Wave 4: required by `/ai`, optional elsewhere). */
  config?: Config;
}

const HEADER_WIDTH = 58;

/**
 * Ink root for the TUI.
 *
 * Layout (matches the plan's mockup):
 *   tyda — Swiggy MCP terminal (mock @ <url>)
 *   ─────────...
 *   Signed in as ?               (empty for Wave 1)
 *   Type /help for commands, /quit to exit.
 *
 *   [PinnedTracker]              (nothing unless a command pins one)
 *   [Transcript]                 (fills the middle, auto-grows)
 *   ▌ _                          (slash input + suggestion overlay)
 */
export function App({ remoteUrl, mcp, config }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [entries, setEntries] = useState<readonly TranscriptEntry[]>([]);
  const [tracker, setTracker] = useState<React.ReactNode | null>(null);
  const [history, setHistory] = useState<readonly string[]>([]);

  // The slash context is closed over in `runLine`; we keep a stable ref to
  // the latest mutable state so handlers always observe up-to-date values
  // without re-creating the registry binding.
  const sessionState = useRef({
    activeAddressId: null as string | null,
    activeRestaurantId: null as string | null,
    lastOrderId: null as string | null,
  });

  const push = useCallback((entry: TranscriptEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const clearTranscript = useCallback(() => {
    setEntries([]);
  }, []);

  // Ctrl-L clears the transcript (not a slash command, per spec).
  useInput((_input, key) => {
    if (key.ctrl && _input === "l") clearTranscript();
  });

  const ctx: SlashContext = useMemo(
    () => {
      const base: SlashContext = {
        mcp,
        push,
        setTracker: (node) => setTracker(node),
        exit: () => exit(),
        clearTranscript,
        state: sessionState.current,
        registry: REGISTRY,
      };
      if (config) base.config = config;
      return base;
    },
    [mcp, push, exit, clearTranscript, config],
  );

  const runLine = useCallback(
    (line: string) => {
      // Push the user's typed line to the transcript first so the
      // command output shows up beneath it.
      push({ kind: "user", line });
      setHistory((prev) => [...prev, line]);

      const parsed = parseSlash(line);
      if (parsed === null) {
        push({
          kind: "info",
          text: "Commands start with `/`. Try /help.",
        });
        return;
      }

      if (parsed.cmd === "") {
        // Bare `/` — show help shortcut.
        push({ kind: "info", text: "Type a command after `/`. Try /help." });
        return;
      }

      const command = REGISTRY.get(parsed.cmd);
      if (!command) {
        push({
          kind: "error",
          text: `unknown command: /${parsed.cmd} — try /help`,
        });
        return;
      }

      // Fire and forget — handler errors are surfaced into the transcript.
      void command.handler(ctx, parsed.argv).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        push({ kind: "error", text: `/${command.name}: ${msg}` });
      });
    },
    [push, ctx],
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text> tyda — Swiggy MCP terminal (mock @ {remoteUrl})</Text>
        <Text color={theme.accent}>
          {" "}
          {theme.divider.repeat(HEADER_WIDTH)}
        </Text>
        <Text dimColor> Signed in as ?</Text>
        <Text dimColor> Type /help for commands, /quit to exit.</Text>
      </Box>

      <PinnedTracker tracker={tracker} />

      <Transcript entries={entries} />

      <Box marginTop={1}>
        <SlashInput onSubmit={runLine} history={history} />
      </Box>
    </Box>
  );
}
