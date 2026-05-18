import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { setStateDir, mutate, loadState } from "../../src/server/store.js";
import { getAddresses } from "../../src/server/handlers/instamart/get_addresses.js";
import { createAddress } from "../../src/server/handlers/instamart/create_address.js";
import { deleteAddress } from "../../src/server/handlers/instamart/delete_address.js";
import { searchProducts } from "../../src/server/handlers/instamart/search_products.js";
import { yourGoToItems } from "../../src/server/handlers/instamart/your_go_to_items.js";
import { getCart } from "../../src/server/handlers/instamart/get_cart.js";
import { updateCart } from "../../src/server/handlers/instamart/update_cart.js";
import { clearCart } from "../../src/server/handlers/instamart/clear_cart.js";
import { checkout } from "../../src/server/handlers/instamart/checkout.js";
import { getOrders } from "../../src/server/handlers/instamart/get_orders.js";
import { getOrderDetails } from "../../src/server/handlers/instamart/get_order_details.js";
import { trackOrder } from "../../src/server/handlers/instamart/track_order.js";
import { reportError } from "../../src/server/handlers/instamart/report_error.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-im-"));
}

async function seedAddress(): Promise<string> {
  const r = await createAddress({
    addressLine: "1 MG Road",
    addressLine2: "Apt 4",
    city: "Bengaluru",
    postalCode: "560001",
    latitude: 12.9716,
    longitude: 77.5946,
    addressCategory: "HOME",
    userName: "tester",
    userPhone: "9999999999",
  });
  if (!r.success) throw new Error("seed failed");
  return r.data.address.id;
}

async function pickAvailableSpinId(addressId: string): Promise<string> {
  // Search through known categories until we get one with an available variant.
  for (const q of ["milk", "rice", "salt", "atta", "dal", "tomato"]) {
    const r = await searchProducts({ query: q, addressId });
    if (!r.success) continue;
    for (const p of r.data.products) {
      for (const v of p.variants) {
        if (v.available && v.stock > 0) return v.spinId;
      }
    }
  }
  throw new Error("no available spinId found");
}

describe("instamart handlers", () => {
  beforeEach(async () => {
    const dir = await tempDir();
    setStateDir(dir);
    await loadState();
  });

  it("create_address + get_addresses + delete_address round trip", async () => {
    const empty = await getAddresses();
    expect(empty.success).toBe(true);
    expect(empty.data.addresses).toHaveLength(0);

    const id = await seedAddress();
    expect(id).toMatch(/^addr_/);

    const list = await getAddresses();
    expect(list.data.addresses).toHaveLength(1);
    expect(list.data.addresses[0]!.id).toBe(id);

    const del = await deleteAddress({ addressId: id });
    expect(del.success).toBe(true);

    const finalList = await getAddresses();
    expect(finalList.data.addresses).toHaveLength(0);
  });

  it("delete_address on a missing id returns an error", async () => {
    const r = await deleteAddress({ addressId: "addr_nope" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe("ADDRESS_NOT_FOUND");
  });

  it("search_products returns paginated products marked with availability", async () => {
    const addressId = await seedAddress();
    const r = await searchProducts({ query: "milk", addressId, pageSize: 4 });
    expect(r.success).toBe(true);
    expect(r.data.products.length).toBeGreaterThan(0);
    for (const p of r.data.products) {
      for (const v of p.variants) {
        expect(typeof v.available).toBe("boolean");
      }
    }
  });

  it("your_go_to_items returns 6 items", async () => {
    const addressId = await seedAddress();
    const r = await yourGoToItems({ addressId });
    expect(r.success).toBe(true);
    expect(r.data.items).toHaveLength(6);
  });

  it("get_cart returns an empty cart with zero bill before any updates", async () => {
    const r = await getCart();
    expect(r.success).toBe(true);
    expect(r.data.cart.items).toEqual([]);
    expect(r.data.bill.total).toBe(0);
  });

  it("update_cart adds items, get_cart returns bill, clear_cart empties it", async () => {
    const addressId = await seedAddress();
    const spinId = await pickAvailableSpinId(addressId);

    const upd = await updateCart({
      selectedAddressId: addressId,
      items: [{ spinId, quantity: 2 }],
    });
    expect(upd.success).toBe(true);
    if (!upd.success) return;
    expect(upd.data.cart.items).toHaveLength(1);
    expect(upd.data.cart.items[0]!.quantity).toBe(2);
    expect(upd.data.bill.subtotal).toBeGreaterThan(0);

    const cart = await getCart();
    expect(cart.data.cart.items).toHaveLength(1);

    const cleared = await clearCart();
    expect(cleared.success).toBe(true);

    const after = await getCart();
    expect(after.data.cart.items).toEqual([]);
  });

  it("update_cart rejects an OOS variant with ITEM_UNAVAILABLE", async () => {
    const addressId = await seedAddress();
    // IP003-500g has stock: 0 in the fixtures.
    const r = await updateCart({
      selectedAddressId: addressId,
      items: [{ spinId: "IP003-500g", quantity: 1 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe("ITEM_UNAVAILABLE");
  });

  it("checkout places an order, get_orders + get_order_details + track_order all work", async () => {
    const addressId = await seedAddress();
    const spinId = await pickAvailableSpinId(addressId);
    await updateCart({
      selectedAddressId: addressId,
      items: [{ spinId, quantity: 1 }],
    });
    const co = await checkout({ addressId });
    expect(co.success).toBe(true);
    if (!co.success) return;
    expect(co.data.order.id).toMatch(/^IM-\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(co.data.order.etaMinutes).toBeGreaterThanOrEqual(10);
    expect(co.data.order.etaMinutes).toBeLessThanOrEqual(15);

    const orders = await getOrders({});
    expect(orders.data.orders.length).toBeGreaterThanOrEqual(1);

    const details = await getOrderDetails({ orderId: co.data.order.id });
    expect(details.success).toBe(true);

    const track = await trackOrder({ orderId: co.data.order.id });
    expect(track.success).toBe(true);
    if (!track.success) return;
    expect(track.data.orderId).toBe(co.data.order.id);
  });

  it("checkout fails when cart is empty", async () => {
    const addressId = await seedAddress();
    const r = await checkout({ addressId });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe("EMPTY_CART");
  });

  it("checkout fails on a missing address", async () => {
    const r = await checkout({ addressId: "addr_missing" });
    expect(r.success).toBe(false);
  });

  it("track_order returns ORDER_NOT_FOUND for unknown ids", async () => {
    const r = await trackOrder({ orderId: "IM-2000-01-01-9999" });
    expect(r.success).toBe(false);
  });

  it("get_order_details returns ORDER_NOT_FOUND for unknown ids", async () => {
    const r = await getOrderDetails({ orderId: "IM-2000-01-01-9999" });
    expect(r.success).toBe(false);
  });

  it("report_error returns a mailto URL", async () => {
    const r = await reportError({
      tool: "checkout",
      errorMessage: "boom",
    });
    expect(r.success).toBe(true);
    expect(r.data.mailtoUrl).toMatch(/^mailto:/);
  });

  it("auto-applies a coupon when cart total qualifies", async () => {
    const addressId = await seedAddress();
    // Build a cart well over ₹299 to trigger INSTAMART50.
    // IP007-5kg @ 795 is plenty.
    await updateCart({
      selectedAddressId: addressId,
      items: [{ spinId: "IP007-5kg", quantity: 1 }],
    });
    const cart = await getCart();
    expect(cart.data.bill.discount).toBeGreaterThan(0);
    expect(cart.data.bill.appliedCoupon).toBeTruthy();
  });

  it("persists addresses through the store", async () => {
    await seedAddress();
    const s = await mutate(() => {});
    expect(s.addresses.instamart).toHaveLength(1);
  });
});
