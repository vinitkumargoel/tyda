import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

/**
 * A single restaurant entry as understood by the renderer. Kept loose
 * so it can wrap either the Food or Dineout restaurant shape — both
 * carry the same core fields. Track F / Track H project their richer
 * server-side records into this shape before rendering.
 */
export interface Restaurant {
  id: string;
  name: string;
  area: string;
  rating: number;
  etaMinutes?: number;
  costForTwo?: number;
  currency?: string;
}

export interface RestaurantListProps {
  items: readonly Restaurant[];
  /** Starting ordinal (defaults to 1). Useful when paginating. */
  startIndex?: number;
}

/** Indent that prefixes each row (matches transcript convention). */
const INDENT = "  ";

/** Max chars of the restaurant name itself before we ellipsize. */
const NAME_MAX = 26;
/** Width of the "Name — Area" column once name is truncated. */
const NAME_AREA_WIDTH = NAME_MAX + 3 + 12; // " — " + ~area width

function truncateName(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function padEndWidth(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

/**
 * Numbered list of restaurants. Renders each as a single line with
 * dimmed secondary columns (rating, ETA, cost-for-two). The leading
 * ordinal is accented to give the line a visible anchor.
 */
export function RestaurantList({
  items,
  startIndex = 1,
}: RestaurantListProps): React.ReactElement {
  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>{INDENT}(no restaurants found)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {items.map((r, i) => {
        const n = startIndex + i;
        const ordinal = `${n}.`.padStart(3, " ");
        const name = truncateName(r.name, NAME_MAX);
        const nameArea = padEndWidth(`${name} — ${r.area}`, NAME_AREA_WIDTH);
        const rating = `★ ${r.rating.toFixed(1)}`;
        const eta =
          typeof r.etaMinutes === "number" ? `~${r.etaMinutes} min` : "";
        const cost =
          typeof r.costForTwo === "number" ? `₹${r.costForTwo}/2` : "";
        return (
          <Text key={r.id}>
            {INDENT}
            <Text color={theme.accent}>{ordinal}</Text> {nameArea}
            {"  "}
            <Text dimColor>{rating}</Text>
            {eta ? (
              <Text dimColor>
                {"  "}
                {eta}
              </Text>
            ) : null}
            {cost ? (
              <Text dimColor>
                {"  "}
                {cost}
              </Text>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
