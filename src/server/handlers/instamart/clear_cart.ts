import { mutate } from "../../store.js";
import type { OkResponse } from "../../../shared/response.js";
import { emptyCart } from "./_helpers.js";
import { CART_KEY } from "./get_cart.js";

export async function clearCart(): Promise<OkResponse<{ cleared: true }>> {
  await mutate((s) => {
    s.carts.instamart[CART_KEY] = emptyCart();
  });
  return {
    success: true,
    data: { cleared: true },
    message: "Instamart cart cleared.",
  };
}
