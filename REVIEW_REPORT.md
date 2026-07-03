# Tyda Swiggy MCP Repository Review

Generated: 2026-05-19 (Asia/Kolkata)

## Scope

Reviewed the current repository state against:

- Live Swiggy Builders Club reference: `https://mcp.swiggy.com/builders/docs/reference/`
- Live Swiggy auth docs: `https://mcp.swiggy.com/builders/docs/start/authenticate/`
- Live Swiggy agent docs: `https://mcp.swiggy.com/builders/docs/start/developer/build-an-agent/`
- Local docs and specs: `README.md`, `docs/`, `spec/`
- Implementation: `src/server/`, `src/tui/`, `src/shared/`
- Tests: `tests/unit/`, `tests/conformance/`, `tests/e2e/`

At review time, `git status` showed only this report as untracked; tracked source files were clean against the current branch.

## Executive Summary

The repo is working for its local mock + TUI purpose. The implementation matches the active Swiggy MCP reference table: 35 tools across Food, Instamart, and Dineout.

Validation passed:

```text
npm run typecheck: passed
npm run build: passed
npm test: 30 test files passed, 200 tests passed
e2e happy path: placed food order and tracked it through DELIVERED
npm run mock: server started on http://127.0.0.1:8787
/healthz: {"ok":true}
unauthenticated /food: HTTP 401 invalid_token
```

Compared with the previous review, two important protocol issues are now fixed in source:

- Invalid tool params now return JSON-RPC `-32602 Invalid params` before handler execution.
- Unsupported JSON-RPC methods now return JSON-RPC `-32601 Method not found` consistently across Food, Instamart, and Dineout.

Remaining concerns are production access, Node version alignment, OAuth fallback completeness, and token storage hardening.

## Swiggy MCP Reference Check

The live Swiggy docs currently contain a small inconsistency:

- The page body/reference table says 35 tools total: Food 14, Instamart 13, Dineout 8.
- The sidebar labels show Food 15, Instamart 14, Dineout 9.

The repo matches the body/reference table and the local snapshot:

| Server | Endpoint | Swiggy table | Repo |
| --- | --- | ---: | ---: |
| Food | `POST /food` | 14 | 14 |
| Instamart | `POST /im` | 13 | 13 |
| Dineout | `POST /dineout` | 8 | 8 |

This looks like an upstream docs navigation/count issue, not a repo issue.

## What Is Working

### Tool Coverage

Working.

Evidence:

- `spec/reference-index.md` lists 14/13/8.
- `docs/mcp-tools.md` lists all 35 tools.
- `src/shared/tool-index.ts` defines all 35 tools.
- `tests/unit/tool-count.test.ts` asserts counts, names, schemas, and mutating flags.

### Mock MCP Server

Working.

The server mounts:

- `POST /food`
- `POST /im`
- `POST /dineout`
- `GET /food`, `/im`, `/dineout` SSE heartbeat routes
- `/auth/authorize`
- `/auth/token`
- `/auth/logout`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/healthz`

Direct smoke results:

```text
GET /healthz -> {"ok":true}
POST /food without bearer -> HTTP 401 invalid_token
```

### OAuth 2.1 PKCE

Working for the local mock.

The repo matches the main Swiggy auth contract:

- OAuth 2.1 with PKCE S256
- Bearer token for MCP calls
- 5-day access token
- no refresh-token flow
- 401 triggers reauthorization

The dispatcher re-auth path is covered by tests.

### Streamable HTTP Conformance

Working.

The conformance suite covers:

- `Accept` handling for JSON POST and SSE GET
- origin guard
- session ID mint/echo
- JSON-RPC envelope shape
- missing bearer token rejection

### JSON-RPC Strictness

Improved and working in source.

Invalid tool args now return:

```text
JSON-RPC error -32602 Invalid params
```

Unknown JSON-RPC methods now return:

```text
JSON-RPC error -32601 Method not found
```

This is implemented consistently in:

- `src/server/mcp/food.ts`
- `src/server/mcp/instamart.ts`
- `src/server/mcp/dineout.ts`

### End-to-End Food Flow

Working.

The E2E happy path completed:

1. `get_addresses`
2. `search_restaurants`
3. `get_restaurant_menu`
4. `update_food_cart`
5. `get_food_cart`
6. `place_food_order`
7. `track_food_order` until `DELIVERED`

### TUI and Slash Layer

Working based on automated tests.

Covered areas include parser, smoke rendering, Food/Instamart/Dineout slash commands, renderers, AI loop, and AI tool bridge.

I did not run a manual interactive TUI session in this review.

## What Is Not Verified

### Real Swiggy Production MCP

Not verified.

The repo is designed to switch to:

```bash
npm run tui -- --remote https://mcp.swiggy.com
```

But real production calls require Swiggy Builders Club access, registered redirect URIs, and OAuth approval. I verified the live docs and local mock compatibility, not real production tool calls.

## Remaining Issues / Risks

### 1. Runtime Version Mismatch

`package.json` declares Node `>=22`, but the current shell is:

```text
node v20.17.0
npm 10.8.2
```

The project still builds and tests successfully here, but the local/CI runtime should be moved to Node 22+ to match the declared contract.

### 2. OAuth Manual Fallback Is Only Partially Fixed

The code now has `onAuthorizeUrl` support and writes a fallback URL to stderr if `openBrowser()` returns `false`.

Remaining gap:

- `src/tui/cli.ts` does not pass `onAuthorizeUrl` into `createDispatcher()`, so the Ink UI still does not surface the URL in the transcript.
- `defaultOpenBrowser()` returns immediately after spawning; many spawn failures arrive asynchronously through the child `error` event, after the function has already returned `true`.

Impact:

- Headless/SSH browser-open failures may still hang until timeout without a reliable visible URL in the TUI.

Recommended fix:

- Always surface the authorize URL through `onAuthorizeUrl` before browser launch, and wire that callback into the TUI transcript.
- Add a unit test for browser-open failure/manual URL surfacing.

### 3. New JSON-RPC Strictness Needs Dedicated Tests

The source now returns `-32602` for invalid params and `-32601` for unknown methods. The full suite passes, but I did not find direct tests asserting those new error contracts.

Recommended fix:

- Add conformance/unit tests for invalid params on each server.
- Add conformance/unit tests for unknown JSON-RPC methods on each server.

### 4. Token Storage Is Still Not Production-Hardened

Tokens are stored as JSON under `~/.tyda-swiggy/token.json` with mode `0600`.

This is acceptable for local mock usage. For real Swiggy production tokens, use an OS keychain or equivalent secure storage, matching the live Swiggy docs guidance to avoid plaintext disk logging/storage.

### 5. Production Tool Count Drift Should Be Watched

The live docs sidebar currently suggests larger per-domain counts than the reference table. If Swiggy adds tools and updates the table later, the repo will need a spec refresh.

Recommended fix:

- Keep `spec/SNAPSHOT.txt` current.
- Add a small docs/spec refresh checklist for future Swiggy MCP updates.

## Validation Log

Commands run:

```bash
node -v
npm -v
npm run typecheck
npm run build
npm test
npm run mock
curl -sS http://127.0.0.1:8787/healthz
curl -sS -i -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  http://127.0.0.1:8787/food
```

Results:

```text
node: v20.17.0
npm: 10.8.2
typecheck: passed
build: passed
test: 30 passed / 200 tests passed
e2e: happy path delivered
healthz: {"ok":true}
unauthenticated /food: HTTP 401 invalid_token
```

Note: localhost binding required elevated permission in this Codex sandbox. This is expected for this environment and not a repo defect.

## Recommended Next Actions

1. Wire `onAuthorizeUrl` into the TUI so OAuth manual login is always visible to the user.
2. Add tests for JSON-RPC `-32602` invalid params and `-32601` unknown method behavior.
3. Run local and CI validation on Node 22+.
4. Replace plaintext production token storage before using real Swiggy credentials.
5. Re-check live Swiggy docs before production integration because the sidebar/table counts currently disagree.

