# OAuth 2.1 PKCE

`tyda` implements the Swiggy OAuth 2.1 PKCE contract end-to-end against the mock. Production
swap is by base URL only — no code path differs.

## The contract

- **PKCE S256.** Public client, no client secret. Verifier is per-attempt.
- **5-day access token.** RS256 JWT issued by the mock; expires in 5 days.
- **No refresh token.** Matches Swiggy v1.0 — they aren't wired in prod either.
- **401 → re-authorize.** On expiry, the TUI clears the cached token and re-runs PKCE. It does
  **not** attempt a silent refresh.
- **Sliding 30-day user session** on the mock side; if your access token has expired but your
  session is still alive, you'll skip the approval page on the next `/authorize` round-trip.

## Endpoints

All paths are spec-accurate so the production swap is a base-URL change:

| Path | Method | Purpose |
| --- | --- | --- |
| `/.well-known/oauth-authorization-server` | GET | Authorization-server metadata. Lists `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, supported PKCE methods, etc. |
| `/.well-known/oauth-protected-resource` | GET | Protected-resource metadata. Lists which MCP endpoints accept the issued token and which authorization server to use. |
| `/auth/authorize` | GET | Renders a small "Approve `tyda`?" HTML page; on approve, redirects to the TUI's loopback URI with `code=...`. |
| `/auth/token` | POST | Verifies the PKCE `code_verifier` against the stored `code_challenge`, issues a 5-day RS256 JWT. |
| `/auth/logout` | POST | Revokes the active session entry in the state file. |

The TUI discovers all of these via `/.well-known/`. Nothing is hardcoded.

## Sequence

```
 TUI                                 Mock                            Browser
  │                                   │                                 │
  ├─ GET /.well-known/oauth-* ───────▶│                                 │
  │◀───────── metadata ───────────────┤                                 │
  │                                   │                                 │
  │ verifier = random(43..128 chars)  │                                 │
  │ challenge = base64url(sha256(v))  │                                 │
  │ listen on http://127.0.0.1:PORT/callback                            │
  │                                   │                                 │
  ├─ spawn browser ──────────────────────────────────────────────────▶ │
  │                                                                     │
  │             Browser ─ GET /auth/authorize?response_type=code        │
  │                       &code_challenge=...&code_challenge_method=S256│
  │                       &redirect_uri=http://127.0.0.1:PORT/callback ▶│
  │                                   │                                 │
  │                                   │       (HTML approve page)       │
  │                                   │◀──── user clicks Approve ───────┤
  │                                   │                                 │
  │                                   │── 302 redirect_uri?code=AUTH ──▶│
  │                                                                     │
  │◀───── loopback GET /callback?code=AUTH ────────────────────────────┤
  │                                   │                                 │
  ├─ POST /auth/token ───────────────▶│                                 │
  │   { grant_type: "authorization_code",                               │
  │     code: AUTH, code_verifier: V, ...}                              │
  │◀───── { access_token: JWT, token_type: "Bearer", expires_in: 432000 }│
  │                                   │                                 │
  │ store at ~/.tyda-swiggy/token.json (mode 0600)                      │
  │                                                                     │
  │── POST /food with Authorization: Bearer JWT ────────────────────────▶
```

If the mock is started with `--auto-approve`, step 4 (the HTML approve page) is skipped and the
authorization endpoint redirects immediately. Useful for demo recordings and CI.

## How the mock validates PKCE

`src/server/oauth/token.ts`:

1. Look up the `code` in the in-memory authorization-code store. If missing/expired, reject.
2. Read the stored `code_challenge` and `code_challenge_method` for that code.
3. Compute `expected = base64url(sha256(code_verifier))`.
4. Constant-time compare against the stored challenge. Mismatch → `invalid_grant`.
5. Single-use: delete the entry so the same `code` can't be redeemed twice.
6. Sign and return the JWT.

`tests/unit/oauth-pkce.test.ts` and `tests/unit/pkce.test.ts` cover the math and the redemption
edge cases.

## How the TUI handles the loopback redirect

`src/tui/oauth-flow.ts`:

1. Bind a one-shot HTTP listener on `http://127.0.0.1:0/callback` (port 0 → kernel-assigned).
2. Spawn the user's default browser at the authorize URL with that loopback `redirect_uri`.
3. Wait for the redirect; pull `code` (and `state`, if present) out of the query string.
4. Close the listener immediately (one and done).
5. POST to the token endpoint with `code` + `code_verifier`.
6. Persist the JWT via `src/tui/token-store.ts`.

If the browser spawn fails (tmux, SSH, headless container), the TUI prints the authorize URL
and waits for you to paste it into any browser that can reach `127.0.0.1`.

## Token storage

- **v1 (current):** plain JSON at `~/.tyda-swiggy/token.json`, file mode `0600`. The mock issues
  test-only tokens; leaking one is not a real-world risk.
- **Prod hardening (planned):** migrate to OS keychain via `keytar`. **Never** write a real
  Swiggy production token to a plain JSON file.

There is no separate refresh token. Once your access token expires, the next 401 triggers a
clean re-run of PKCE and a new token is written in place.

## Logout

`/login` followed by `--logout` (or `POST /auth/logout` directly) revokes the active session in
the state file. The cached token is also deleted. Next slash command triggers a fresh PKCE
flow.
