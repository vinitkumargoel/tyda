import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

/** Order lifecycle states surfaced to the tracker. Mirrors the sim. */
export type OrderState =
  | "PLACED"
  | "PREPARING"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface TrackerOrder {
  id: string;
  state: OrderState;
  /** Wall-clock ms or ISO string of when the order was first placed. */
  placedAt: number | string;
  restaurantName?: string;
}

export interface TrackerRider {
  name: string;
  distanceKm: number;
  etaMinutes: number;
}

export interface TrackerProps {
  order: TrackerOrder;
  rider?: TrackerRider;
  /**
   * Injectable clock for tests. Receives no args, returns wall-clock ms.
   * Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Tick interval (ms) for refreshing the elapsed clock. Defaults to
   * 1000 ms in production; tests should pass a large number or omit the
   * clock (since they only render once).
   */
  tickMs?: number;
}

/** Width of the progress bar in cells. */
export const BAR_WIDTH = 25;

/** Fill percentage per state. Used by both the bar and tests. */
export const STATE_FILL: Record<OrderState, number> = {
  PLACED: 0.1,
  PREPARING: 0.35,
  OUT_FOR_DELIVERY: 0.7,
  DELIVERED: 1.0,
  CANCELLED: 0,
};

const STATE_MESSAGE: Record<OrderState, (restaurantName?: string) => string> = {
  PLACED: (r) => `${r ?? "Restaurant"} has received your order.`,
  PREPARING: (r) => `${r ?? "Restaurant"} is packing your order.`,
  OUT_FOR_DELIVERY: () => "Your order is on the way.",
  DELIVERED: () => "Order delivered. Enjoy!",
  CANCELLED: () => "Order was cancelled.",
};

function placedAtMs(p: number | string): number {
  return typeof p === "number" ? p : Date.parse(p);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${pad2(mm)}:${pad2(ss)}`;
}

export function progressBar(state: OrderState, width = BAR_WIDTH): string {
  const pct = STATE_FILL[state];
  const filled = Math.round(pct * width);
  const empty = Math.max(0, width - filled);
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Sticky pinned tracker panel. The parent should mount this in the
 * pinned-tracker slot above the transcript and pass updated `order`
 * props as it polls `track_food_order` / `track_order`.
 *
 * Internal state: only the elapsed-time clock tick. All other data is
 * driven by props.
 */
export function Tracker({
  order,
  rider,
  now = Date.now,
  tickMs = 1000,
}: TrackerProps): React.ReactElement {
  const [nowMs, setNowMs] = useState<number>(() => now());

  useEffect(() => {
    if (order.state === "DELIVERED" || order.state === "CANCELLED") {
      return;
    }
    const handle = setInterval(() => {
      setNowMs(now());
    }, tickMs);
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      (handle as { unref: () => void }).unref();
    }
    return () => clearInterval(handle);
  }, [order.state, now, tickMs]);

  const elapsed = formatElapsed(nowMs - placedAtMs(order.placedAt));
  const message = STATE_MESSAGE[order.state](order.restaurantName);
  const showRider =
    rider && (order.state === "OUT_FOR_DELIVERY" || order.state === "DELIVERED");

  return (
    <Box flexDirection="column">
      {order.state === "DELIVERED" ? (
        <Text>
          {"  "}
          <Text color={theme.success}>✔ delivered</Text>{" "}
          <Text dimColor>elapsed {elapsed}</Text>
        </Text>
      ) : (
        <Text>
          {"  "}
          <Text color={theme.accent}>[{progressBar(order.state)}]</Text>{" "}
          <Text>{order.state}</Text>
          {"            "}
          <Text dimColor>elapsed {elapsed}</Text>
        </Text>
      )}
      <Text>
        {"  "}
        <Text dimColor>{message}</Text>
      </Text>
      {showRider && rider ? (
        <Text>
          {"  "}
          <Text>Rider: {rider.name}</Text>
          <Text dimColor>
            {"  • "}
            {rider.distanceKm.toFixed(1)} km away{"  • "}ETA {rider.etaMinutes}{" "}
            min
          </Text>
        </Text>
      ) : null}
    </Box>
  );
}
