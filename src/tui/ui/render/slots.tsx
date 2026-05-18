import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface SlotsVenue {
  id: string;
  name: string;
  rating?: number;
  costForTwo?: number;
  area?: string;
}

export interface Slot {
  id: string;
  /** Time label, e.g. "19:30". */
  label: string;
  /** Remaining capacity. 0 means booked-out. */
  capacity: number;
}

export interface SlotsViewProps {
  venue: SlotsVenue;
  slots: readonly Slot[];
  /** Optional date label printed after the venue line. */
  date?: string;
}

const INDENT = "  ";
const SLOT_INDENT = "       "; // align below the venue id prefix

/** Truncate-with-ellipsis helper. */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/**
 * Slots view. One venue header line followed by a wrapping row of
 * available time slots; booked-out times appear dimmed.
 *
 *   D01  Toit Brewpub        ★ 4.6  ₹1500/2   3 slots free
 *        12:30  13:00  13:30  19:30  20:00 ...
 */
export function SlotsView({
  venue,
  slots,
  date,
}: SlotsViewProps): React.ReactElement {
  const free = slots.filter((s) => s.capacity > 0).length;
  const id = padEnd(venue.id, 4);
  const name = padEnd(truncate(venue.name, 18), 18);
  const rating =
    typeof venue.rating === "number" ? `★ ${venue.rating.toFixed(1)}` : "";
  const cost =
    typeof venue.costForTwo === "number" ? `₹${venue.costForTwo}/2` : "";
  const freeText = `${free} slot${free === 1 ? "" : "s"} free`;

  return (
    <Box flexDirection="column">
      <Text>
        {INDENT}
        <Text color={theme.accent}>{id}</Text> {name}
        {rating ? (
          <Text dimColor>
            {"  "}
            {rating}
          </Text>
        ) : null}
        {cost ? (
          <Text dimColor>
            {"  "}
            {cost}
          </Text>
        ) : null}
        {"   "}
        <Text dimColor>{freeText}</Text>
        {date ? <Text dimColor>{`  (${date})`}</Text> : null}
      </Text>
      {slots.length === 0 ? (
        <Text dimColor>{SLOT_INDENT}(no slots available)</Text>
      ) : (
        <Text>
          {SLOT_INDENT}
          {slots.map((s, i) => {
            const isLast = i === slots.length - 1;
            const sep = isLast ? "" : "  ";
            if (s.capacity === 0) {
              return (
                <Text key={s.id} dimColor>
                  {s.label}
                  {sep}
                </Text>
              );
            }
            return (
              <Text key={s.id}>
                {s.label}
                {sep}
              </Text>
            );
          })}
        </Text>
      )}
    </Box>
  );
}
