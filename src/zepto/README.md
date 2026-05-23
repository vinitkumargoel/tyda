# zepto (real integration)

Pure-Node integration with Zepto's **production** API — no browser, no Playwright, no TLS impersonation.
Currently implements **authentication** (real OTP login + token capture) and a **recon** mapper of the
authenticated API surface. See [`../../docs/zepto-live-api-map.md`](../../docs/zepto-live-api-map.md) for
the verified endpoint map and the auth/token architecture.

## TUI

```bash
npm run zepto:tui
```
An Ink slash-REPL wired to the real integration (no mock). Inside:
```
/login <phone>     send a real OTP   →   /otp <code>   (or just type the digits)
/search milk       results WITH product thumbnails (unicode half-block art)
/pic <n>           bigger thumbnail of result n
/add <n> [qty]     add to the real cart → shows the bill (never places the order)
/cart  /clear  /status  /help  /quit
```
Search results render as **bordered product cards** (image + wrapped name + price/discount + actions).
Images are truecolor half-block art — best in a 24-bit-color terminal (iTerm2, WezTerm, Kitty, VS Code).

**Auto-refresh:** the token lasts 1 h. A watcher warns when it's about to lapse; on your next
authenticated action (`/search`, `/add`, …) an expired token triggers an automatic refresh — a silent
refresh if Zepto ever exposes one, otherwise an auto OTP re-login (code sent to your saved number) — and
the original command resumes afterward. Everything is logged in the TUI. It never calls `api/v3/order/`.

## CLI

```bash
npm run zepto:login        # real OTP login (pure HTTP) → ~/.tyda/config.yml
npm run zepto:status       # session + token validity + time left + storeId
npm run zepto:refresh      # report token status, or re-login if expired
npm run zepto:recon        # probe the authenticated surface → ~/.tyda/recon-<ts>.json
npm run zepto:search milk  # anonymous catalog search
npm run zepto:cart-demo milk          # search → add 1 → bill → CLEAR (account left clean)
npm run zepto:cart-demo milk -- --keep  # leave the item in the cart
npm run zepto:cart-clear   # empty the cart
```

## Layout

```
tui.tsx            Ink slash-REPL wired to the real integration (login/search/pics/cart)
config.ts          unified ~/.tyda/config.yml store (credentials + config)
commerce.ts        catalog search (anon) + cart (bearer): setCart/addItem/clearCart/billSummary
image.ts           remote image → unicode half-block art (jimp; for TUI product pics)
auth/otp.ts        granular sendOtp/verifyOtp (interactive login for the TUI)
auth/
  signer.ts        request-signature + x-timezone (SHA-256 canonical; verified vs live capture)
  http-client.ts   cookie jar + full Zepto header set + signed fetch + bearer + decodeJwt
  http-login.ts    csrf → send-otp → verify-otp → capture token/refresh/user → save session  (DEFAULT)
  session.ts       persists to ~/.tyda/config.yml (cookies, deviceId/sessionId, token, refresh, exp, storeId)
  refresh.ts       token status + refresh seam (re-login fallback; bearer-refresh not exposed by Zepto)
  prompt.ts        interactive / non-interactive (env phone + watched OTP file) input + status file
  browser.ts       stealth Chromium launcher (fallback only)
  login.ts         Playwright modal-driven login (FALLBACK if the WAF starts gating auth)
cli.ts             login | status | refresh | search | cart-demo | cart-clear
recon.ts           endpoint mapper (bearer account plane + anonymous catalog plane)
tools/             one-off probes used to reverse the surface (cart, commerce, refresh, search)
```

## Two auth worlds (important)

- **Account plane** (orders, addresses, loyalty, referrals): send the **JWT bearer** from `verify-otp`.
- **Catalog plane** (search, page layouts): send **`X-WITHOUT-BEARER: true`** (anonymous) + CSRF signing.
  The bearer is *rejected* here.
- **Cart/checkout/payment**: bearer + a `cartId` (from `cart/create`); mutating, not auto-run.

## Security

`~/.tyda/config.yml` holds a live bearer token + cookies for the user's real Zepto account
(written `0600`). Treat it as a credential. `~/.tyda/{otp.inbox,login.status}` are transient IPC files.
