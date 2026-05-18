import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { RestaurantList } from "../../src/tui/ui/render/restaurant-list.jsx";
import type { Restaurant } from "../../src/tui/ui/render/restaurant-list.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../fixtures/restaurants.json");

interface FixtureRestaurant {
  id: string;
  name: string;
  area: string;
  rating: number;
  etaMinutes: number;
  costForTwo: number;
}

function loadFixture(): Restaurant[] {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureRestaurant[];
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    rating: r.rating,
    etaMinutes: r.etaMinutes,
    costForTwo: r.costForTwo,
  }));
}

describe("RestaurantList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a numbered list with name, rating, ETA, cost", () => {
    const fixture = loadFixture().slice(0, 3);
    const { lastFrame, unmount } = render(<RestaurantList items={fixture} />);
    const frame = lastFrame() ?? "";

    // Each row gets an ordinal.
    expect(frame).toMatch(/1\./);
    expect(frame).toMatch(/2\./);
    expect(frame).toMatch(/3\./);

    // First fixture restaurant is Meghana Foods.
    expect(frame).toContain("Meghana Foods");
    expect(frame).toContain("Residency Road");

    // Rating, ETA, cost-for-two appear (with the star glyph).
    expect(frame).toContain("★ 4.5");
    expect(frame).toContain("~32 min");
    expect(frame).toContain("₹700/2");

    unmount();
  });

  it("truncates long restaurant names with an ellipsis", () => {
    const longName = "A".repeat(40);
    const items: Restaurant[] = [
      {
        id: "x",
        name: longName,
        area: "Somewhere",
        rating: 4.0,
        etaMinutes: 20,
        costForTwo: 200,
      },
    ];
    const { lastFrame, unmount } = render(<RestaurantList items={items} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("…");
    // The full 40-char name should NOT appear in full.
    expect(frame).not.toContain(longName);
    unmount();
  });

  it("renders an empty-state hint when items is empty", () => {
    const { lastFrame, unmount } = render(<RestaurantList items={[]} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no restaurants found");
    unmount();
  });

  it("respects startIndex for pagination", () => {
    const fixture = loadFixture().slice(0, 2);
    const { lastFrame, unmount } = render(
      <RestaurantList items={fixture} startIndex={10} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/10\./);
    expect(frame).toMatch(/11\./);
    unmount();
  });
});
