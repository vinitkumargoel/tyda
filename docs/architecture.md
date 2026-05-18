# Architecture

## Process model

`tyda` runs as **two processes**:

1. **Mock server** (`src/server/`) — Fastify app on `127.0.0.1:8787` that exposes three MCP
   endpoints (`/food`, `/im`, `/dineout`) plus the OAuth 2.1 PKCE surface.
2. **TUI client** (`src/tui/`) — Ink app that holds three `Client` instances (one per MCP
   endpoint) and routes slash commands to the appropriate one.

Each one is a normal Node 22 process. They communicate over HTTP only. No IPC, no shared
memory, no sockets — by design, so production swap is just a base-URL change.

## Big picture

```
┌────────────────────────────────────────────────────────────────────┐
│  TUI process  (npm run tui)                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Ink App                                                       │  │
│  │   <Transcript />  (scrollable list of ToolCall + Response)    │  │
│  │   <SlashInput />  (with suggestions + history)                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  Slash router  →  MCP client (StreamableHTTP transport)            │
└────────────────────────┬───────────────────────────────────────────┘
                         │  HTTPS + Bearer (Streamable HTTP)
                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  Mock server process  (npm run mock — http://127.0.0.1:8787)       │
│  ┌──────────────┬──────────────┬──────────────┐                    │
│  │ POST /food   │ POST /im     │ POST /dineout│   3 MCP servers    │
│  │ (+ GET SSE)  │ (+ GET SSE)  │ (+ GET SSE)  │   independent      │
│  └──────┬───────┴───────┬──────┴──────┬───────┘                    │
│         │   shared infra, independent state boundaries  │          │
│  ┌─────────────────────────────────────────────────────┐           │
│  │ OAuth (PKCE): /auth/authorize, /auth/token,         │           │
│  │   /auth/logout, /.well-known/oauth-*                │           │
│  │ State store: ~/.tyda-swiggy/state.json (0600, mutex)│           │
│  │ Fixtures:    fixtures/{restaurants,products,…}.json │           │
│  │ Lifecycle:   order state machine ticker             │           │
│  │ Sim:         ETA, coupons, OOS, driver position     │           │
│  └─────────────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────────────┘
```

## Why Streamable HTTP

Swiggy's production MCP uses **Streamable HTTP**, not stdio. Each server is a single HTTP
endpoint that accepts:

- `POST` (required) — JSON-RPC tool calls.
- `GET` with `Accept: text/event-stream` (optional) — server-initiated SSE notifications.

This matters for the TUI because it means we can hit `https://mcp.swiggy.com/food` exactly the
same way we hit `http://127.0.0.1:8787/food` — no transport-layer code differs. The MCP TS SDK's
`StreamableHTTPClientTransport` handles both. By contrast, stdio MCP servers spawn subprocesses
and pipe over fd 0/1; that model would have made the production swap painful.

Our mock enforces the protocol-level conformance Swiggy's production will:

- Bad `Accept` header → `406`.
- `Origin` outside `127.0.0.1`/`localhost` → `403` (DNS-rebinding defense).
- `Mcp-Session-Id` echoed if the client sends one.
- Missing or expired bearer → `401` (no silent refresh; TUI re-runs PKCE).

These rules are tested in `tests/conformance/streamable-http.test.ts`.

## Three state boundaries

The Swiggy docs are explicit: **Food, Instamart, and Dineout do not share carts, orders, or
sessions.** The mock honors this contract:

- `POST /food` only ever sees `state.carts.food`, `state.orders.food`, etc.
- `POST /im` only ever sees `state.carts.instamart`, `state.orders.instamart`.
- `POST /dineout` only ever sees `state.bookings`.

The state file (`~/.tyda-swiggy/state.json`) has these as separate top-level keys; handlers
never reach across. The TUI's `/orders` aggregates across the three when convenient for the
user, but no MCP tool does — that's a TUI-only convenience.

`get_addresses` and `create_address` are intentionally shared between Food and Instamart (per
Swiggy spec). The address store is a single key the two domains share read-only access to.

## File ownership map

| Folder / file | Owner |
| --- | --- |
| `src/server/http.ts` | Streamable HTTP conformance (Accept, Origin, session id). |
| `src/server/oauth/` | PKCE, JWT, well-known metadata. |
| `src/server/store.ts` | JSON-file state, atomic writes, per-process mutex. |
| `src/server/sim/` | Order state machine, driver tick, ETA, OOS inventory. |
| `src/server/handlers/<server>/` | One file per tool — business logic only. |
| `src/server/mcp/<server>.ts` | Wires handlers into the MCP JSON-RPC surface. |
| `src/server/logger.ts`, `src/server/index.ts` | Bootstrap + logging. |
| `src/shared/schemas/` | Zod schemas, one per tool — single source of truth for shapes. |
| `src/shared/tool-index.ts` | `ALL_TOOLS = { food: [...14], instamart: [...13], dineout: [...8] }`. |
| `src/shared/types.ts`, `src/shared/response.ts`, `src/shared/zod-to-openai.ts` | Shared utility types. |
| `src/tui/cli.ts`, `src/tui/app.tsx` | TUI bootstrap, Ink root. |
| `src/tui/mcp-client.ts` | Three `Client` instances over Streamable HTTP. |
| `src/tui/oauth-flow.ts` | Browser spawn, loopback callback, token exchange. |
| `src/tui/config.ts` | `~/.tyda-swiggy/config.yml` loader. |
| `src/tui/token-store.ts` | Reads/writes the cached JWT. |
| `src/tui/slash/registry.ts` | Central command table. |
| `src/tui/slash/parser.ts` | `/foo a b` → `{ cmd, argv }`. |
| `src/tui/slash/commands/` | One file per command family. |
| `src/tui/ui/transcript.tsx`, `src/tui/ui/input.tsx`, `src/tui/ui/theme.ts` | TUI shell. |
| `src/tui/ui/render/` | One component per response shape. |
| `src/tui/ai/` | Optional LLM bridge (Wave 4). |
| `src/tui/data/` | Baked tables (Bangalore areas). |
| `fixtures/` | Bangalore seed data. Pure JSON. |
| `spec/` | Pinned `.md` twins of the Swiggy docs. **The contract.** |
| `tests/unit/` | Vitest suites — handlers, schemas, sim, renderers, slash parser. |
| `tests/conformance/` | Streamable HTTP conformance. |
| `tests/e2e/` | Headless happy-path harness. |

## A 5-stop tour of the code

When you sit down to read the repo, hit these files in this order — you'll have the full mental
model in 20 minutes:

1. **`spec/reference-index.md`** — the contract. 35 tools, 3 servers, exact endpoint paths.
2. **`src/shared/tool-index.ts`** — proves the snapshot matches the code (14/13/8 counts).
3. **`src/server/mcp/food.ts`** — see how a single MCP server is wired: tool list, JSON-RPC
   dispatch, handler invocation, auth pre-handler, sim hook.
4. **`src/server/sim/order-state.ts`** — the ticker that makes the mock "feel alive."
5. **`src/tui/slash/registry.ts`** + **`src/tui/slash/commands/demo.ts`** — every command the
   user can type and the canonical scripted demo. From here you can trace any slash command
   back through `src/tui/mcp-client.ts` into the mock and you've covered the whole loop.
