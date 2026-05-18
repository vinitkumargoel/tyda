/**
 * get_addresses — return Food-side saved addresses for the user.
 *
 * Seeds two default addresses (Home / Work) on the very first call so the
 * first-run TUI flow has something to pick from. Per spec: returns the
 * addresses sorted by `lastOrderAt` descending; addresses without an order
 * fall to the bottom in insertion order.
 */
import { mutate } from "../../store.js";
import type { HandlerContext, Address } from "./_types.js";
import { DEFAULT_FOOD_ADDRESSES } from "./_helpers.js";

export interface GetAddressesOutput {
  success: true;
  data: { addresses: Address[] };
  message?: string;
}

export default async function handle(
  _input: Record<string, never>,
  _ctx: HandlerContext,
): Promise<GetAddressesOutput> {
  const state = await mutate((s) => {
    if (s.addresses.food.length === 0) {
      s.addresses.food.push(...DEFAULT_FOOD_ADDRESSES);
    }
  });

  const sorted = [...state.addresses.food].sort((a, b) => {
    const ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
    const tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
    return tb - ta;
  });

  return {
    success: true,
    data: { addresses: sorted },
  };
}
