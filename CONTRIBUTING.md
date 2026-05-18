# Contributing

Thanks for picking up `tyda`. This doc is the short version; for full context read
[docs/development.md](docs/development.md) and [docs/architecture.md](docs/architecture.md).

## Clone, install, run tests

```bash
git clone https://github.com/<your-fork>/tyda-swiggy
cd tyda-swiggy
npm install
npm test
```

If `npm test` is green on a fresh clone, you're good to start.

To run the app locally while iterating:

```bash
# Terminal 1
npm run mock

# Terminal 2
npm run tui
```

## Branching model

- `main` is always green: `npm test` passes, `npm run typecheck` passes, `/demo biryani` works.
- Feature work happens on a topic branch: `git checkout -b <yourname>/<short-description>`.
- Open a PR against `main`. Squash-merge when approved.
- No long-lived feature branches. Slice work into small PRs.

## Style enforcement

Run these before pushing:

```bash
npm run format       # prettier over src/ and tests/
npm run typecheck    # tsc --noEmit
npm test             # vitest unit + conformance + e2e
```

CI runs the same three. Skipping them locally just means you'll see the failure later.

Code style is enforced by [docs/development.md § Style rules](docs/development.md#style-rules) —
ESM, no `any`, no decorative emoji, one accent color, `─` for separators. Prettier handles the
rest.

## File ownership boundaries

`tyda` was built by 11 parallel ownership tracks (Wave 0–4) so multi-agent and multi-human
contributors don't collide. **Stay inside your track.** If your change has to touch another
track's files, call it out in the PR description and tag the owning track. Full map in
[docs/development.md § Multi-agent build](docs/development.md#multi-agent-build-ownership-tracks).

A few quick rules:

- **Don't edit `spec/` by hand.** It's a snapshot of Swiggy's docs. To update, re-curl the
  affected files and bump `spec/SNAPSHOT.txt`.
- **Don't edit fixtures except to add data.** Changing existing IDs breaks every test and
  recipe.
- **One Zod schema per tool.** No mega-files. The schema-conversion test catches mistakes.
- **One handler per tool.** Mirror the spec file path under `src/server/handlers/`.

## Adding a new tool

The full flow is in [docs/development.md § Adding a new tool](docs/development.md#adding-a-new-tool).
Short version:

1. Snapshot the spec into `spec/<server>/<tool>.md`.
2. Add the Zod schema in `src/shared/schemas/<server>/<tool>.ts`.
3. Register in `src/shared/tool-index.ts`.
4. Write the handler in `src/server/handlers/<server>/<tool>.ts`.
5. Wire into `src/server/mcp/<server>.ts`.
6. (Optional) Add a slash command in `src/tui/slash/commands/<server>.ts` and the registry.
7. Add tests.
8. Update [docs/mcp-tools.md](docs/mcp-tools.md) and (if user-facing)
   [docs/slash-commands.md](docs/slash-commands.md).

## PRs

The PR template ([.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)) lists the
checklist we want green before merging. The biggest one is: **run the conformance suite** —
`tests/conformance/streamable-http.test.ts`. If that fails, the Streamable HTTP contract has
regressed and the production swap stops working.

Small focused PRs land faster than big ones. If your change spans tracks, split it.
