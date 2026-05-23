# RFC: Deepen `ZeptoClient` — a port-fronted signed client

> Architecture RFC generated via `/improve-codebase-architecture`. Scope: `src/zepto/` (Zepto integration + Ink TUI), `zepto` branch. Status: proposed (not yet implemented).

## Problem

`auth/http-client.ts` (`ZeptoHttp`) is *almost* a deep module — it hides the cookie jar, `Set-Cookie` absorption, CSRF-secret decoding, the canonical SHA-256 signer, and the full header set. But three things leak across its boundary and force ceremony (and latent bugs) onto every caller:

1. **Construction-from-session is duplicated.** The exact `new ZeptoHttp({ deviceId, sessionId, cookies, token, storeId })` block is copy-pasted in `commerce.ts:267` (`clientFor`), `tui.tsx:113` (`clientFromSession`), `recon.ts:204`, and 5 `tools/probe-*.ts`. No single source of truth for "client from session".
2. **CSRF bootstrap is a forgettable precondition.** `await http.bootstrapCsrf()` must run before any signed call or the request signs with `secret=""` and is silently rejected. 4+ sites remember it by hand (`otp.ts`, `http-login.ts`, `commerce.ts:78`, `recon.ts`). Nothing structural prevents the bug.
3. **The anonymous plane is hand-assembled.** Catalog calls must manually splice `{ "X-WITHOUT-BEARER": "true" }` into `extraHeaders` and use a token-less client; account calls set `Authorization`. The plane distinction is convention, not type — and the catalog services *reject* a bearer, so mixing them is a real failure mode.
4. **Session persistence is scattered across 8 sites.** "mutate `session.storeId`/`selectedAddressId`/token → remember `saveSession(session)`" recurs in `http-login.ts:125`, `otp.ts:67`, `login.ts:156`, `commerce.ts` (×4: 173/190/199/215), `recon.ts:225`. The client's `absorb()` updates `this.cookies` in place, but callers must hand-copy `{...http.cookies}` back into a `ZeptoSession`.

**Integration risk lives in the seams, not the functions.** `signer.sign()` is pure and correct; the real bugs hide in *how it's called* — whether CSRF ran, which cookies/storeId/headers the caller assembled, which plane was used. **There are no tests for `src/zepto/`** and signing/CSRF can only be exercised against the live WAF-gated API with a live OTP. The non-determinism (`fetch`, `randomUUID`, `Date.now()`) makes offline assertion impossible.

## Proposed Interface

A deep, **port-fronted** `ZeptoClient` with a **small, named surface**. (Hybrid of the "ports & adapters" and "minimal" designs; commerce/location logic explicitly stays a layer *above* the client.)

```ts
// ── Ports (the only contact with the outside world) ──────────────────────────
export interface Transport { send(req: { method: string; url: string; headers: Record<string,string>; body?: string }):
  Promise<{ status: number; text: string; setCookies: string[] }>; }
export interface SessionStore { load(): ZeptoSession | null; save(s: ZeptoSession): void; }
export interface Clock { now(): number; isoNow(): string; }
export interface IdGen { uuid(): string; }
export interface ZeptoDeps { transport: Transport; store: SessionStore; clock: Clock; ids: IdGen; }

// ── The deep client (small, named surface) ───────────────────────────────────
export class ZeptoClient {
  static fromSession(session: ZeptoSession, deps: ZeptoDeps): ZeptoClient;
  static fromStore(deps: ZeptoDeps): ZeptoClient | null;   // collapses clientFor/clientFromSession
  static anonymous(deps: ZeptoDeps): ZeptoClient;

  ensureCsrf(): Promise<void>;                              // idempotent; auto-run by every call

  // named planes — make the "bearer in the catalog plane" mistake impossible
  bearer(method: string, url: string, body?: object, opts?: { storeId?: string; headers?: Record<string,string> }): Promise<ZeptoResponse>;
  anon(method: string, url: string, body?: object, opts?: { storeId?: string; headers?: Record<string,string> }): Promise<ZeptoResponse>;

  sendOtp(phone: string): Promise<{ ok: boolean; reason?: string }>;
  verifyOtp(phone: string, otp: string): Promise<{ ok: boolean; user?: ZeptoUser | null; session?: ZeptoSession; reason?: string }>;

  readonly session: Readonly<ZeptoSession>;
  isTokenExpired(skewSec?: number): boolean;               // uses Clock, not Date.now()
}
export interface ZeptoResponse { status: number; ok: boolean; text: string; json: unknown; requestId: string; }
```

**Usage (callers shrink):**
```ts
// account plane
const client = ZeptoClient.fromStore(prodDeps)!;
const addresses = await client.bearer("GET", `${ZEPTO_BFF}/api/v1/user/customer/addresses/`);

// catalog plane — CSRF auto-bootstraps, X-WITHOUT-BEARER applied by anon()
const search = await ZeptoClient.anonymous(prodDeps)
  .anon("POST", `${ZEPTO_BFF}/user-search-service/api/v3/search`, body, { storeId });

// OTP — one client carries CSRF/device/session across send→verify; persists on success
const c = ZeptoClient.anonymous(prodDeps);
await c.sendOtp(phone); /* user types code */ await c.verifyOtp(phone, otp);
```

**Complexity hidden:** fresh `requestId` per call + canonical signing + `x-timezone`; idempotent lazy CSRF (un-forgettable); cookie jar + `Set-Cookie` absorption + url-decoded XSRF secret; bearer vs anonymous planes by method name; the full standard header set + per-request `storeid/store_id/storeIds`; **write-through persistence** of identity deltas (cookies/token/storeId) via the `SessionStore` port.

## Dependency Strategy

**Ports & adapters.** The client owns all protocol logic; every cross-boundary dependency is an injected port with a production adapter and an in-memory test adapter. The pure `signer.ts` gets **no port** (no I/O — called directly).

| Dependency | Category | Port | Production adapter | Test adapter |
|---|---|---|---|---|
| Zepto network (WAF-gated) | #4 true-external | `Transport` | real `fetch`, surfaces `getSetCookie()` | in-memory: canned responses **+ records the signed request** for assertions |
| `~/.tyda/config.yml` session | #2 local-substitutable | `SessionStore` | existing `loadSession`/`saveSession` (YAML, `0600`, legacy migration) | in-memory object (or temp dir for the YAML round-trip) |
| wall clock (`savedAt`, token-exp) | in-process | `Clock` | `Date.now`/`new Date().toISOString()` | frozen epoch/ISO |
| UUIDs (device/session/**requestId**) | in-process | `IdGen` | `crypto.randomUUID` | sequential counter |

`Clock`+`IdGen` are deliberately injected: without them the **signature itself** is non-deterministic, so you couldn't assert on a signed request offline — that capability is the point.

## Testing Strategy

**Replace, don't layer** (there are no tests today, so this is net-new boundary coverage):

**New boundary tests** (in-memory transport, frozen clock, sequential ids — no network, no live OTP):
- **CSRF is un-forgettable:** first `bearer()`/`anon()`/`sendOtp()` on a CSRF-less client issues `create-csrf-token` first; assert ordering and that it's fetched once (idempotent).
- **Signing contract (golden):** with deterministic ids/secret, assert the exact `request-signature` (64-hex) and `x-timezone` for a known request — pins `body|deviceId|method|requestId|secret|url` and the url-decoded XSRF secret.
- **Plane correctness:** `anon()` sends `X-WITHOUT-BEARER:true` and no `Authorization`; `bearer()` sends `Authorization: Bearer …` + `auth_revamp_flow:v2`.
- **Header assembly:** `storeId` opt expands to `storeid/store_id/storeIds`; standard header set present.
- **Write-through persistence:** a call that rotates cookies/token triggers exactly one `store.save()` with the merged session; a no-change call triggers zero.
- **OTP flow:** `sendOtp`→`verifyOtp` on one client; verify-route fallback; on 200 a session is persisted and `user` returned.

**Old tests to delete:** none exist. **Environment needs:** in-memory `Transport`/`SessionStore` doubles + injectable `Clock`/`IdGen` (no external services).

## Implementation Recommendations

Durable guidance (not coupled to current file paths):

- **The client should OWN:** signing, CSRF lifecycle, the cookie jar, auth-plane decoration, the standard header set, and persisting its *own identity deltas* (cookies/token/storeId) through the store port.
- **It should HIDE:** `sign()`, `bootstrapCsrf()`, cookie encode/decode, the header blob, the BFF base-URL composition, and all `fetch`/`Date`/`randomUUID` calls (behind ports).
- **It should EXPOSE:** the small named surface above — construction (`fromSession`/`fromStore`/`anonymous`), `bearer`/`anon`, `sendOtp`/`verifyOtp`, a read-only `session`, and `isTokenExpired`.
- **Keep OUT of the client (layer above):** endpoint/domain logic (`searchProducts`, `getAddresses`, `setCart`) stays in `commerce.ts` as thin functions over a `ZeptoClient`; **store/location resolution** (selected-address → serviceability → past-order fallback) is its own module over the client (a separate follow-up — Candidate 2 "LocationResolver"). Do **not** fold commerce/login/auto-persist-everything into the client (avoids a god-object).
- **Explicitly rejected:** a middleware/plugin-plane registry (only 2 planes; silent refresh is impossible upstream — confirmed no refresh endpoint and no token rotation) and a `current()` facade with commerce methods baked in.
- **Migration:** introduce `ZeptoClient` + a `prodDeps` (real adapters) object; replace the duplicated `clientFor`/`clientFromSession`/anon-bootstrap blocks and the 8 `saveSession` sites with client calls; convert `commerce.ts` free functions to take a `ZeptoClient`; keep `ZeptoHttp`/`signer` as internal implementation. The `tools/probe-*.ts` can use `anon()`/`bearer()` with an in-memory or no-op store.

---

### Appendix — candidates considered (not chosen now)

This RFC is **Candidate 1**. The exploration surfaced three adjacent deepening opportunities that fold in naturally afterward:

- **Candidate 2 — `LocationResolver`:** single store/delivery-context resolver hiding the address→serviceability→order fallback precedence (replaces 5 scattered `storeId` resolutions). Layers over `ZeptoClient`.
- **Candidate 3 — `SessionStore`:** typed setters + write-through persistence (subsumed here as the `SessionStore` port).
- **Candidate 4 — OTP login orchestrator:** unify the 3 parallel OTP implementations (CLI / TUI / Playwright) behind `sendOtp`/`verifyOtp` (partially absorbed here).
