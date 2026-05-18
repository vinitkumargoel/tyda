import { mutate } from "../../store.js";
import type { OkResponse, ErrResponse } from "../../../shared/response.js";
import {
  buildCartItem,
  computeBill,
  emptyCart,
  findProductBySpinId,
  loadInstamartCoupons,
  loadProducts,
  variantAvailable,
} from "./_helpers.js";
import { CART_KEY } from "./get_cart.js";
import type { InstamartBill, InstamartCart, InstamartCartItem } from "./_types.js";

export interface UpdateCartInputItem {
  spinId: string;
  quantity: number;
}

export interface UpdateCartInput {
  items: UpdateCartInputItem[];
  selectedAddressId?: string;
}

export async function updateCart(
  args: UpdateCartInput,
): Promise<
  OkResponse<{ cart: InstamartCart; bill: InstamartBill }> | ErrResponse
> {
  const products = await loadProducts();
  const now = new Date();
  const built: InstamartCartItem[] = [];

  for (const it of args.items) {
    const hit = findProductBySpinId(products, it.spinId);
    if (!hit) {
      return {
        success: false,
        error: {
          code: "ITEM_NOT_FOUND",
          message: `Unknown spinId ${it.spinId}`,
        },
      };
    }
    if (!variantAvailable(hit.variant, now)) {
      return {
        success: false,
        error: {
          code: "ITEM_UNAVAILABLE",
          message: `${hit.product.name} is out of stock`,
        },
      };
    }
    if (it.quantity <= 0) continue;
    built.push(buildCartItem(hit.product, hit.variant, it.quantity));
  }

  let cart: InstamartCart = emptyCart();
  await mutate((s) => {
    const existing = s.carts.instamart[CART_KEY] ?? emptyCart();
    existing.items = built;
    existing.updatedAt = Date.now();
    if (args.selectedAddressId) existing.addressId = args.selectedAddressId;
    s.carts.instamart[CART_KEY] = existing;
    cart = existing;
  });

  const coupons = await loadInstamartCoupons();
  const bill = computeBill(cart, coupons);
  return {
    success: true,
    data: { cart, bill },
    message: `Cart updated — ${cart.items.length} item(s), total ₹${bill.total}.`,
  };
}
