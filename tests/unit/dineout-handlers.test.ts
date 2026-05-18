import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setStateDir, loadState } from "../../src/server/store.js";
import {
  resetVenuesCache,
  resetCartsForTests,
  loadVenues,
  findSlot,
} from "../../src/server/handlers/dineout/_helpers.js";
import { getSavedLocations } from "../../src/server/handlers/dineout/get_saved_locations.js";
import { searchRestaurantsDineout } from "../../src/server/handlers/dineout/search_restaurants_dineout.js";
import { getRestaurantDetails } from "../../src/server/handlers/dineout/get_restaurant_details.js";
import { getAvailableSlots } from "../../src/server/handlers/dineout/get_available_slots.js";
import { createCart } from "../../src/server/handlers/dineout/create_cart.js";
import { bookTable } from "../../src/server/handlers/dineout/book_table.js";
import { getBookingStatus } from "../../src/server/handlers/dineout/get_booking_status.js";
import { reportError } from "../../src/server/handlers/dineout/report_error.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-dineout-"));
}

async function setup(): Promise<void> {
  const dir = await tempDir();
  setStateDir(dir);
  await loadState();
  resetVenuesCache();
  resetCartsForTests();
}

const TOIT = "DO01";
const TOIT_DAY = "2026-05-18";

async function pickSlot(restaurantId: string, date: string): Promise<string> {
  const venues = await loadVenues();
  const v = venues.find((x) => x.id === restaurantId)!;
  const day = v.slots.find((d) => d.date === date)!;
  return day.windows[0]!.id;
}

describe("dineout handlers", () => {
  beforeEach(async () => {
    await setup();
  });

  it("get_saved_locations returns preset Bangalore areas when state is empty", async () => {
    const res = await getSavedLocations({});
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.locations.length).toBeGreaterThanOrEqual(3);
    expect(res.data.locations[0]!.addressLine.toLowerCase()).toContain("indiranagar");
  });

  it("search_restaurants_dineout returns venues with paging", async () => {
    const res = await searchRestaurantsDineout({ query: "bangalore" });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.results.length).toBeGreaterThan(0);
    expect(res.data.pageSize).toBe(5);
    expect(res.data.results[0]!.restaurantId).toMatch(/^DO/);
  });

  it("search_restaurants_dineout matches by cuisine substring", async () => {
    const res = await searchRestaurantsDineout({ query: "Coastal" });
    expect(res.success).toBe(true);
    if (!res.success) return;
    // Karavalli is coastal cuisine in the fixture.
    expect(res.data.results.some((r) => r.name.toLowerCase().includes("karavalli"))).toBe(true);
  });

  it("get_restaurant_details returns full venue", async () => {
    const res = await getRestaurantDetails({ restaurantId: TOIT });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.name).toMatch(/Toit/);
    expect(res.data.deals.length).toBeGreaterThan(0);
    expect(res.data.deals[0]!.isFree).toBe(true);
  });

  it("get_restaurant_details errors on unknown id", async () => {
    const res = await getRestaurantDetails({ restaurantId: "NOPE" });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe("RESTAURANT_NOT_FOUND");
  });

  it("get_available_slots returns just the requested day", async () => {
    const res = await getAvailableSlots({ restaurantId: TOIT, date: TOIT_DAY });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.days).toHaveLength(1);
    expect(res.data.days[0]!.dateStr).toBe(TOIT_DAY);
    expect(res.data.days[0]!.slots.length).toBeGreaterThan(0);
    expect(res.data.days[0]!.slots[0]!.slotGroupName).toBeDefined();
  });

  it("get_available_slots returns 7 days when no date filter", async () => {
    const res = await getAvailableSlots({ restaurantId: TOIT });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.days.length).toBeGreaterThanOrEqual(7);
  });

  it("create_cart enforces free deals (billToPay=0, skipPayment=true)", async () => {
    const slotId = await pickSlot(TOIT, TOIT_DAY);
    const res = await createCart({
      restaurantId: TOIT,
      slotId,
      guestCount: 2,
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.billToPay).toBe(0);
    expect(res.data.skipPayment).toBe(true);
    expect(res.data.cartType).toBe("DEAL_TICKET_PURCHASE");
    expect(res.data.cartId).toMatch(/^cart_/);
  });

  it("create_cart rejects unknown slot", async () => {
    const res = await createCart({
      restaurantId: TOIT,
      slotId: "DO01-9999-99-99-00-00",
      guestCount: 2,
    });
    expect(res.success).toBe(false);
  });

  it("book_table decrements slot capacity and writes a CONFIRMED booking", async () => {
    const slotId = await pickSlot(TOIT, TOIT_DAY);
    const venuesBefore = await loadVenues();
    const before = findSlot(venuesBefore.find((v) => v.id === TOIT)!, slotId)!.slot.capacity;
    expect(before).toBeGreaterThan(0);

    const res = await bookTable({
      restaurantId: TOIT,
      slotId,
      guestCount: 3,
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe("CONFIRMED");
    expect(res.data.orderId).toMatch(/^DO-\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(res.data.guestCount).toBe(3);

    const venuesAfter = await loadVenues();
    const after = findSlot(venuesAfter.find((v) => v.id === TOIT)!, slotId)!.slot.capacity;
    expect(after).toBe(before - 1);
  });

  it("book_table consumes a cartId from create_cart", async () => {
    const slotId = await pickSlot(TOIT, TOIT_DAY);
    const cart = await createCart({ restaurantId: TOIT, slotId, guestCount: 2 });
    expect(cart.success).toBe(true);
    if (!cart.success) return;

    const res = await bookTable({ cartId: cart.data.cartId });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.orderId).toMatch(/^DO-\d{4}-\d{2}-\d{2}-\d{4}$/);

    // The same cartId cannot be reused.
    const res2 = await bookTable({ cartId: cart.data.cartId });
    expect(res2.success).toBe(false);
  });

  it("book_table returns SLOT_FULL when capacity is exhausted", async () => {
    const slotId = await pickSlot(TOIT, TOIT_DAY);
    const venues = await loadVenues();
    const venue = venues.find((v) => v.id === TOIT)!;
    const slot = findSlot(venue, slotId)!.slot;
    // Drain capacity manually so the next book_table call hits 0.
    slot.capacity = 0;

    const res = await bookTable({ restaurantId: TOIT, slotId, guestCount: 2 });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe("SLOT_FULL");
  });

  it("get_booking_status returns the booking by orderId", async () => {
    const slotId = await pickSlot(TOIT, TOIT_DAY);
    const booked = await bookTable({ restaurantId: TOIT, slotId, guestCount: 2 });
    expect(booked.success).toBe(true);
    if (!booked.success) return;

    const status = await getBookingStatus({ orderId: booked.data.orderId });
    expect(status.success).toBe(true);
    if (!status.success) return;
    expect(status.data.orderId).toBe(booked.data.orderId);
    expect(status.data.status).toBe("CONFIRMED");
  });

  it("get_booking_status returns BOOKING_NOT_FOUND for unknown id", async () => {
    const status = await getBookingStatus({ orderId: "DO-9999-99-99-9999" });
    expect(status.success).toBe(false);
    if (status.success) return;
    expect(status.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("report_error returns a mailto link and summary", async () => {
    const res = await reportError({
      tool: "book_table",
      errorMessage: "slot was full",
      toolContext: { restaurantId: TOIT, slotId: "DO01-2026-05-18-19-00" },
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.mailto).toMatch(/^mailto:/);
    expect(res.data.summary).toMatch(/slot was full/);
  });
});
