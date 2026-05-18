import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { SlotsView } from "../../src/tui/ui/render/slots.jsx";
import type { Slot, SlotsVenue } from "../../src/tui/ui/render/slots.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../fixtures/dineout.json");

interface FixtureWindow {
  id: string;
  label: string;
  capacity: number;
}
interface FixtureDay {
  date: string;
  windows: FixtureWindow[];
}
interface FixtureVenue {
  id: string;
  name: string;
  area: string;
  rating: number;
  costForTwo: number;
  slots: FixtureDay[];
}

function loadFirstVenue(): { venue: SlotsVenue; slots: Slot[]; date: string } {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureVenue[];
  const v = raw[0];
  if (!v) throw new Error("dineout fixture is empty");
  const day = v.slots[0];
  if (!day) throw new Error("first venue has no slots");
  return {
    venue: {
      id: v.id,
      name: v.name,
      area: v.area,
      rating: v.rating,
      costForTwo: v.costForTwo,
    },
    slots: day.windows.map((w) => ({
      id: w.id,
      label: w.label,
      capacity: w.capacity,
    })),
    date: day.date,
  };
}

describe("SlotsView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders venue header line and a row of slot times", () => {
    const { venue, slots, date } = loadFirstVenue();
    const { lastFrame, unmount } = render(
      <SlotsView venue={venue} slots={slots} date={date} />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("DO01");
    expect(frame).toContain("Toit Brewpub");
    expect(frame).toContain("★ 4.6");
    expect(frame).toContain("₹1500/2");
    // At least one time slot from the fixture.
    expect(frame).toContain("12:00");
    expect(frame).toContain("19:30");
    // The free-slots tally line.
    expect(frame).toMatch(/\d+ slots? free/);
    unmount();
  });

  it("dims booked-out slots but still renders their labels", () => {
    const venue: SlotsVenue = {
      id: "X01",
      name: "Test Venue",
      rating: 4.0,
      costForTwo: 500,
    };
    const slots: Slot[] = [
      { id: "s1", label: "19:00", capacity: 0 },
      { id: "s2", label: "19:30", capacity: 4 },
      { id: "s3", label: "20:00", capacity: 2 },
    ];
    const { lastFrame, unmount } = render(
      <SlotsView venue={venue} slots={slots} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("19:00");
    expect(frame).toContain("19:30");
    expect(frame).toContain("20:00");
    // 2 of 3 slots free.
    expect(frame).toContain("2 slots free");
    unmount();
  });

  it("renders an empty-state hint when no slots exist", () => {
    const venue: SlotsVenue = {
      id: "X01",
      name: "Test Venue",
      rating: 4.0,
      costForTwo: 500,
    };
    const { lastFrame, unmount } = render(
      <SlotsView venue={venue} slots={[]} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no slots available");
    expect(frame).toContain("0 slots free");
    unmount();
  });

  it("uses singular 'slot' when exactly 1 free", () => {
    const venue: SlotsVenue = {
      id: "X01",
      name: "Test Venue",
      rating: 4.0,
      costForTwo: 500,
    };
    const slots: Slot[] = [{ id: "s1", label: "19:00", capacity: 4 }];
    const { lastFrame, unmount } = render(
      <SlotsView venue={venue} slots={slots} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 slot free");
    unmount();
  });
});
