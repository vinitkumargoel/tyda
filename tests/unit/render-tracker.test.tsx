import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";

import {
  Tracker,
  BAR_WIDTH,
  STATE_FILL,
  formatElapsed,
  progressBar,
} from "../../src/tui/ui/render/tracker.jsx";
import type {
  OrderState,
  TrackerOrder,
  TrackerRider,
} from "../../src/tui/ui/render/tracker.jsx";

/** Fixed placed-at timestamp for deterministic elapsed values. */
const PLACED_AT = 1_700_000_000_000;

function fixedClock(offsetMs: number): () => number {
  return () => PLACED_AT + offsetMs;
}

function makeOrder(state: OrderState, overrides: Partial<TrackerOrder> = {}): TrackerOrder {
  return {
    id: "FD-2026-05-18-0042",
    state,
    placedAt: PLACED_AT,
    restaurantName: "Meghana Foods",
    ...overrides,
  };
}

const rider: TrackerRider = {
  name: "Ramesh K",
  distanceKm: 1.8,
  etaMinutes: 24,
};

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

describe("Tracker — pure helpers", () => {
  it("formats elapsed time as MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(1_000)).toBe("00:01");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3 * 60_000 + 12_000)).toBe("03:12");
    expect(formatElapsed(-500)).toBe("00:00");
  });

  it("renders a progress bar of fixed width with the correct fill", () => {
    for (const state of [
      "PLACED",
      "PREPARING",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ] as const) {
      const bar = progressBar(state);
      expect(bar.length).toBe(BAR_WIDTH);
      const filled = countChar(bar, "█");
      const empty = countChar(bar, "░");
      expect(filled + empty).toBe(BAR_WIDTH);
      const expected = Math.round(STATE_FILL[state] * BAR_WIDTH);
      expect(filled).toBe(expected);
    }
  });
});

describe("Tracker — render", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows PREPARING state with elapsed clock and packing message", () => {
    const order = makeOrder("PREPARING");
    const { lastFrame, unmount } = render(
      <Tracker order={order} now={fixedClock(3 * 60_000 + 12_000)} />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("PREPARING");
    expect(frame).toContain("elapsed 03:12");
    expect(frame).toContain("Meghana Foods is packing your order.");
    // Progress bar: 35% × 25 = ~9 filled cells.
    const filledCells = countChar(frame, "█");
    expect(filledCells).toBe(Math.round(0.35 * BAR_WIDTH));
    // No rider line until OFD.
    expect(frame).not.toContain("Ramesh K");
    unmount();
  });

  it("shows the rider line on OUT_FOR_DELIVERY", () => {
    const order = makeOrder("OUT_FOR_DELIVERY");
    const { lastFrame, unmount } = render(
      <Tracker
        order={order}
        rider={rider}
        now={fixedClock(8 * 60_000)}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("OUT_FOR_DELIVERY");
    expect(frame).toContain("Rider: Ramesh K");
    expect(frame).toContain("1.8 km away");
    expect(frame).toContain("ETA 24 min");
    const filledCells = countChar(frame, "█");
    expect(filledCells).toBe(Math.round(0.7 * BAR_WIDTH));
    unmount();
  });

  it("swaps progress bar for the delivered marker when DELIVERED", () => {
    const order = makeOrder("DELIVERED");
    const { lastFrame, unmount } = render(
      <Tracker
        order={order}
        rider={rider}
        now={fixedClock(20 * 60_000)}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✔ delivered");
    // No progress bar characters when delivered.
    expect(countChar(frame, "█")).toBe(0);
    expect(countChar(frame, "░")).toBe(0);
    unmount();
  });

  it("shows PLACED with ~10% filled bar", () => {
    const order = makeOrder("PLACED");
    const { lastFrame, unmount } = render(
      <Tracker order={order} now={fixedClock(5_000)} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PLACED");
    expect(frame).toContain("elapsed 00:05");
    const filledCells = countChar(frame, "█");
    expect(filledCells).toBe(Math.round(0.1 * BAR_WIDTH));
    unmount();
  });
});
