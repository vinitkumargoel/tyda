# Getting started

## Prerequisites

- **Node 22 LTS or newer.** `package.json` pins `"engines": { "node": ">=22" }`.
- **npm** (ships with Node).
- A POSIX-ish shell. macOS, Linux, and WSL all work. Native Windows isn't tested.

That's it. No Docker, no databases, no cloud credentials.

## Install

```bash
git clone https://github.com/<your-fork>/tyda-swiggy
cd tyda-swiggy
npm install
```

`tsx` runs the TypeScript directly — there's no compile step required for local dev. If you want
a `dist/` build (for `npm link` or publishing):

```bash
npm run build
```

## Two-terminal run model

`tyda` always runs as **two processes**: the mock Swiggy MCP server and the TUI client. This
matches how `tyda` will run against production — the only difference is what's at the other end
of the socket.

**Terminal 1 — start the mock:**

```bash
npm run mock
```

You should see something like:

```
[info] server listening on http://127.0.0.1:8787
[info] [food]     14 tools registered
[info] [instamart] 13 tools registered
[info] [dineout]   8 tools registered
```

**Terminal 2 — start the TUI:**

```bash
npm run tui
```

## First-run flow

1. The TUI detects no cached token in `~/.tyda-swiggy/token.json`, so it kicks off the OAuth
   PKCE flow.
2. Your default browser opens a small "Approve `tyda`?" page served by the mock at
   `http://127.0.0.1:8787/auth/authorize`. Click approve.
3. The TUI receives the redirect on a loopback port, exchanges the auth code for a 5-day JWT,
   stores it at `~/.tyda-swiggy/token.json` (mode `0600`), and lands you on the slash prompt.
4. Because no address is saved yet, the TUI prints a one-time picker:

   ```
    No saved delivery address yet. Pick one (you can change later):
      1) Koramangala 4th Block, Bangalore
      2) Indiranagar, Bangalore
      3) HSR Layout, Bangalore
      4) Whitefield, Bangalore
    ▌ _
   ```

   Pick one. Or type `/address add "MG Road, Indiranagar, Bangalore"` for a custom address.

After that, you're at the prompt:

```
 ▌ _
```

## The six most useful slash commands

| Command | What it does |
| --- | --- |
| `/demo biryani` | Scripted recipe runner. End-to-end Food order in ~30 s. |
| `/search <query>` | Find restaurants for delivery. |
| `/menu <restaurant-id>` | Open a restaurant menu. |
| `/add <id> [qty]` | Add an item to the cart. `M*` → Food, `IP*` → Instamart. |
| `/order` | Place the current cart. |
| `/track [order-id]` | Live tracker — pins to the top of the transcript. |

Full reference: [slash-commands.md](slash-commands.md).

## Troubleshooting

### Port 8787 already in use

The mock binds `127.0.0.1:8787`. If another process owns it:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Kill the owner, or run the mock on a different port:

```bash
npm run mock -- --port 9090
npm run tui  -- --remote http://127.0.0.1:9090
```

### Browser doesn't open during `/login`

Some terminals (tmux, SSH sessions) can't spawn a browser. The TUI falls back to printing the
authorize URL — copy it into a local browser, approve, and the loopback callback still wires up.

If you're on a headless machine, set `--auto-approve` on the mock to skip the HTML approval page
entirely:

```bash
npm run mock -- --auto-approve
```

### 401 loop

If every tool call returns 401, your cached token is dead. Run `/login` from the TUI prompt to
re-run PKCE. The TUI does this automatically when it sees a 401, so you usually shouldn't have
to think about it.

You can also delete the token file by hand:

```bash
rm ~/.tyda-swiggy/token.json
```

### "production access not yet granted"

When you run with `--remote https://mcp.swiggy.com` and you don't have builder access yet, the
TUI fails cleanly with that message. Apply at
[mcp.swiggy.com/builders/docs/operate/access/](https://mcp.swiggy.com/builders/docs/operate/access/).

### Tests fail locally but pass in CI

Most likely a stale state file. Run with an isolated state dir:

```bash
npm test -- --state-dir /tmp/tyda-test
```

Or delete `~/.tyda-swiggy/state.json` before re-running.
