import { mutate } from "../../store.js";
import type { OkResponse } from "../../../shared/response.js";
import type { InstamartOrder } from "./_types.js";

export interface GetOrdersInput {
  count?: number;
  orderType?: string;
  activeOnly?: boolean;
}

export async function getOrders(
  args: GetOrdersInput = {},
): Promise<OkResponse<{ orders: InstamartOrder[] }>> {
  const count = args.count ?? 10;
  let orders: InstamartOrder[] = [];
  await mutate((s) => {
    orders = [...s.orders.instamart].reverse();
  });
  if (args.activeOnly) {
    orders = orders.filter(
      (o) => o.state !== "DELIVERED" && o.state !== "CANCELLED",
    );
  }
  return {
    success: true,
    data: { orders: orders.slice(0, count) },
    message: `Found ${orders.length} Instamart order(s).`,
  };
}
