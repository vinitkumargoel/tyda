# Development

## Repo structure

```
tyda-swiggy/
├─ package.json            bin: { "tyda": "dist/tui/cli.js" }
├─ tsconfig.json
├─ vitest.config.ts
├─ config.example.yml      copy to ~/.tyda-swiggy/config.yml
├─ fixtures/               Bangalore seed data
│  ├─ restaurants.json
│  ├─ products.json
│  ├─ dineout.json
│  └─ coupons.json
├─ spec/                   pinned Swiggy .md twins (the contract)
│  ├─ food/*.md            14 files
│  ├─ instamart/*.md       13 files
│  ├─ dineout/*.md         8 files
│  ├─ start/authenticate.md
│  ├─ recipe-*.md          canonical end-to-end flows
│  └─ SNAPSHOT.txt
├─ src/
│  ├─ shared/
│  │  ├─ schemas/          Zod schemas, one file per tool (35 files)
│  │  ├─ types.ts          inferred TS types
│  │  ├─ tool-index.ts     ALL_TOOLS = { food: [...14], instamart: [...13], dineout: [...8] }
│  │  ├─ response.ts       shared envelope helpers
│  │  └─ zod-to-openai.ts  schema converter for /ai
│  ├─ server/
│  │  ├─ index.ts          bootstrap
│  │  ├─ http.ts           Streamable HTTP conformance
│  │  ├─ store.ts          JSON-file state, atomic writes
│  │  ├─ logger.ts
│  │  ├─ oauth/            PKCE, JWT, well-known
│  │  ├─ mcp/              one file per server: food.ts, instamart.ts, dineout.ts
│  │  ├─ handlers/         one file per tool, grouped by server
│  │  └─ sim/              order state, driver, eta, inventory
│  └─ tui/
│     ├─ cli.ts            entry; parses --remote, --demo-speed
│     ├─ app.tsx           Ink root
│     ├─ config.ts         config.yml loader
│     ├─ mcp-client.ts     3 Streamable HTTP MCP clients
│     ├─ oauth-flow.ts     PKCE loopback + browser spawn
│     ├─ token-store.ts    ~/.tyda-swiggy/token.json
│     ├─ data/             baked tables (bangalore-areas)
│     ├─ slash/
│     │  ├─ registry.ts    central command table
│     │  ├─ parser.ts      /foo a b → { cmd, argv }
│     │  └─ commands/      one file per family: food, instamart, dineout, misc, composite, demo
│     ├─ ai/               optional LLM bridge (Wave 4)
│     └─ ui/
│        ├─ transcript.tsx
│        ├─ input.tsx
│        ├─ theme.ts
│        └─ render/        per-response components
└─ tests/
   ├─ unit/                vitest unit tests
   ├─ conformance/         streamable-http.test.ts
   └─ e2e/                 headless happy-path harness
```

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run mock` | Start the mock Swiggy MCP server on `127.0.0.1:8787`. |
| `npm run tui` | Start the TUI client. |
| `npm run build` | Compile TypeScript to `dist/`. Needed for `npm link` / publish, not for dev. |
| `npm run typecheck` | `tsc --noEmit` — fast type check without writing output. |
| `npm test` | Run Vitest unit + conformance + e2e once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run format` | Prettier over `src/` and `tests/`. |

`tsx` runs the TypeScript directly. There's no compile step for `mock` or `tui`.

## Test layers

Three independent layers, each fast and focused:

1. **Unit (`tests/unit/`)** — Vitest. Handler logic per tool, schema validity, sim transitions,
   slash parser, PKCE math, renderers. Should run in <5 s locally.
2. **Conformance (`tests/conformance/`)** — protocol-level guarantees: tool counts match the
   spec snapshot, Streamable HTTP edge cases (bad `Accept` → 406, foreign `Origin` → 403,
   missing/expired bearer → 401), `Mcp-Session-Id` echoing, well-known metadata shape.
   **Run this before every PR.**
3. **E2E (`tests/e2e/`)** — headless harness that spawns the mock, drives the three MCP clients
   directly (no Ink), and runs the biryani recipe end-to-end. Asserts final order state is
   `DELIVERED`. PKCE is tested in its own module test, not bundled into the e2e (no browser in
   CI).

There's also an Ink smoke test (`tests/unit/tui-smoke.test.tsx`) that mounts the TUI in
`ink-testing-library` and snapshots a few transcripts.

## Multi-agent build: ownership tracks

`tyda` was built by **five agents in parallel** in Wave 1 and six in Wave 2, with file
ownership partitioned so they never wrote to the same file. New contributors should respect the
same boundaries:

| Track | Owns | Produces |
| --- | --- | --- |
| **A — Server core** | `src/server/http.ts`, `src/server/oauth/`, `src/server/store.ts`, `src/server/logger.ts`, `src/server/index.ts` | Fastify app, PKCE endpoints, state store. |
| **B — Schemas** | `src/shared/schemas/`, `src/shared/types.ts`, `src/shared/tool-index.ts`, `src/shared/zod-to-openai.ts` | One Zod schema per tool, the tool index, the OpenAI converter. |
| **C — Sim engine** | `src/server/sim/` | Pure ticker, driver, ETA, inventory. |
| **D — TUI shell** | `src/tui/cli.ts`, `src/tui/app.tsx`, `src/tui/ui/transcript.tsx`, `src/tui/ui/input.tsx`, `src/tui/ui/theme.ts`, `src/tui/slash/registry.ts`, `src/tui/slash/parser.ts` | Ink app, slash parser + registry. |
| **E — TUI client** | `src/tui/mcp-client.ts`, `src/tui/oauth-flow.ts`, `src/tui/config.ts`, `src/tui/token-store.ts` | 3 MCP clients, PKCE flow, config loader. |
| **F — Food** | `src/server/handlers/food/`, `src/server/mcp/food.ts`, `src/tui/slash/commands/food.ts` | 14 Food tools + slash commands. |
| **G — Instamart** | `src/server/handlers/instamart/`, `src/server/mcp/instamart.ts`, `src/tui/slash/commands/instamart.ts` | 13 Instamart tools + slash commands. |
| **H — Dineout** | `src/server/handlers/dineout/`, `src/server/mcp/dineout.ts`, `src/tui/slash/commands/dineout.ts` | 8 Dineout tools + slash commands. |
| **I — Renderers** | `src/tui/ui/render/` | One Ink component per response shape. |
| **J — Address/auth slash** | `src/tui/slash/commands/misc.ts`, `src/tui/slash/commands/composite.ts` | `/help`, `/login`, `/address`, `/quit`, cross-domain composites. |
| **K — Conformance + e2e** | `tests/conformance/`, `tests/e2e/` | Protocol + happy-path harness. |
| **Wave 4 — LLM** | `src/tui/ai/`, `src/tui/slash/commands/ai.ts` | OpenAI-compatible client, tool bridge, agent loop. |

Stay inside your track. If a change touches another track's files, raise it in the PR and tag
the owning track.

## Adding a new tool

When Swiggy ships a new MCP tool, the flow is:

1. **Snapshot the spec.** Curl the new `.md` twin into `spec/<server>/<tool>.md`. Update
   `spec/SNAPSHOT.txt` and the tool count in `spec/reference-index.md`.
2. **Write the Zod schema.** Add `src/shared/schemas/<server>/<tool>.ts` mirroring the spec
   shape. Avoid discriminated unions and refinements with side effects — the schema-conversion
   test will fail on them.
3. **Register in the tool index.** Add the tool to `src/shared/tool-index.ts` under the right
   server. `tests/unit/tool-count.test.ts` will tick its assertion (14 → 15, etc.).
4. **Write the handler.** Add `src/server/handlers/<server>/<tool>.ts`. Read from fixtures and
   state; return a `ToolResult` envelope.
5. **Wire into the MCP server.** Import and add to `HANDLERS` in `src/server/mcp/<server>.ts`.
6. **(Optional) Surface in the TUI.** Add a slash command in
   `src/tui/slash/commands/<server>.ts` and register it in `src/tui/slash/registry.ts`.
7. **Tests.** Unit test the handler against fixtures; if it's a mutating tool, add a sim test;
   if the response shape is new, add a renderer.
8. **Update docs.** Add a row to `docs/mcp-tools.md` and (if user-facing) `docs/slash-commands.md`.

## Style rules

- **ESM everywhere.** `"type": "module"` in `package.json`. Use `.js` import extensions in
  TypeScript imports — that's what NodeNext expects.
- **No `any`.** If you reach for `any`, reach for `unknown` instead and narrow.
- **No emojis in source.** `✔` and `▼` and similar box characters are fine in TUI output;
  decorative emoji isn't.
- **One accent color.** The TUI is intentionally monochrome plus a single accent (defined in
  `src/tui/ui/theme.ts`). Don't add second-tier colors.
- **Box-drawing characters.** Use `─` (U+2500) for separators and `▌` for the prompt cursor —
  match the look established in [docs/OVERVIEW.md](OVERVIEW.md) screenshots.
- **Prettier.** `npm run format` is the source of truth. CI will fail on un-formatted code.
- **Typecheck.** `npm run typecheck` must pass before committing.
