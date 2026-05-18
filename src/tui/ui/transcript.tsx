import React from "react";
import { Box, Text } from "ink";

import type { TranscriptEntry } from "../slash/types.js";
import { theme } from "./theme.js";

export interface TranscriptProps {
  entries: readonly TranscriptEntry[];
}

/**
 * Scrollable-ish transcript. Ink doesn't give us real scrolling without a
 * full-screen alt buffer, so we rely on the terminal's native scrollback
 * by simply rendering every entry. New entries appear at the bottom,
 * pushing older ones up (auto-scroll behavior the user expects).
 */
export function Transcript({ entries }: TranscriptProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {entries.map((entry, idx) => (
        <Entry key={idx} entry={entry} />
      ))}
    </Box>
  );
}

function Entry({ entry }: { entry: TranscriptEntry }): React.ReactElement {
  switch (entry.kind) {
    case "user":
      return (
        <Text>
          {" "}
          {theme.userMarker} {entry.line}
        </Text>
      );
    case "tool-call":
      return (
        <Text>
          {" "}
          <Text color={theme.accent}>{theme.toolMarker}</Text>{" "}
          <Text>{entry.tool}</Text>
          {entry.argsPreview ? (
            <Text dimColor>  {entry.argsPreview}</Text>
          ) : null}
        </Text>
      );
    case "tool-response": {
      const marker = entry.ok ? theme.okMarker : theme.errMarker;
      const markerColor = entry.ok ? theme.success : theme.error;
      const status = entry.ok ? `${entry.durationMs}ms` : "error";
      return (
        <Box flexDirection="column">
          <Text>
            {"   "}
            <Text color={markerColor}>{marker}</Text>{" "}
            <Text dimColor>{entry.tool}</Text>{" "}
            <Text dimColor>{status}</Text>
          </Text>
          {entry.preview ? <Text>{"   "}{entry.preview}</Text> : null}
          {entry.render ? <Box>{entry.render}</Box> : null}
        </Box>
      );
    }
    case "info":
      return (
        <Text dimColor>
          {" "}
          {entry.text}
        </Text>
      );
    case "error":
      return (
        <Text color={theme.error}>
          {" "}
          {entry.text}
        </Text>
      );
    default: {
      // Exhaustiveness — this branch is unreachable at runtime.
      const _exhaustive: never = entry;
      return <Text>{String(_exhaustive)}</Text>;
    }
  }
}
