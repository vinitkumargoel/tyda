import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";

import { CartView } from "../../src/tui/ui/render/cart.jsx";
import type { CartViewModel } from "../../src/tui/ui/render/cart.jsx";

const foodCart: CartViewModel = {
  restaurantName: "Meghana Foods",
  items: [
    { name: "Chicken Biryani (Boneless)", quantity: 2, lineTotal: 658 },
  ],
  deliveryFee: 39,
  platformFee: 6,
  subtotal: 703,
};

const foodCartWithCoupon: CartViewModel = {
  ...foodCart,
  appliedCoupon: { code: "FLAT100", discount: 100 },
  subtotal: 603,
};

const instamartCartFreeDelivery: CartViewModel = {
  items: [
    { name: "Amul Taaza Toned Milk — 1 L", quantity: 1, lineTotal: 58 },
    { name: "Aashirvaad Atta — 5 kg", quantity: 1, lineTotal: 295 },
  ],
  deliveryFee: 0,
  handlingFee: 9,
  subtotal: 362,
};

describe("CartView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a food cart with items, delivery, platform, subtotal", () => {
    const { lastFrame, unmount } = render(
      <CartView cart={foodCart} kind="food" />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Meghana Foods");
    expect(frame).toContain("2× Chicken Biryani (Boneless)");
    expect(frame).toContain("₹658");
    expect(frame).toContain("Delivery fee");
    expect(frame).toContain("₹39");
    expect(frame).toContain("Platform fee");
    expect(frame).toContain("₹6");
    expect(frame).toContain("Subtotal");
    expect(frame).toContain("₹703");
    // Divider line uses the theme dash character.
    expect(frame).toContain("─");
    // Coupon hint when no coupon applied.
    expect(frame).toContain("/coupon");
    unmount();
  });

  it("shows the applied coupon row and hides the coupon hint", () => {
    const { lastFrame, unmount } = render(
      <CartView cart={foodCartWithCoupon} kind="food" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Coupon FLAT100");
    expect(frame).toContain("−₹100");
    expect(frame).not.toContain("Apply coupon");
    unmount();
  });

  it("renders an instamart cart with handling fee and FREE delivery", () => {
    const { lastFrame, unmount } = render(
      <CartView cart={instamartCartFreeDelivery} kind="instamart" />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("1× Amul Taaza Toned Milk — 1 L");
    expect(frame).toContain("Delivery fee");
    expect(frame).toContain("FREE");
    expect(frame).toContain("Handling fee");
    expect(frame).toContain("₹9");
    // Instamart should NOT show the food platform fee label.
    expect(frame).not.toContain("Platform fee");
    // Instamart should NOT show the food coupon hint.
    expect(frame).not.toContain("/coupon");
    unmount();
  });

  it("renders an empty-state when there are no items", () => {
    const empty: CartViewModel = {
      items: [],
      subtotal: 0,
    };
    const { lastFrame, unmount } = render(
      <CartView cart={empty} kind="food" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("cart is empty");
    unmount();
  });
});
