# Zepto — Live API Map (verified against a real account)

What actually works when you talk to Zepto's production API **from pure Node `fetch`** — no browser,
no Playwright, no TLS-impersonation. Every row below was exercised live on **2026-05-23** against a
real logged-in account (`+91 9896609966`, user `0c00c517-…`).

> This supersedes the "search needs a stealth browser" guidance in the aggregator's `docs/zepto.md`
> for the auth + account + catalog planes. See [§7 Corrections](#7-corrections-to-earlier-reverse-engineering).

---

## 1. TL;DR

- **Login is pure HTTP.** `create-csrf-token` → `send-otp-sms` → `verify-otp`. We reimplemented Zepto's
  request signing in Node (`request-signature` + `x-timezone`) and it is byte-correct (verified against a
  captured request). No browser needed to log in.
- **There are two auth worlds:**
  - **Account plane** — needs the **JWT bearer** returned by `verify-otp` (orders, addresses, loyalty, referrals).
  - **Catalog plane** — needs **anonymous** signed calls with header `X-WITHOUT-BEARER: true` (search, page layouts).
    Sending the bearer here is *rejected* (401).
- **The AWS WAF does not block Node `fetch`** for these endpoints today — requests reach Kong and are
  judged on auth/method, not TLS fingerprint. (The browser fallback in `src/zepto/auth/login.ts` is kept
  in case that changes.)
- **Cart works** (verified live, stopping before order): search → `cart/create` (set-cart) → full bill
  (item total, delivery + handling fees, toPay, ETA, wallet, coupons, payment flow). **Checkout/place-order
  (`api/v3/order/`) is intentionally never called.**
- **Credentials + config persist in `~/.tyda/config.yml`** (0600). Reopen the tool and you're still logged in.

---

## 2. Auth & token flow (the working path)

```
GET  https://www.zepto.com/auth/create-csrf-token
        ← 200  Set-Cookie: XSRF-TOKEN=…  csrfSecret=…           (the signing secret)

POST https://bff-gateway.zepto.com/api/v1/user/customer/send-otp-sms/   (signed)
        body { "mobileNumber": "9896609966", "countryCode": "+91" }
        ← 200  { "verificationType":"otp_sms", "data":{"msg":"OTP Sent."} }   → real SMS

POST https://bff-gateway.zepto.com/api/v1/user/customer/verify-otp      (signed)
        body { "mobileNumber":"…", "countryCode":"+91", "otpToken":"<otp>" }
        ← 200  { "token":"<JWT>", "refreshToken":"<uuid>", "user": { … } }
```

### Token model (what we actually got back)

| Piece | Form | Lifetime | Notes |
|---|---|---|---|
| `token` | **JWT** (`HS512`), claims `{version, sub=userId, iat, exp}` | **1 hour** (`exp-iat=3600`) | Bearer for the account plane |
| `refreshToken` | **opaque UUID** (e.g. `91ff3381-…`) | unknown | No usable refresh endpoint exposed (see §4) |
| `user` | object | — | `fullName, id, mobileNumber, referralCode, userType, isRegistered, emailId, whatsappOpted, …` |
| `XSRF-TOKEN` / `csrfSecret` | cookies | server-set | The **signing secret** + CSRF pair (needed by every signed call) |
| `device_id` / `session_id` | client UUIDs | 1y / 30m | Part of the signature; we generate + persist them |

> **Important:** this BFF `verify-otp` is the **native-app style** flow — it returns a **bearer token** and
> does **not** set logged-in session cookies (`IS_AUTH` stays absent). The browser modal uses a different
> `auth/verify-otp` that sets cookies. We use the bearer.

### Request signing (reimplemented in `src/zepto/auth/signer.ts`)

```
canonical = [ body, deviceId, method(lowercased), requestId, secret, url(pathname+query) ].join("|")
            (object keys sorted alphabetically: body|deviceId|method|requestId|secret|url)
secret    = url-decoded XSRF-TOKEN cookie value
request-signature = SHA-256_hex(canonical)
x-timezone        = SHA-256_hex(request-signature)
```

Verified: `SHA-256("2510db…d657d") === captured x-timezone "13cbe5…ff34c"`.

---

## 3. Endpoint map

`✓` verified 200 live · `✗` failed (reason) · `mut` mutating, not exercised. Base = `https://bff-gateway.zepto.com`
unless noted. Auth: **B** = bearer (account), **A** = anonymous `X-WITHOUT-BEARER:true` (catalog), **C** = CSRF only.

### Auth (plane C / signed)
| St | Method | Path | Notes |
|----|--------|------|-------|
| ✓ | GET  | `www.zepto.com/auth/create-csrf-token` | sets XSRF-TOKEN + csrfSecret |
| ✓ | POST | `api/v1/user/customer/send-otp-sms/` | `{mobileNumber, countryCode}` → SMS |
| ✓ | POST | `api/v1/user/customer/verify-otp` | `{mobileNumber, countryCode, otpToken}` → `{token, refreshToken, user}` |

### Account plane (B — bearer)
| St | Method | Path | Response (top-level shape) |
|----|--------|------|----------------------------|
| ✓ | GET | `api/v1/user/customer/referrals/` | `{ uiSchema, pageLayout }` (referral UI + `referralCode`) |
| ✓ | GET | `api/v1/user/customer/addresses/` | `{ userAddresses: [{ id, type, name, latitude, longitude, flatDetails, buildingName, landmark, contactNumber, googleFormattedAddress, … }] }` |
| ✓ | GET | `api/v2/order/` | `{ orders: [{ id, code, status, grandTotalAmount, itemQuantityCount, placedTime, storeId, productsNamesAndCounts }], endOfList }` |
| ✓ | GET | `api/v3/order/{id}/status/` | `{ id, code, status, storeId, paymentReferenceId, shipmentDetails:[{ arrivalTimestamp, etaTitle, … }], codActionDetails }` |
| ✓ | GET | `post-order-service/api/v2/order/last-ongoing-order` | `{ ongoingOrders:[], orderStatus, title, subtitle, … }` (empty when none active) |
| ✓ | GET | `api/v1/pass/overview` | `{ membership, lifetimeSavings:{ totalSavingsAmount, totalOrders, … }, userCohort, … }` |
| ✓ | GET | `zepto-coins/api/v1/coin/balance` | `{ balance, amountInPaise }` |
| ✓ | GET | `zepto-coins/api/v1/coin/overview` | `{ topNavBar, zcoinsSummary{ totalBalanceText, … } }` |
| ✓ | GET | `zepto-coins/api/v1/coin/ledgers` | `{ pageSize, data:[], filtersList:[{label,value}] }` |
| ✗ | GET | `api/v2/user/customer/info/` · `api/v1/.../info/` | 404 "no Route matched" — **profile comes from the `user` object in `verify-otp`**, not a live info route |

### Catalog plane (A — anonymous `X-WITHOUT-BEARER: true`)
| St | Method | Path | Response |
|----|--------|------|----------|
| ✓ | POST | `user-search-service/api/v3/search` | `{ layout:[{ widgetId, widgetName, data, widgetType }×N], footer, pageProductCount, totalProductCount, algoliaQueryID, hasReachedEnd }` — products live under the `PRODUCT_GRID` widget |
| ✓ | POST | `lms/api/v2/get_page` | `{ pageLayout, storeServiceableResponse{ serviceable }, datasource, … }` — generic page renderer (HOME/SUBCATEGORY/…) |
| ✗ | POST | `user-search-service/api/v3/search/filters` | 400 "invalid page number" — route exists, needs correct pagination params |
| ✗ | POST | `product-assortment-service/api/v3/store-products` | 501 "Method Not Allowed" — gRPC-transcoded; use `lms/get_page` / `search` instead |
| ✗ | POST | `product-assortment-service/api/v2/homepage/vertical-feed` | 501 "Method Not Allowed" — same; superseded by `lms/get_page` |

Body for search: `{ query, pageNumber, mode:"AUTOSUGGEST", storeId, storeIds:[storeId], intentId, userSessionId }`.

### Cart (B — bearer) — VERIFIED up to (not including) order
| St | Method | Path | Notes |
|----|--------|------|-------|
| ✓ | POST | `cfs/api/v1/cart/create` | **set-cart** ("UpdateCartV2"). Returns the whole cart + bill. See body below. |
| ✗ | GET | `cfs/api/v1/cart` | 501 without a cart context — read the cart from the `cart/create` response instead. |
| mut | POST | `cfs/api/v1/cart/coupons/apply` · `…/remove` | needs cartId (not exercised) |
| mut | POST | `api/v3/order/` | place order (checkout) — **never auto-run** |
| mut | POST | `payment-service/api/v2/payment/initiate-sdk-payload` | Juspay SDK init (card/UPI options) — needs order/cart |

**`cart/create` request (verified):**
```
POST https://bff-gateway.zepto.com/cfs/api/v1/cart/create     (bearer + signed)
header: storeIds: <storeId>
body  : {
  latitude, longitude,            // delivery point (from a saved address)
  storeId, addressId,
  deliveryInstructions: {},       // must be an object ({} ok), not a string
  cartProducts: [ { productVariantId, storeProductId, productId, quantity } ]   // [] clears the cart
}
```
**`cart/create` response (the bill):** `{ cartId, itemQuantityCount, itemTotalAmount, deliveryFee,
fees:[{type:"PACKAGING_FEE", …}], toPay, grandTotalAmount, totalDiscount, totalWalletBalance,
paymentDetails:{paymentFlow:"IPP"}, availableDeliveryOptions, couponDetails, recommendedCoupons,
inHouseCodModeEnabled, isCodBlocked, storeLevelCartProducts:[{ title:"Delivery in 6 mins", cartProducts:[…] }], … }`.
Items live under `storeLevelCartProducts[].cartProducts` (top-level `cartProducts` is the *input* field).

> Live example: 1× milk (₹31) → delivery ₹30 → **toPay ₹61**, ETA "Delivery in 6 mins", `paymentFlow: IPP`.
> Detailed card/UPI methods are issued by `payment-service` **at checkout** (Juspay), which we never call.

### Serviceability / store
| St | Method | Path | Notes |
|----|--------|------|-------|
| ✗ | GET | `serviceability-service/api/v1/serviceability?latitude=…&longitude=…` | 400 `invalid_lat/lng/regionId` — needs a **regionId** too. **Workaround:** `storeId` is read directly off any past order (`api/v2/order/` → `orders[].storeId`), which is what the tooling does. |

---

## 4. Refresh & token status (wired)

- **Status** is live in `npm run zepto:status`: shows token validity, **time remaining**, refresh-token
  presence, and resolved `storeId`.
- **Refresh:** the `refreshToken` is an opaque UUID, but **no bearer-refresh endpoint is exposed in
  Zepto's web bundle** — that belongs to the native-app flow (the web client refreshes its *cookie*
  session via `auth/refresh-auth`, a different world). We probed ~20 candidate routes; all 404.
- **Therefore the working "refresh" is an OTP re-login.** `npm run zepto:refresh` reports status if the
  token is still valid, and otherwise re-runs the OTP login. The single seam to upgrade is
  `tryRefresh()` in `src/zepto/auth/refresh.ts` — wire the endpoint there if it's ever found.

---

## 5. Tooling (this branch)

```bash
npm run zepto:login        # real OTP login over pure HTTP → ~/.tyda/config.yml
npm run zepto:status       # session + token validity + time left + storeId
npm run zepto:refresh      # report status, or re-login if expired
npm run zepto:recon        # probe the authenticated surface, write recon-<ts>.json
npm run zepto:search milk  # anonymous catalog search
npm run zepto:cart-demo milk          # search → add 1 → print bill → CLEAR (account left clean)
npm run zepto:cart-demo milk -- --keep  # leave the item in the cart
npm run zepto:cart-clear   # empty the cart
npm run zepto:login -- --browser   # Playwright fallback (only if the WAF starts gating auth)
```

Non-interactive login (for automation / handing the OTP to a runner):
```bash
ZEPTO_NONINTERACTIVE=1 ZEPTO_PHONE=98xxxxxx96 npm run zepto:login   # then write the OTP to ~/.tyda/otp.inbox
```

**Persistence:** everything lives in **`~/.tyda/config.yml`** (0600) under `zepto.session` — token,
refresh token, cookies, device/session ids, storeId, user. Reopen the tool and you're still logged in.
(Legacy `~/.tyda-zepto/session.json` is auto-migrated on first read.)

Code: `src/zepto/auth/{signer,http-client,http-login,session,refresh,prompt,browser,login}.ts`,
`src/zepto/{config,commerce,cli,recon}.ts`, dev probes in `src/zepto/tools/`.

---

## 6. How this maps to the tyda (Swiggy) shape

Zepto is single-domain quick-commerce, so it maps to **one** server (≈ Swiggy Instamart), not three.
The natural MCP tool surface, by plane:

| tyda Instamart tool | Zepto endpoint | Plane |
|---|---|---|
| `get_addresses` | `api/v1/user/customer/addresses/` | bearer ✓ |
| `search_products` | `user-search-service/api/v3/search` | anon ✓ |
| `get_orders` / `get_order_details` / `track_order` | `api/v2/order/`, `api/v3/order/{id}/status/`, `…/last-ongoing-order` | bearer ✓ |
| `update_cart` / `clear_cart` / `get_cart` | `cfs/api/v1/cart/create` (set-cart) | bearer ✓ (verified) |
| `checkout` | `api/v3/order/` + `payment-service/*` | bearer (mut — never auto-run) |
| (loyalty extras) | `api/v1/pass/overview`, `zepto-coins/*` | bearer ✓ |

---

## 7. Corrections to earlier reverse-engineering

1. **verify-otp endpoint:** the working path is `bff-gateway.zepto.com/api/v1/user/customer/verify-otp`
   (the "legacy" constant), **not** `auth/verify-otp`. The latter 404s.
2. **verify-otp returns a JWT bearer + refreshToken**, not just `{user}`. Web-vs-app: the modal path is
   cookie-based; this BFF path is token-based.
3. **Search does NOT require a stealth browser** (today): anonymous `X-WITHOUT-BEARER:true` + CSRF signing
   over plain `fetch` returns a full product layout (200). The AWS WAF did not block us.
4. **Profile:** there is no live `user/customer/info` route on this gateway (404); the profile is the
   `user` object from `verify-otp`.
5. **serviceability** needs a `regionId` (not just lat/lng); `storeId` is more reliably taken from a past order.
