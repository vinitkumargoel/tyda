import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category?: string;
  isBestseller?: boolean;
  /** Optional ordering rank used to display "#N most ordered". */
  rank?: number;
  available?: boolean;
}

export interface PageInfo {
  page: number;
  totalPages: number;
  category?: string;
  /** Slash command stub to append for next page (e.g. "/menu 1"). */
  nextCommandPrefix?: string;
}

export interface MenuViewProps {
  restaurantName: string;
  menu: readonly MenuItem[];
  pageInfo?: PageInfo;
}

const INDENT = "  ";
/** Width of the ID column (e.g. "M01 "). */
const ID_WIDTH = 4;
/** Width of the name column. */
const NAME_WIDTH = 30;
/** Width of the price column, right-aligned. */
const PRICE_WIDTH = 8;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padStart(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

/**
 * Menu view. Renders:
 *
 *   restaurantName (page X/Y — category)
 *   M01  Chicken Biryani (Boneless)     ₹329   ★ #1 most ordered
 *   ...
 *   ... /menu 1 2  for next page
 */
export function MenuView({
  restaurantName,
  menu,
  pageInfo,
}: MenuViewProps): React.ReactElement {
  const headerSuffix = pageInfo
    ? `(page ${pageInfo.page}/${pageInfo.totalPages}${pageInfo.category ? ` — ${pageInfo.category}` : ""})`
    : "";

  const hasNext = pageInfo
    ? pageInfo.page < pageInfo.totalPages
    : false;

  return (
    <Box flexDirection="column">
      <Text>
        {INDENT}
        <Text color={theme.accent}>{restaurantName}</Text>
        {headerSuffix ? <Text dimColor>{` ${headerSuffix}`}</Text> : null}
      </Text>
      {menu.length === 0 ? (
        <Text dimColor>{INDENT}(no menu items)</Text>
      ) : (
        menu.map((item) => {
          const id = padEnd(item.id, ID_WIDTH);
          const name = padEnd(truncate(item.name, NAME_WIDTH - 1), NAME_WIDTH);
          const price = padStart(`₹${item.price}`, PRICE_WIDTH);
          const bestseller = item.isBestseller
            ? `★ #${item.rank ?? 1} most ordered`
            : "";
          const unavailable = item.available === false ? "⚠ unavailable" : "";
          return (
            <Text key={item.id}>
              {INDENT}
              <Text dimColor>{id}</Text> {name}
              <Text>{price}</Text>
              {bestseller ? (
                <Text dimColor>{`   ${bestseller}`}</Text>
              ) : null}
              {unavailable ? (
                <Text color={theme.error}>{`   ${unavailable}`}</Text>
              ) : null}
            </Text>
          );
        })
      )}
      {hasNext && pageInfo ? (
        <Text dimColor>
          {INDENT}...{" "}
          {pageInfo.nextCommandPrefix ?? "/menu"}{" "}
          {pageInfo.page + 1}
          {" for next page"}
        </Text>
      ) : null}
    </Box>
  );
}
