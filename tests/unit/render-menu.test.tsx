import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MenuView } from "../../src/tui/ui/render/menu.jsx";
import type { MenuItem } from "../../src/tui/ui/render/menu.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../fixtures/restaurants.json");

interface FixtureMenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  isBestseller: boolean;
  available: boolean;
}

interface FixtureRestaurant {
  name: string;
  menu: FixtureMenuItem[];
}

function loadMeghanaMenu(): { restaurantName: string; menu: MenuItem[] } {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureRestaurant[];
  const r = raw[0];
  if (!r) throw new Error("fixture has no restaurants");
  let rank = 0;
  return {
    restaurantName: r.name,
    menu: r.menu.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      category: m.category,
      isBestseller: m.isBestseller,
      available: m.available,
      rank: m.isBestseller ? ++rank : undefined,
    })),
  };
}

describe("MenuView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders restaurant header, item rows, and bestseller marker", () => {
    const { restaurantName, menu } = loadMeghanaMenu();
    const { lastFrame, unmount } = render(
      <MenuView
        restaurantName={restaurantName}
        menu={menu.slice(0, 4)}
        pageInfo={{ page: 1, totalPages: 3, category: "Biryani" }}
      />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Meghana Foods");
    expect(frame).toContain("(page 1/3 — Biryani)");
    expect(frame).toContain("M01");
    expect(frame).toContain("Chicken Biryani (Boneless)");
    expect(frame).toContain("₹329");
    // Bestseller marker has a star and ordering rank.
    expect(frame).toContain("★ #1 most ordered");
    unmount();
  });

  it("shows a next-page hint when more pages remain", () => {
    const { restaurantName, menu } = loadMeghanaMenu();
    const { lastFrame, unmount } = render(
      <MenuView
        restaurantName={restaurantName}
        menu={menu}
        pageInfo={{
          page: 1,
          totalPages: 3,
          category: "Biryani",
          nextCommandPrefix: "/menu 1",
        }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/menu 1");
    expect(frame).toContain("for next page");
    unmount();
  });

  it("omits the next-page hint on the final page", () => {
    const { restaurantName, menu } = loadMeghanaMenu();
    const { lastFrame, unmount } = render(
      <MenuView
        restaurantName={restaurantName}
        menu={menu.slice(0, 2)}
        pageInfo={{ page: 3, totalPages: 3, category: "Biryani" }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("for next page");
    unmount();
  });

  it("renders an empty-state hint when menu is empty", () => {
    const { lastFrame, unmount } = render(
      <MenuView restaurantName="Test" menu={[]} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no menu items");
    unmount();
  });
});
