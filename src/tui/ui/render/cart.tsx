import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface CartLineItem {
  name: string;
  quantity: number;
  lineTotal: number;
}

export interface AppliedCouponView {
  code: string;
  /** Signed discount amount (positive number, subtracted from subtotal). */
  discount: number;
}

export interface CartViewModel {
  restaurantName?: string;
  items: readonly CartLineItem[];
  /** Optional delivery fee. If undefined, the row is omitted. */
  deliveryFee?: number;
  /** Food only — platform fee. */
  platformFee?: number;
  /** Instamart only — handling fee. */
  handlingFee?: number;
  /** Subtotal of items + fees − discount. Matches server's `total`. */
  subtotal: number;
  appliedCoupon?: AppliedCouponView;
}

export interface CartViewProps {
  cart: CartViewModel;
  kind: "food" | "instamart";
}

const INDENT = "  ";
/** Width of the description column (everything left of the price). */
const DESC_WIDTH = 36;
/** Width of the price column, right-aligned. */
const PRICE_WIDTH = 8;
/** Width of the divider line. */
const DIVIDER_WIDTH = DESC_WIDTH + PRICE_WIDTH;

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padStart(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function rupees(n: number): string {
  return `₹${n}`;
}

interface RowProps {
  label: string;
  value: string;
  dim?: boolean;
}

function Row({ label, value, dim }: RowProps): React.ReactElement {
  const left = padEnd(label, DESC_WIDTH);
  const right = padStart(value, PRICE_WIDTH);
  return (
    <Text>
      {INDENT}
      {dim ? <Text dimColor>{left}</Text> : <Text>{left}</Text>}
      {dim ? <Text dimColor>{right}</Text> : <Text>{right}</Text>}
    </Text>
  );
}

/**
 * Cart view. One row per line item, then fees, divider, subtotal,
 * optional coupon hint. `kind="instamart"` substitutes "Handling fee"
 * for "Platform fee" and renders "FREE" when delivery is waived.
 */
export function CartView({ cart, kind }: CartViewProps): React.ReactElement {
  const divider = theme.divider.repeat(DIVIDER_WIDTH);

  return (
    <Box flexDirection="column">
      {cart.restaurantName ? (
        <Text>
          {INDENT}
          <Text color={theme.accent}>{cart.restaurantName}</Text>
        </Text>
      ) : null}
      {cart.items.length === 0 ? (
        <Text dimColor>{INDENT}(cart is empty)</Text>
      ) : (
        cart.items.map((item, i) => (
          <Row
            key={`${item.name}-${i}`}
            label={`${item.quantity}× ${item.name}`}
            value={rupees(item.lineTotal)}
          />
        ))
      )}
      {typeof cart.deliveryFee === "number" ? (
        <Row
          label="Delivery fee"
          value={
            kind === "instamart" && cart.deliveryFee === 0
              ? "FREE"
              : rupees(cart.deliveryFee)
          }
        />
      ) : null}
      {kind === "food" && typeof cart.platformFee === "number" ? (
        <Row label="Platform fee" value={rupees(cart.platformFee)} />
      ) : null}
      {kind === "instamart" && typeof cart.handlingFee === "number" ? (
        <Row label="Handling fee" value={rupees(cart.handlingFee)} />
      ) : null}
      {cart.appliedCoupon ? (
        <Row
          label={`Coupon ${cart.appliedCoupon.code}`}
          value={`−${rupees(cart.appliedCoupon.discount)}`}
        />
      ) : null}
      <Text>
        {INDENT}
        <Text dimColor>{divider}</Text>
      </Text>
      <Row label="Subtotal" value={rupees(cart.subtotal)} />
      {!cart.appliedCoupon && kind === "food" && cart.items.length > 0 ? (
        <Text dimColor>{INDENT}Apply coupon: try /coupon FLAT100</Text>
      ) : null}
    </Box>
  );
}
