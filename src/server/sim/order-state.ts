/**
 * Order lifecycle state machine.
 *
 * `advance()` is pure: given an order record and a wall-clock `now`, it returns
 * either the same record (no transition due) or the next record. `startTicker`
 * drives a registry of orders forward on a 1s interval, calling `onTick` with
 * the list of records whose state changed in that tick.
 */

export type OrderState = "PLACED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

export type DemoSpeed = "fast" | "real";

export interface TransitionTiming {
  /** Milliseconds spent in PLACED before moving to PREPARING. */
  placedMs: number;
  /** Milliseconds spent in PREPARING before moving to OUT_FOR_DELIVERY. */
  preparingMs: number;
  /** Milliseconds spent in OUT_FOR_DELIVERY before moving to DELIVERED. */
  ofdMs: number;
}

export const TRANSITIONS: Record<DemoSpeed, TransitionTiming> = {
  fast: { placedMs: 5_000, preparingMs: 10_000, ofdMs: 15_000 },
  real: { placedMs: 4 * 60_000, preparingMs: 8 * 60_000, ofdMs: 18 * 60_000 },
};

export interface OrderRecord {
  id: string;
  state: OrderState;
  /** Wall-clock ms at which the current state was entered. */
  stateStartedAt: number;
  /** Wall-clock ms at which the order was first PLACED. */
  placedAt: number;
  speed: DemoSpeed;
}

/**
 * Pure: advance an order to its next state if enough time has elapsed.
 *
 * Terminal states (DELIVERED, CANCELLED) are returned unchanged.
 * Multi-step jumps are supported in a single call (useful when the ticker has
 * been paused, or in tests with big time deltas).
 */
export function advance(order: OrderRecord, now: number): OrderRecord {
  const timing = TRANSITIONS[order.speed];
  let current = order;

  // Loop in case the elapsed delta crosses multiple thresholds at once.
  // Each iteration must make progress or break.
  for (;;) {
    if (current.state === "DELIVERED" || current.state === "CANCELLED") {
      return current;
    }
    const elapsed = now - current.stateStartedAt;
    let nextState: OrderState | null = null;
    let threshold = 0;
    if (current.state === "PLACED" && elapsed >= timing.placedMs) {
      nextState = "PREPARING";
      threshold = timing.placedMs;
    } else if (current.state === "PREPARING" && elapsed >= timing.preparingMs) {
      nextState = "OUT_FOR_DELIVERY";
      threshold = timing.preparingMs;
    } else if (current.state === "OUT_FOR_DELIVERY" && elapsed >= timing.ofdMs) {
      nextState = "DELIVERED";
      threshold = timing.ofdMs;
    }
    if (nextState === null) {
      return current;
    }
    current = {
      ...current,
      state: nextState,
      stateStartedAt: current.stateStartedAt + threshold,
    };
  }
}

/**
 * Public ticker API. Stateful but isolated; the clock is injected for tests.
 */
export interface OrderTicker {
  register(order: OrderRecord): void;
  cancel(id: string): void;
  stop(): void;
}

/**
 * Drive registered orders forward on a 1-second wall-clock interval.
 *
 * `getNow` is injectable so tests can run a fake clock. `onTick` is called
 * with the set of orders whose state changed during the tick. Cancelling an
 * order also emits it via `onTick` on the next tick.
 */
export function startTicker(
  getNow: () => number,
  onTick: (advanced: OrderRecord[]) => void,
  opts: { intervalMs?: number } = {},
): OrderTicker {
  const intervalMs = opts.intervalMs ?? 1000;
  const orders = new Map<string, OrderRecord>();
  const pendingCancels = new Set<string>();

  const handle = setInterval(() => {
    const now = getNow();
    const changed: OrderRecord[] = [];
    for (const [id, order] of orders) {
      if (pendingCancels.has(id)) {
        pendingCancels.delete(id);
        const cancelled: OrderRecord = {
          ...order,
          state: "CANCELLED",
          stateStartedAt: now,
        };
        orders.set(id, cancelled);
        changed.push(cancelled);
        continue;
      }
      const next = advance(order, now);
      if (next.state !== order.state) {
        orders.set(id, next);
        changed.push(next);
      }
    }
    if (changed.length > 0) {
      onTick(changed);
    }
  }, intervalMs);

  // Don't keep the Node event loop alive purely for the simulator.
  if (typeof handle.unref === "function") {
    handle.unref();
  }

  return {
    register(order: OrderRecord): void {
      orders.set(order.id, order);
    },
    cancel(id: string): void {
      const existing = orders.get(id);
      if (!existing) return;
      if (existing.state === "DELIVERED" || existing.state === "CANCELLED") return;
      pendingCancels.add(id);
    },
    stop(): void {
      clearInterval(handle);
      orders.clear();
      pendingCancels.clear();
    },
  };
}
