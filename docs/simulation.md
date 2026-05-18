# Simulation rules

The mock isn't a static fixture server — it ticks. Orders progress through states over time,
the rider moves, inventory shifts, slot grids decay. This doc captures every rule so behavior
is reproducible.

All sim code lives under `src/server/sim/`. Pure functions with an injected clock; the HTTP
layer never reaches inside.

## Demo-speed vs real-speed clocks

The order ticker accepts a speed knob: `fast` (default; ~30 s end-to-end) or `real` (~30 min).
Set via:

```bash
npm run mock -- --demo-speed real
```

or in `~/.tyda-swiggy/config.yml`:

```yaml
swiggy:
  demo_speed: fast   # or "real"
```

All transition timings below scale with the speed setting.

## Order state machine

Every placed order has a `state` and `state_started_at`. A 1 s ticker advances state.

| From | To | Fast | Real |
| --- | --- | --- | --- |
| `PLACED` | `PREPARING` | 5 s | 4 min |
| `PREPARING` | `OUT_FOR_DELIVERY` | 10 s | 8 min |
| `OUT_FOR_DELIVERY` | `DELIVERED` | 15 s | 18 min |

Total: ~30 s in fast mode, ~30 min in real mode. `DELIVERED` is terminal. `CANCELLED` is also
terminal and reachable only via explicit cancel (not implemented in v1).

`tests/unit/sim-order-state.test.ts` exercises every transition.

## Driver tick

On `OUT_FOR_DELIVERY` entry the sim:

1. Picks a random nearby starting point near the restaurant.
2. Computes a heading toward the delivery address.
3. Initializes a `DriverState { name, lat, lng, distanceKm, eta }`.

Each subsequent tick advances `lat`/`lng` toward the destination at a constant speed and
recomputes `distanceKm` and `eta`. The `track_food_order` and `track_order` tools surface
`rider.name`, `rider.distance_km`, and `rider.eta_min` from this state.

`tests/unit/sim-driver.test.ts` asserts the driver actually closes the distance and the ETA
counts down.

## ETA

Initial ETA = `haversine(restaurant, address) / 25 kmh + prep_buffer` where `prep_buffer` is a
small constant per restaurant (5–8 min). This stays stable in `PLACED` and `PREPARING`, then
gets replaced by the driver's live ETA once `OUT_FOR_DELIVERY` begins.

See `src/server/sim/eta.ts` and `tests/unit/sim-eta.test.ts`.

## Instamart inventory (OOS)

Each Instamart SKU has a `stock` field. A daily reshuffler (deterministic with a fixed seed
during tests) marks roughly **5 % of SKUs as out of stock**. OOS items still appear in
`search_products` results, but the response sets `available: false` on the variant. The TUI
renders an `⚠ out of stock` indicator.

`tests/unit/sim-inventory.test.ts` pins the seed and asserts the distribution is stable.

## Dineout slot decay

Each Dineout restaurant has a 7-day slot grid. `book_table` decrements the slot count for the
chosen day/time. Subsequent `get_available_slots` reflects the decrement; once a slot count hits
zero it disappears from the response. This is what makes the Dineout demo feel like a real
booking system rather than a rubber stamp.

The slot grid is regenerated daily by the same reshuffler that handles inventory.

## Coupons

Coupons live in `fixtures/coupons.json`. Validation runs in `apply_food_coupon`.

| Code | Effect | Conditions |
| --- | --- | --- |
| `FLAT100` | Flat ₹100 off | None. |
| `BIRYANI20` | 20 % off | Cart must contain a biryani item. |
| `INSTAMART50` | ₹50 off | Instamart cart subtotal ≥ ₹299. |
| `FIRSTORDER` | ₹150 off | User has no completed orders yet. |

Stacking is not supported — one active coupon per cart. Re-applying a coupon replaces the prior
one.

## Multi-turn cart rules

- **Food carts** are keyed by `(user_id, restaurant_id)`. Switching restaurants while a cart
  exists makes the TUI prompt: "Switching restaurants will clear the cart. Continue?"
- **Instamart cart** is single-tenant (one cart per user across all SKUs).
- **Dineout cart** is single-use — `create_cart` then `book_table` and it's done.

## `report_error`

`report_error` is a real implementation, not a stub:

1. Captures the last N tool calls + their responses from the in-process log.
2. Appends a structured record to `~/.tyda-swiggy/error-log.json`.
3. Returns a pre-filled `mailto:` link in the shape Swiggy's spec describes, with the
   user-facing summary URL-encoded as the body.

Useful when something goes weird and you want to file a report without losing context. The
mailto opens in the user's default mail client; nothing is sent automatically.
