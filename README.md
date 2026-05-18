# tyda — Swiggy MCP TUI

> Order Food, Instamart, and Dineout from your terminal. Slash commands, live tracker, zero
> mouse — built on Swiggy's MCP spec, ships with a high-fidelity local mock.

```
 tyda — Swiggy MCP terminal (mock @ http://127.0.0.1:8787)
 ─────────────────────────────────────────────────────────
 Signed in as +91-9XXXXX-1234  •  Koramangala 4th Block

 > /search biryani

 ▼ search_restaurants  ✓ 240ms
   1. Meghana Foods — Residency Rd       ★ 4.5  ~32 min   ₹350/2
   2. Empire Restaurant — Koramangala    ★ 4.3  ~28 min   ₹300/2
   3. Donne Biryani House — HSR          ★ 4.2  ~25 min   ₹250/2

 > /add M01 2
 ▼ update_food_cart  ✓ 90ms   Cart: 2× Chicken Biryani — subtotal ₹658

 > /order
 ▼ place_food_order  ✓ 320ms
   ✔ Order #FD-2026-05-18-0042 placed  •  ETA 28 min
   [████████░░░░░░░░░░░░░░] PREPARING   elapsed 03:12
   Rider: Ramesh K • 1.8 km away • ETA 24 min

 ▌ _
```

✔ All 35 Swiggy MCP tools mocked   •   ✔ OAuth 2.1 PKCE   •   ✔ 192 tests   •   built for
**Swiggy Builders Club 2026**.

## Quickstart

```bash
npm install
```

Two terminals. In the first:

```bash
npm run mock
```

In the second:

```bash
npm run tui
```

Then in the TUI:

```
> /demo biryani
```

…and watch the order go from `PLACED` to `DELIVERED` with a live tracker.

## What's inside

- **Mock server** — Fastify + `@modelcontextprotocol/sdk` over Streamable HTTP. Implements all
  35 Swiggy MCP tools across `/food`, `/im`, `/dineout`, plus OAuth 2.1 PKCE.
- **TUI** — Ink-based slash-command REPL. Scrollable transcript, pinned live order tracker,
  optional `/ai` LLM pane.
- **Spec snapshot** — pinned `.md` twins of every Swiggy reference doc under `spec/`. The build
  and conformance tests assert against this snapshot.
- **35 MCP tools** — 14 Food, 13 Instamart, 8 Dineout. See [docs/mcp-tools.md](docs/mcp-tools.md).

## Configuration

Optional `~/.tyda-swiggy/config.yml` (copy from [`config.example.yml`](config.example.yml)):

```yaml
llm:
  base_url: https://gateway.requestly.io/v1
  token:    rqly_XXXXXXXXXXXXXXXXXXXX
  model:    gpt-4o-mini
swiggy:
  remote: http://127.0.0.1:8787
  demo_speed: fast
```

CLI flags beat env vars (`TYDA_LLM_TOKEN`, `TYDA_LLM_BASE_URL`, `TYDA_LLM_MODEL`) beat the YAML.

## Production swap

When Swiggy ships builder access, point `tyda` at the real MCP with no code changes:

```bash
npm run tui -- --remote https://mcp.swiggy.com
```

## Project status

Acceptance path is complete: `/demo biryani`, `/demo groceries`, `/demo tables` all run
end-to-end against the mock. The full design, tooling, and roadmap live in
[docs/OVERVIEW.md](docs/OVERVIEW.md).

| Doc | What's in it |
| --- | --- |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | Single-page tour. Start here. |
| [docs/getting-started.md](docs/getting-started.md) | Install, run, troubleshoot. |
| [docs/architecture.md](docs/architecture.md) | Process model, file map, code tour. |
| [docs/mcp-tools.md](docs/mcp-tools.md) | All 35 tools, per server, with upstream links. |
| [docs/slash-commands.md](docs/slash-commands.md) | Every slash command, every argument. |
| [docs/oauth-pkce.md](docs/oauth-pkce.md) | The Swiggy OAuth 2.1 PKCE contract. |
| [docs/simulation.md](docs/simulation.md) | "Alive" rules for the mock. |
| [docs/development.md](docs/development.md) | Repo layout, npm scripts, test layers. |
| [docs/swiggy-contest.md](docs/swiggy-contest.md) | Why this is in scope, what's differentiated. |

## Contributing

`tyda` is split into ownership tracks so multi-agent and multi-human contributors don't collide.
Stay inside your track:

| Folder | Owner |
| --- | --- |
| `src/server/oauth/`, `src/server/http.ts`, `src/server/store.ts` | Server core (Track A) |
| `src/shared/schemas/`, `src/shared/tool-index.ts` | Schemas (Track B) |
| `src/server/sim/` | Sim engine (Track C) |
| `src/tui/app.tsx`, `src/tui/ui/`, `src/tui/slash/parser.ts`, `src/tui/slash/registry.ts` | TUI shell (Track D) |
| `src/tui/mcp-client.ts`, `src/tui/oauth-flow.ts`, `src/tui/config.ts` | TUI client (Track E) |
| `src/server/handlers/food/`, `src/server/mcp/food.ts`, `src/tui/slash/commands/food.ts` | Food (Track F) |
| `src/server/handlers/instamart/`, `src/server/mcp/instamart.ts`, `src/tui/slash/commands/instamart.ts` | Instamart (Track G) |
| `src/server/handlers/dineout/`, `src/server/mcp/dineout.ts`, `src/tui/slash/commands/dineout.ts` | Dineout (Track H) |
| `src/tui/ui/render/` | Renderers (Track I) |
| `src/tui/slash/commands/misc.ts` | Address/auth slash (Track J) |
| `tests/conformance/`, `tests/e2e/` | Conformance & e2e (Track K) |
| `src/tui/ai/`, `src/tui/slash/commands/ai.ts` | LLM enhancement (Wave 4) |

Run `npm test` (which includes the conformance suite) before opening a PR. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full flow.

## License

MIT. See [LICENSE](LICENSE).
