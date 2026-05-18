# Swiggy Builders Club 2026

`tyda` is built for Swiggy's MCP Builders Club contest. This doc captures why it's in scope and
what makes it differentiated.

## Why this is in scope

Swiggy's MCP stack ([mcp.swiggy.com/builders/docs/](https://mcp.swiggy.com/builders/docs/))
exposes three production servers (Food, Instamart, Dineout) over Streamable HTTP with OAuth 2.1
PKCE. The contest brief is to build something useful on top of those 35 tools. `tyda` is the
agent-shaped reference client:

- **All 35 tools wired.** Not a subset — every Food, Instamart, and Dineout tool is reachable
  through the TUI. See [docs/mcp-tools.md](mcp-tools.md).
- **All three canonical recipes implemented.** `order-food.md`, `order-groceries.md`, and
  `book-a-table.md` from Swiggy's `build/recipes/` are replayable end-to-end via `/demo
  biryani`, `/demo groceries`, `/demo tables`.
- **Spec-accurate endpoints.** `POST /food`, `POST /im`, `POST /dineout`, `/auth/authorize`,
  `/auth/token`, `/.well-known/oauth-*` — the production swap is a base-URL change, nothing
  more.
- **OAuth 2.1 PKCE done correctly.** 5-day RS256 JWT, no refresh, 401 → re-authorize. See
  [docs/oauth-pkce.md](oauth-pkce.md).
- **High-fidelity mock so it's reviewable today.** Production builder access isn't open yet;
  `tyda` ships its own mock so judges can clone, install, and run `/demo biryani` in under five
  minutes.

## Production-swap dry run

Once Swiggy ships builder access to your account:

```bash
# 1. Install your real client_id and redirect URI via config.
cat > ~/.tyda-swiggy/config.yml <<'EOF'
swiggy:
  remote: https://mcp.swiggy.com
  client_id: <your-registered-client-id>
EOF

# 2. Run the TUI against production. No code changes.
npm run tui -- --remote https://mcp.swiggy.com
```

The TUI will:

1. Fetch `https://mcp.swiggy.com/.well-known/oauth-authorization-server` to discover the real
   authorize and token endpoints.
2. Run the PKCE flow against those endpoints; your browser will land on Swiggy's real consent
   screen.
3. Receive a real Swiggy access token, store it at `~/.tyda-swiggy/token.json`.
4. Send `POST` requests to `https://mcp.swiggy.com/food` (etc.) with `Authorization: Bearer
   <token>`.

If access hasn't been granted to your account yet, the TUI fails cleanly with:

```
production access not yet granted — apply at mcp.swiggy.com/builders/docs/operate/access/
```

Until then, `npm run mock` is fully sufficient.

## Differentiators

What makes `tyda` worth a judge's time:

- **Agent-shaped slash flows.** Every command is one MCP tool call (or a small composition).
  `/order` calls `place_food_order` or `checkout`; `/track` polls the right `track_*` tool. The
  judge can trace any UX action straight to an MCP tool in seconds.
- **`/demo` recipes.** Zero-config end-to-end demos. Judges don't need an LLM token, a Swiggy
  account, or anything beyond `npm install`. `/demo biryani` runs the canonical 7-tool food
  journey in 30 seconds with live tracker.
- **Configurable LLM for `/ai`.** Optional Wave-4 enhancement: bring your own OpenAI-compatible
  endpoint (Requestly default), and the same 35 tools become an agent surface. Hidden if not
  configured — never a load-bearing path.
- **Comprehensive mock for offline development.** Order state machine, driver tick, OOS
  inventory, slot decay, coupon engine — everything you'd want from a sandbox. See
  [docs/simulation.md](simulation.md).
- **192 tests across three layers.** Unit, conformance, and headless e2e. The conformance suite
  guards every commit against Streamable HTTP regressions and tool-count drift.
- **Multi-agent build process.** Wave 0 → Wave 4 with file ownership partitioned across 11
  tracks. The same ownership map applies to human contributors — see
  [docs/development.md](development.md).
- **No mouse, no GUI, no daemon.** It's a TUI. It lives in your terminal next to your code.
  That's the point.

## Future work (post-contest)

- **Real prod credentials.** Apply for builder access; verify the dry run lands on the real
  Swiggy consent screen.
- **OS keychain token storage** (currently plain JSON at `~/.tyda-swiggy/token.json`).
- **Refresh tokens** when Swiggy wires them.
- **Widget renderers** — Swiggy's spec includes richer widget shapes we currently render as
  plain data.
- **Payment beyond mock "pay on delivery."**
- **Multi-tenant / delegated auth** for shared-workspace use cases.
