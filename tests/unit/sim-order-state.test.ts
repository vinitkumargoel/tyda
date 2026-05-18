import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TRANSITIONS,
  advance,
  startTicker,
  type OrderRecord,
} from "../../src/server/sim/order-state.js";

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    state: "PLACED",
    stateStartedAt: 0,
    placedAt: 0,
    speed: "fast",
    ...overrides,
  };
}

describe("advance (pure)", () => {
  it("returns same record when not enough time has elapsed", () => {
    const o = makeOrder({ stateStartedAt: 0 });
    const r = advance(o, 1000); // < 5_000ms PLACED threshold
    expect(r.state).toBe("PLACED");
    expect(r).toBe(o); // object identity preserved (no allocation)
  });

  it("transitions PLACED -> PREPARING at the threshold", () => {
    const o = makeOrder({ stateStartedAt: 0 });
    const r = advance(o, TRANSITIONS.fast.placedMs);
    expect(r.state).toBe("PREPARING");
    expect(r.stateStartedAt).toBe(TRANSITIONS.fast.placedMs);
  });

  it("walks through all transitions when given a big delta", () => {
    const o = makeOrder({ stateStartedAt: 0 });
    const total =
      TRANSITIONS.fast.placedMs + TRANSITIONS.fast.preparingMs + TRANSITIONS.fast.ofdMs;
    const r = advance(o, total);
    expect(r.state).toBe("DELIVERED");
  });

  it("is idempotent for DELIVERED", () => {
    const o = makeOrder({ state: "DELIVERED", stateStartedAt: 0 });
    const r = advance(o, 10_000_000);
    expect(r).toBe(o);
  });

  it("is idempotent for CANCELLED", () => {
    const o = makeOrder({ state: "CANCELLED", stateStartedAt: 0 });
    const r = advance(o, 10_000_000);
    expect(r).toBe(o);
  });

  it("respects the 'real' speed timing", () => {
    const o = makeOrder({ speed: "real", stateStartedAt: 0 });
    // Just below the 4-minute threshold should NOT transition.
    const stayed = advance(o, TRANSITIONS.real.placedMs - 1);
    expect(stayed.state).toBe("PLACED");
    const moved = advance(o, TRANSITIONS.real.placedMs);
    expect(moved.state).toBe("PREPARING");
  });
});

describe("startTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onTick exactly when state changes", () => {
    let now = 0;
    const onTick = vi.fn();
    const ticker = startTicker(() => now, onTick);
    ticker.register(makeOrder({ stateStartedAt: 0 }));

    // Tick #1 at 1s: no transition (PLACED threshold is 5s in fast mode).
    now = 1_000;
    vi.advanceTimersByTime(1_000);
    expect(onTick).not.toHaveBeenCalled();

    // Tick at 5s: transition to PREPARING.
    now = 5_000;
    vi.advanceTimersByTime(4_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[0]![0][0].state).toBe("PREPARING");

    // Tick at 6s: still PREPARING (threshold 10s) — no call.
    now = 6_000;
    vi.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenCalledTimes(1);

    ticker.stop();
  });

  it("cancel() transitions to CANCELLED on the next tick", () => {
    let now = 0;
    const onTick = vi.fn();
    const ticker = startTicker(() => now, onTick);
    ticker.register(makeOrder({ stateStartedAt: 0 }));

    ticker.cancel("o1");
    now = 1_000;
    vi.advanceTimersByTime(1_000);

    expect(onTick).toHaveBeenCalledTimes(1);
    const emitted = onTick.mock.calls[0]![0][0];
    expect(emitted.state).toBe("CANCELLED");
    expect(emitted.stateStartedAt).toBe(1_000);

    ticker.stop();
  });

  it("cancel() on an unknown id is a no-op", () => {
    const onTick = vi.fn();
    const ticker = startTicker(() => 0, onTick);
    expect(() => ticker.cancel("does-not-exist")).not.toThrow();
    ticker.stop();
  });

  it("stop() prevents further ticks", () => {
    let now = 0;
    const onTick = vi.fn();
    const ticker = startTicker(() => now, onTick);
    ticker.register(makeOrder({ stateStartedAt: 0 }));
    ticker.stop();

    now = 60_000;
    vi.advanceTimersByTime(60_000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("walks an order all the way to DELIVERED", () => {
    let now = 0;
    const ticks: string[] = [];
    const ticker = startTicker(
      () => now,
      (advanced) => {
        for (const o of advanced) ticks.push(o.state);
      },
    );
    ticker.register(makeOrder({ stateStartedAt: 0 }));

    const total =
      TRANSITIONS.fast.placedMs + TRANSITIONS.fast.preparingMs + TRANSITIONS.fast.ofdMs;
    // Step the clock forward in 1s slices so the ticker sees realistic deltas.
    for (let elapsed = 1_000; elapsed <= total + 1_000; elapsed += 1_000) {
      now = elapsed;
      vi.advanceTimersByTime(1_000);
    }

    expect(ticks[ticks.length - 1]).toBe("DELIVERED");
    expect(ticks).toContain("PREPARING");
    expect(ticks).toContain("OUT_FOR_DELIVERY");

    ticker.stop();
  });
});
