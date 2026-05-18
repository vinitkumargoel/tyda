import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";
import type { InstamartOrder } from "./_types.js";

export async function getOrderDetails(args: {
  orderId: string;
}): Promise<OkResponse<{ order: InstamartOrder }> | ErrResponse> {
  let order: InstamartOrder | null = null;
  await mutate((s) => {
    order = s.orders.instamart.find((o) => o.id === args.orderId) ?? null;
  });
  if (!order) {
    return {
      success: false,
      error: {
        code: "ORDER_NOT_FOUND",
        message: `No Instamart order found with id ${args.orderId}`,
      },
    };
  }
  return {
    success: true,
    data: { order },
    message: `Order ${args.orderId} — ${(order as InstamartOrder).state}.`,
  };
}
