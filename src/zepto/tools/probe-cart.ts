/**
 * Reverse the cart flow empirically, then verify it end-to-end up to (but NOT
 * including) placing an order.
 *
 *   tsx src/zepto/tools/probe-cart.ts search   # dump a product's id fields
 *   tsx src/zepto/tools/probe-cart.ts create   # search → try cart/create body shapes (MUTATES cart)
 *
 * Cart is the bearer (account) plane. The only write path in the bundle is
 * cfs/api/v1/cart/create (set-cart semantics). We try candidate bodies and stop at
 * the first 2xx, printing the response keys + any cartId/bill.
 */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";

const U = (p: string) => `${ZEPTO_BFF}/${p}`;

interface Picked {
  storeId: string;
  pvid: string;
  storeProductId: string;
  productId: string;
  price: number;
  name: string;
}

function findProducts(obj: any, out: any[] = [], depth = 0): any[] {
  if (!obj || typeof obj !== "object" || depth > 8) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) findProducts(x, out, depth + 1);
    return out;
  }
  const keys = Object.keys(obj);
  const hasId = keys.some((k) => /productVariantId|storeProductId|^pvid$|^id$|productId/i.test(k));
  const hasPrice = keys.some((k) => /sellingPrice|mrp|price|discountedPrice/i.test(k));
  if (hasId && hasPrice && obj.productVariant) out.push(obj);
  for (const k of keys) findProducts(obj[k], out, depth + 1);
  return out;
}

async function searchProduct(): Promise<{ anon: ZeptoHttp; picked: Picked }> {
  const s = loadSession();
  const store = s?.storeId ?? "d5da3809-1327-4050-b59b-43342ea74482";
  const anon = new ZeptoHttp();
  await anon.bootstrapCsrf();
  anon.storeId = store;
  const res = await anon.signed(
    "POST",
    U("user-search-service/api/v3/search"),
    { query: "milk", pageNumber: 0, mode: "AUTOSUGGEST", storeId: store, storeIds: [store], intentId: "probe", userSessionId: anon.sessionId },
    { "X-WITHOUT-BEARER": "true" },
  );
  const prods = findProducts(res.json).filter((p) => !p.outOfStock && p.availableQuantity > 0);
  const p = prods[0];
  if (!p) throw new Error("no in-stock product found");
  const picked: Picked = {
    storeId: store,
    pvid: p.productVariant.id,
    storeProductId: p.id ?? p.objectId,
    productId: p.product?.id,
    price: p.sellingPrice ?? p.discountedSellingPrice,
    name: p.product?.name ?? "?",
  };
  return { anon, picked };
}

async function cmdCreate() {
  const s = loadSession();
  if (!s?.token) throw new Error("no session token — run npm run zepto:login");
  const { picked } = await searchProduct();
  console.log("picked:", JSON.stringify(picked, null, 2), "\n");

  const http = new ZeptoHttp({ deviceId: s.deviceId, sessionId: s.sessionId, cookies: s.cookies, token: s.token, storeId: picked.storeId });

  // cart/create (UpdateCartV2) needs the delivery lat/lng — read it from a saved address.
  const addrRes = await http.signed("GET", U("api/v1/user/customer/addresses/"));
  const addr = ((addrRes.json as any)?.userAddresses ?? [])[0];
  const latitude = Number(addr?.latitude);
  const longitude = Number(addr?.longitude);
  console.log(`delivery latlng: ${latitude}, ${longitude}\n`);

  const item = { productVariantId: picked.pvid, storeProductId: picked.storeProductId, productId: picked.productId, quantity: 1 };
  const base = {
    latitude,
    longitude,
    storeId: picked.storeId,
    items: [item],
    deliveryInstructions: "",
    addressId: addr?.id,
  };
  const hdr = { storeIds: picked.storeId, store_ids: picked.storeId };
  const di = {};
  // vary the product-array field name; UpdateCartV2 is protobuf so the name matters.
  const fieldNames = ["products", "cartProducts", "items", "cartItems", "productList", "updatedProducts"];
  const bodies = fieldNames.map((f) => ({
    label: `field='${f}'`,
    body: { latitude, longitude, storeId: picked.storeId, addressId: addr?.id, deliveryInstructions: di, [f]: [item] },
  }));

  for (const b of bodies) {
    const res = await http.signed("POST", U("cfs/api/v1/cart/create"), b.body, hdr);
    const j = (res.json ?? {}) as any;
    const msg = j.message ?? j.error ?? "";
    const qty = j.itemQuantityCount;
    console.log(`${res.status}  ${b.label}  qty=${qty ?? "-"}  ${msg ? "« " + msg + " »" : ""}`);
    if (res.status >= 200 && res.status < 300 && qty > 0) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("/tmp/zepto-cart.json", JSON.stringify(j, null, 2));
      console.log("  ✓ ITEM ADDED. cartId:", j.cartId, "toPay:", j.toPay, "grandTotal:", j.grandTotalAmount);
      console.log("  cartProducts[0]:", JSON.stringify(j.cartProducts?.[0])?.slice(0, 400));
      console.log("  paymentDetails:", JSON.stringify(j.paymentDetails)?.slice(0, 400));
      console.log("  availableDeliveryOptions:", JSON.stringify(j.availableDeliveryOptions)?.slice(0, 300));
      console.log("  saved → /tmp/zepto-cart.json");
      break;
    }
  }
}

const cmd = process.argv[2] ?? "search";
if (cmd === "create") {
  cmdCreate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  searchProduct()
    .then(({ picked }) => console.log(JSON.stringify(picked, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
