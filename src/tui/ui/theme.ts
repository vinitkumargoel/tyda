/**
 * Visual tokens for the TUI. Minimal, monochrome, one accent (cyan).
 *
 * Matches the plan's Claude-Code-style mockups: no boxes, lots of
 * whitespace, dimmed secondary text, a single accent for highlights.
 */
export const theme = {
  /** The single accent color used for tool names, prompts, dividers. */
  accent: "cyan",
  /** Error color, used sparingly. */
  error: "red",
  /** Success marker color. */
  success: "green",
  /** Subtle horizontal divider character, repeated to fill width. */
  divider: "─",
  /** Prompt glyph for the input line. */
  prompt: "▌",
  /** Marker for a tool call line. */
  toolMarker: "▼",
  /** Marker for a successful response. */
  okMarker: "✓",
  /** Marker for a failed response. */
  errMarker: "✗",
  /** Marker for the user's typed line in the transcript. */
  userMarker: ">",
} as const;

export type Theme = typeof theme;
