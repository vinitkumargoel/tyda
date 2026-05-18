import { mutate } from "../../store.js";
import type { OkResponse } from "../../../shared/response.js";
import {
  computeBill,
  emptyCart,
  loadInstamartCoupons,
} from "./_helpers.js";
import type { InstamartBill, InstamartCart } from "./_types.js";

const CART_KEY = "active";

export async function getCart(): Promise<
  OkResponse<{
    cart: InstamartCart;
    bill: InstamartBill;
    availablePaymentMethods: string[];
  }>
> {
  let cart: InstamartCart = emptyCart();
  await mutate((s) => {
    const existing = s.carts.instamart[CART_KEY];
    if (existing) {
      cart = existing;
    } else {
      s.carts.instamart[CART_KEY] = cart;
    }
  });

  const coupons = await loadInstamartCoupons();
  const bill = computeBill(cart, coupons);

  return {
    success: true,
    data: {
      cart,
      bill,
      availablePaymentMethods: ["UPI", "CARD", "COD"],
    },
    message:
      cart.items.length === 0
        ? "Your Instamart cart is empty."
        : `Cart has ${cart.items.length} item(s); total ₹${bill.total}.`,
  };
}

export { CART_KEY };
