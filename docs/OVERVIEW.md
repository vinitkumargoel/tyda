# tyda — Project Overview

`tyda` is a developer-focused terminal client for Swiggy's MCP stack. It exposes all three
Swiggy MCP servers — Food (14 tools), Instamart (13), Dineout (8), **35 tools total** — through
a slash-command REPL that feels like Claude Code: scrollable transcript, tight input box, no
full-screen panes. A built-in mock server reproduces the Swiggy MCP contract faithfully enough
that the same TUI binary will work against production by passing `--remote
https://mcp.swiggy.com`. Built for the **Swiggy Builders Club** contest, 2026.

## Acceptance path vs. enhancement path

`tyda` was scoped against two paths that **never block each other**:

- **Acceptance path** — what makes the project "done": `/demo biryani` runs end-to-end against
  the mock, the order transitions `PLACED → PREPARING → OUT_FOR_DELIVERY → DELIVERED`, and the
  pinned tracker reflects rider position live. Built across Waves 0–3.
- **Enhancement path** — `/ai <prompt>` hands intent to a user-configured LLM with all 35 MCP
  tools exposed via OpenAI function-calling. Off by default. Wave 4. If the user never
  configures a token, the command is hidden and the rest of the TUI behaves identically.

Everything in this repo is organized around that split. The mock, the slash commands, and the
conformance tests live on the acceptance path; the `/ai` bridge lives in `src/tui/ai/` and is
independently shippable.

## How everything connects

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

The TUI never knows it's talking to a mock. Production swap requires no MCP tool-path changes —
the path segments (`/food`, `/im`, `/dineout`, `/auth/authorize`, `/auth/token`) are already
spec-accurate, and the TUI rediscovers them via `/.well-known/`. What will differ in production:
the registered `client_id`, redirect-URI allowlisting, and real signing keys in the OAuth
metadata. Those land via config, not code.

## Three servers, three state boundaries

Per Swiggy's docs the three MCP servers don't share carts, orders, or sessions. The mock keeps
internal services (fixtures, the order ticker, the state store) DRY, but externally each MCP
surface only sees its own slice of state — Food never returns Instamart carts, etc. The TUI may
aggregate orders across servers in `/orders` for convenience; the MCP surface never does.

## Table of contents

| Doc | Topic |
| --- | --- |
| [getting-started.md](getting-started.md) | Install, two-terminal run model, the six most useful slash commands, troubleshooting. |
| [architecture.md](architecture.md) | Process model, the diagram above, why Streamable HTTP, state boundaries, file ownership map, the 5-stop code tour. |
| [mcp-tools.md](mcp-tools.md) | Reference table for all 35 tools, grouped by server, linked back to the upstream `mcp.swiggy.com` docs. |
| [slash-commands.md](slash-commands.md) | Every slash command, every argument, every example. Cross-domain routing for `/add`, `/cart`, `/order`, `/track`. |
| [oauth-pkce.md](oauth-pkce.md) | OAuth 2.1 PKCE contract: 5-day token, no refresh, 401 → re-authorize. PKCE sequence, loopback redirect, token storage. |
| [simulation.md](simulation.md) | "Alive" rules: order state machine, driver tick, ETA, OOS, slot decay, coupon engine. |
| [development.md](development.md) | Repo structure, npm scripts, test layers, multi-agent ownership tracks, adding a new tool. |
| [swiggy-contest.md](swiggy-contest.md) | Contest framing: scope, production-swap dry-run, differentiators. |

## Acknowledgements

- **Swiggy Builders Club** for opening up the MCP spec and running the contest at
  [mcp.swiggy.com/builders/docs/](https://mcp.swiggy.com/builders/docs/).
- **Anthropic** and the broader MCP working group for the [Model Context Protocol
  spec](https://modelcontextprotocol.io/) and the official TypeScript SDK.
- **[Ink](https://github.com/vadimdemedes/ink)** — React for the terminal. Carries the entire
  TUI rendering layer.
- **[Fastify](https://fastify.dev/)** — the HTTP framework under the mock server.
- **Claude Code TUI** — the slash-command UX that this repo deliberately mimics.
- **`@modelcontextprotocol/sdk`, `zod`, `jose`, `openai`, `yaml`, `tsx`, `vitest`** — every
  dependency in `package.json` is doing real work.
