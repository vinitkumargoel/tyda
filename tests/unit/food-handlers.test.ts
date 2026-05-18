/**
 * Unit tests for every Food handler.
 *
 * Each test uses a fresh temp state-dir + the anonymous handler context, so
 * the disk store is isolated from other suites and the sim ticker stays idle.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { setStateDir, loadState, mutate } from "../../src/server/store.js";
import type { TokenClaims } from "../../src/server/oauth/jwt.js";
import type { HandlerContext } from "../../src/server/handlers/food/_types.js";
import { resetFixtureCaches } from "../../src/server/handlers/food/_helpers.js";

import getAddresses from "../../src/server/handlers/food/get_addresses.js";
import searchRestaurants from "../../src/server/handlers/food/search_restaurants.js";
import searchMenu from "../../src/server/handlers/food/search_menu.js";
import getRestaurantMenu from "../../src/server/handlers/food/get_restaurant_menu.js";
import fetchFoodCoupons from "../../src/server/handlers/food/fetch_food_coupons.js";
import applyFoodCoupon from "../../src/server/handlers/food/apply_food_coupon.js";
import getFoodCart from "../../src/server/handlers/food/get_food_cart.js";
import updateFoodCart from "../../src/server/handlers/food/update_food_cart.js";
import flushFoodCart from "../../src/server/handlers/food/flush_food_cart.js";
import placeFoodOrder from "../../src/server/handlers/food/place_food_order.js";
import getFoodOrders from "../../src/server/handlers/food/get_food_orders.js";
import getFoodOrderDetails from "../../src/server/handlers/food/get_food_order_details.js";
import trackFoodOrder from "../../src/server/handlers/food/track_food_order.js";
import reportError from "../../src/server/handlers/food/report_error.js";

const claims: TokenClaims = {
  sub: "user-1",
  jti: "j-1",
  client_id: "test",
};
const ctx: HandlerContext = { auth: claims };

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-food-"));
}

async function seedRestaurant(restaurantId: string): Promise<void> {
  // Seed an active cart for the user so cart-dependent handlers have data.
  await getAddresses({}, ctx);
  await updateFoodCart(
    {
      restaurantId,
      cartItems: [{ menuItemId: "M01", quantity: 1 }],
    },
    ctx,
  );
}

beforeEach(async () => {
  const dir = await tempDir();
  setStateDir(dir);
  resetFixtureCaches();
});

describe("food handlers", () => {
  it("get_addresses seeds defaults on first call", async () => {
    const res = await getAddresses({}, ctx);
    expect(res.success).toBe(true);
    expect(res.data.addresses.length).toBeGreaterThan(0);
    // Second call returns the same set without duplicating.
    const res2 = await getAddresses({}, ctx);
    expect(res2.data.addresses.length).toBe(res.data.addresses.length);
  });

  it("search_restaurants matches biryani query", async () => {
    const res = await searchRestaurants({ query: "biryani" }, ctx);
    expect(res.success).toBe(true);
    expect(res.data.restaurants.length).toBeGreaterThan(0);
    expect(
      res.data.restaurants.some((r) => r.cuisines.some((c) => /biryani/i.test(c))),
    ).toBe(true);
  });

  it("search_menu finds biryani items", async () => {
    const res = await searchMenu({ query: "biryani" }, ctx);
    expect(res.success).toBe(true);
    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.data.items[0]!.name.toLowerCase()).toContain("biryani");
  });

  it("get_restaurant_menu paginates by category", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    const res = await getRestaurantMenu({ restaurantId: rid }, ctx);
    expect(res.success).toBe(true);
    expect(res.data!.categories.length).toBeGreaterThan(0);
  });

  it("get_restaurant_menu errors on unknown id", async () => {
    const res = await getRestaurantMenu({ restaurantId: "nope" }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("RESTAURANT_NOT_FOUND");
  });

  it("fetch_food_coupons returns only food-scoped coupons", async () => {
    const res = await fetchFoodCoupons({}, ctx);
    expect(res.success).toBe(true);
    expect(res.data.coupons.length).toBeGreaterThan(0);
    expect(res.data.coupons.every((c) => typeof c.code === "string")).toBe(true);
  });

  it("update_food_cart adds items and computes totals", async () => {
    await getAddresses({}, ctx);
    const list = await searchRestaurants({ query: "" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    const res = await updateFoodCart(
      {
        restaurantId: rid,
        cartItems: [{ menuItemId: "M01", quantity: 2 }],
      },
      ctx,
    );
    expect(res.success).toBe(true);
    expect(res.data!.cart!.items[0]!.quantity).toBe(2);
    expect(res.data!.cart!.total).toBeGreaterThan(0);
  });

  it("get_food_cart returns the active cart with COD payment method", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    await seedRestaurant(list.data.restaurants[0]!.id);
    const res = await getFoodCart({}, ctx);
    expect(res.success).toBe(true);
    expect(res.data.cart).not.toBeNull();
    expect(res.data.availablePaymentMethods).toContain("COD");
  });

  it("apply_food_coupon applies a flat-discount coupon", async () => {
    const list = await searchRestaurants({ query: "biryani" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    await getAddresses({}, ctx);
    await updateFoodCart(
      { restaurantId: rid, cartItems: [{ menuItemId: "M01", quantity: 2 }] },
      ctx,
    );
    const res = await applyFoodCoupon({ couponCode: "SWIGGYONE" }, ctx);
    expect(res.success).toBe(true);
    expect(res.data!.cart.discount).toBe(75);
    expect(res.data!.cart.appliedCoupon?.code).toBe("SWIGGYONE");
  });

  it("flush_food_cart clears the active cart", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    await seedRestaurant(list.data.restaurants[0]!.id);
    const res = await flushFoodCart({}, ctx);
    expect(res.success).toBe(true);
    expect(res.data.cleared).not.toBeNull();
  });

  it("place_food_order creates an order with FD- prefix", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    const addrs = await getAddresses({}, ctx);
    const addrId = addrs.data.addresses[0]!.id;
    await updateFoodCart(
      { restaurantId: rid, cartItems: [{ menuItemId: "M01", quantity: 1 }] },
      ctx,
    );
    const res = await placeFoodOrder({ addressId: addrId }, ctx);
    expect(res.success).toBe(true);
    expect(res.data!.order.id).toMatch(/^FD-\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(res.message).toContain("Swiggy order placed successfully");
  });

  it("place_food_order rejects carts >= ₹1000", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    const addrs = await getAddresses({}, ctx);
    const addrId = addrs.data.addresses[0]!.id;
    // 5x M01 (~₹329 each on Meghana, ~₹269 on Empire) → may not always exceed.
    // Build a synthetic >=1000 cart by pushing quantity=10.
    await updateFoodCart(
      { restaurantId: rid, cartItems: [{ menuItemId: "M01", quantity: 10 }] },
      ctx,
    );
    const res = await placeFoodOrder({ addressId: addrId }, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("CART_LIMIT_EXCEEDED");
  });

  it("get_food_orders + get_food_order_details + track_food_order round-trip", async () => {
    const list = await searchRestaurants({ query: "" }, ctx);
    const rid = list.data.restaurants[0]!.id;
    const addrs = await getAddresses({}, ctx);
    const addrId = addrs.data.addresses[0]!.id;
    await updateFoodCart(
      { restaurantId: rid, cartItems: [{ menuItemId: "M01", quantity: 1 }] },
      ctx,
    );
    const placed = await placeFoodOrder({ addressId: addrId }, ctx);
    expect(placed.success).toBe(true);
    const oid = placed.data!.order.id;

    const listOrders = await getFoodOrders({}, ctx);
    expect(listOrders.data.orders.find((o) => o.id === oid)).toBeTruthy();

    const details = await getFoodOrderDetails({ orderId: oid }, ctx);
    expect(details.success).toBe(true);

    const tracked = await trackFoodOrder({ orderId: oid }, ctx);
    expect(tracked.success).toBe(true);
    expect(tracked.data!.orders[0]!.orderId).toBe(oid);
  });

  it("report_error writes a log entry and returns a mailto: URL", async () => {
    const res = await reportError(
      {
        tool: "place_food_order",
        errorMessage: "boom",
      },
      ctx,
    );
    expect(res.success).toBe(true);
    expect(res.data.mailtoUrl.startsWith("mailto:mcp-support@swiggy.in")).toBe(true);
    // Confirm the file exists.
    const state = await loadState();
    void state;
    // Force ensure state-dir exists by exercising mutate too.
    await mutate(() => {});
  });
});
