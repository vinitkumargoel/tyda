import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { suggestCommands } from "../slash/registry.js";
import type { SlashCommand } from "../slash/types.js";
import { theme } from "./theme.js";

export interface SlashInputProps {
  /** Called when the user presses Enter on a non-empty line. */
  onSubmit: (line: string) => void;
  /** History of previously submitted lines; used by Up/Down navigation. */
  history: readonly string[];
}

/**
 * Slash text input with a suggestion overlay.
 *
 * - Prompt is `▌ ` in the accent color.
 * - When the buffer starts with `/`, an overlay of matching commands
 *   (up to 6) appears below the input. Tab cycles the highlighted
 *   suggestion and replaces the buffer with `/<name> ` so the user can
 *   start typing arguments. Enter always submits the current buffer
 *   (matching shells and Claude Code's input).
 * - Up/Down walk the submitted-line history (overlay is suppressed
 *   while browsing history to avoid surprises).
 * - Empty submit is a no-op.
 */
export function SlashInput({
  onSubmit,
  history,
}: SlashInputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [selection, setSelection] = useState(0);
  // -1 means "live editing"; 0..N indexes from the most-recent entry backwards.
  const [historyCursor, setHistoryCursor] = useState(-1);

  const showOverlay =
    historyCursor === -1 && value.startsWith("/") && !value.includes(" ");
  const prefix = showOverlay ? value.slice(1) : "";
  const suggestions: SlashCommand[] = showOverlay
    ? suggestCommands(prefix)
    : [];

  // Clamp selection if the list shrinks under the cursor.
  const sel =
    suggestions.length === 0
      ? 0
      : ((selection % suggestions.length) + suggestions.length) %
        suggestions.length;

  useInput((input, key) => {
    if (key.tab && suggestions.length > 0) {
      // Tab: accept the highlighted suggestion by replacing the buffer
      // with `/<name> `. A second Tab on the same buffer cycles through.
      const exactMatch =
        value.toLowerCase() === `/${suggestions[sel]?.name ?? ""}`;
      if (exactMatch) {
        setSelection((s) => (s + 1) % suggestions.length);
        const next = suggestions[(sel + 1) % suggestions.length];
        if (next) setValue(`/${next.name}`);
      } else {
        const pick = suggestions[sel];
        if (pick) setValue(`/${pick.name} `);
      }
      return;
    }

    if (key.upArrow) {
      if (history.length === 0) return;
      const next = Math.min(history.length - 1, historyCursor + 1);
      setHistoryCursor(next);
      setValue(history[history.length - 1 - next] ?? "");
      return;
    }

    if (key.downArrow) {
      if (historyCursor <= -1) return;
      const next = historyCursor - 1;
      setHistoryCursor(next);
      if (next === -1) setValue("");
      else setValue(history[history.length - 1 - next] ?? "");
      return;
    }

    // Plain typing should drop us out of history mode.
    if (!key.upArrow && !key.downArrow && input) {
      if (historyCursor !== -1) setHistoryCursor(-1);
    }
  });

  function handleChange(next: string) {
    setValue(next);
    if (historyCursor !== -1) setHistoryCursor(-1);
    // Reset highlight to the top whenever the prefix changes.
    setSelection(0);
  }

  function handleSubmit(submitted: string) {
    const line = submitted.trim();
    setValue("");
    setSelection(0);
    setHistoryCursor(-1);
    if (line.length === 0) return;
    onSubmit(line);
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent}>{theme.prompt} </Text>
        <TextInput value={value} onChange={handleChange} onSubmit={handleSubmit} />
      </Box>
      {showOverlay && suggestions.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {suggestions.map((c, i) => {
            const label = c.args ? `/${c.name} ${c.args}` : `/${c.name}`;
            const isSel = i === sel;
            return (
              <Text key={c.name} dimColor={!isSel} color={isSel ? theme.accent : undefined}>
                {isSel ? "› " : "  "}
                {label.padEnd(26, " ")}
                {c.summary}
              </Text>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
