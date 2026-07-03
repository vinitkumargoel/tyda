/**
 * SAFELY reverse-engineer the order-create (api/v3/order/) body.
 *
 * Builds a real cart with the CHEAPEST in-stock item, then probes order-create
 * with a TAMPERED encryptedSummary so the server rejects every probe (no order is
 * ever placed) while revealing which fields it validates. Prints findings only.
 *
 *   tsx src/zepto/tools/probe-order.ts
 */
import { ZeptoHttp, ZEPTO_BFF } from "../auth/http-client.js";
import { loadSession } from "../auth/session.js";
import { searchProducts, getDeliveryContext, setCart, billSummary } from "../commerce.js";

const U = (p: string) => `${ZEPTO_BFF}/${p}`;
const rupee = (p: number) => `₹${(p / 100).toFixed(2)}`;

async function main() {
  const s = loadSession();
  if (!s?.token) throw new Error("login first");
  const http = new ZeptoHttp({
    deviceId: s.deviceId,
    sessionId: s.sessionId,
    cookies: s.cookies,
    token: s.token,
    storeId: s.storeId,
  });

  const ctx = await getDeliveryContext(http, s);
  console.log(`store=${ctx.storeId} addr=${ctx.addressId} (${ctx.latitude},${ctx.longitude})`);

  const prods = await searchProducts("milk", ctx.storeId);
  const cheap = prods.filter((p) => !p.outOfStock).sort((a, b) => a.price - b.price)[0];
  if (!cheap) throw new Error("no in-stock item");
  console.log(`cheapest: ${cheap.name} @ ${rupee(cheap.price)}`);

  const cart = await setCart(http, ctx, [
    { productVariantId: cheap.pvid, storeProductId: cheap.storeProductId, productId: cheap.productId, quantity: 1 },
  ]);
  const bill = billSummary(cart);
  const cartId: string = cart.cartId;
  const summary: string = cart.encryptedSummary ?? "";
  console.log(`cart ${cartId}  toPay ${rupee(bill.toPay)}  summary len=${summary.length}`);

  // TAMPER the summary so the server cannot accept any probe → no order is placed.
  const badSummary = summary ? summary.slice(0, -3) + "XXX" : "tampered";
  const hdr = { storeIds: ctx.storeId, store_ids: ctx.storeId };
  const ORDER = U("api/v3/order/");
  const geo = {
    cartId,
    addressId: ctx.addressId,
    storeId: ctx.storeId,
    latitude: ctx.latitude,
    longitude: ctx.longitude,
    deliveryInstructions: {},
  };

  const trials: Array<[string, Record<string, unknown>]> = [
    ["bare {cartId}", { cartId, encryptedSummary: badSummary }],
    ["geo + PREPAID", { ...geo, encryptedSummary: badSummary, paymentType: "PREPAID" }],
    ["geo + ONLINE", { ...geo, encryptedSummary: badSummary, paymentType: "ONLINE" }],
    ["geo + paymentMode ONLINE", { ...geo, encryptedSummary: badSummary, paymentMode: "ONLINE" }],
    ["geo + COD", { ...geo, encryptedSummary: badSummary, paymentType: "COD" }],
  ];

  for (const [label, body] of trials) {
    try {
      const r = await http.signed("POST", ORDER, body, hdr);
      const j = (r.json ?? {}) as any;
      const msg = j.message ?? j.error ?? (j.errors && JSON.stringify(j.errors)) ?? "";
      console.log(`${r.status}  ${label}  « ${String(msg).slice(0, 150)} »  keys=${Object.keys(j).slice(0, 8).join(",")}`);
    } catch (e) {
      console.log(`ERR ${label}: ${(e as Error).message}`);
    }
  }
  console.log("\n(no order placed — every probe used a tampered encryptedSummary)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
