# Slash commands

Generated from `src/tui/slash/registry.ts`. If you change the registry, update this doc.

## Reference

| Command | Args | Summary |
| --- | --- | --- |
| `/help` | — | List all commands (uses the same registry as the table below). |
| `/login` | — | (Re)run the OAuth 2.1 PKCE dance. |
| `/address` | `[list\|use <n>\|pick <n>\|add "<line>"]` | Manage delivery addresses. |
| `/search` | `<query>` | Find restaurants for delivery (Food). |
| `/menu` | `<restaurant-id>` | Open a restaurant menu (Food). |
| `/products` | `<query>` | Search Instamart. |
| `/add` | `<id> [qty]` | Add an item to the current cart. Cross-domain — routed by ID prefix. |
| `/remove` | `<id>` | Remove an item from the current cart. Cross-domain. |
| `/clear` | — | Clear the current cart. Cross-domain. |
| `/cart` | — | Show the current cart. Cross-domain. |
| `/coupon` | `<code>` | Apply a food coupon. |
| `/order` | — | Place the current cart. Cross-domain. |
| `/track` | `[order-id\|off]` | Live-track an order; `off` detaches the pinned tracker. Cross-domain. |
| `/orders` | — | List recent orders. Cross-domain — aggregates Food + Instamart + Dineout. |
| `/tables` | `<area>` | Find Dineout tables. |
| `/book` | `<slot-id>` | Book a Dineout slot. |
| `/booking` | `<booking-id>` | Show a Dineout booking. |
| `/demo` | `<recipe>` | Run a canned demo recipe: `biryani`, `groceries`, or `tables`. |
| `/ai` | `<prompt>` | Hand off to the LLM agent. Hidden unless `llm` is configured. |
| `/quit` | — | Exit the TUI. |

## Cross-domain commands and ID-prefix routing

`/add`, `/remove`, `/clear`, `/cart`, `/order`, `/track`, and `/orders` are **cross-domain** —
they do not bind to a single MCP server. The TUI dispatches based on context:

- **`/add <id>`** — the ID prefix decides which MCP server gets the call.
  - `M*` (e.g. `M01`) → Food: `update_food_cart`.
  - `IP*` (e.g. `IP012`) → Instamart: `update_cart`.
  - No prefix match → an error explaining the prefix conventions.
- **`/cart`, `/clear`, `/order`** — operate on the **most recently touched** cart in the
  session. If you `/add M01` then run `/cart`, you see the Food cart. If you then `/add IP012`,
  `/cart` flips to Instamart and the Food cart is left untouched on the server.
- **`/track`** — accepts either a domain-tagged order ID (`FD-…` Food, `IM-…` Instamart, `DO-…`
  Dineout) or no arg, in which case it picks the most recent active order across all three.
- **`/orders`** — aggregates `get_food_orders`, `get_orders` (Instamart), and Dineout bookings
  into a single chronological list.

This is the only place the TUI bridges across the three state boundaries; the MCP surface never
does.

## Detailed examples

### `/demo biryani` — the acceptance path

```
> /demo biryani
▶ running /demo biryani — 8 steps
   Picking Koramangala 4th Block as the delivery address.
 ▼ create_address  ✓
   Searching restaurants for biryani.
 ▼ search_restaurants  ✓ 240ms
   Opening the top result's menu.
 ▼ get_restaurant_menu  ✓
   Adding the bestseller to the cart.
 ▼ update_food_cart  ✓
   Reviewing the cart.
 ▼ get_food_cart  ✓
   Applying coupon FLAT100.
 ▼ apply_food_coupon  ✓
   Placing the order.
 ▼ place_food_order  ✓
   Tracking the order — the pinned tracker keeps you posted.
 ▼ track_food_order  ✓ (auto-refresh every 5 s)
✔ /demo biryani complete
```

### `/demo groceries` — Instamart

Picks an address, searches for onions, adds Red Onion (1 kg), searches for milk, adds Amul
Taaza, reviews the cart, places the Instamart order, tracks.

### `/demo tables` — Dineout

Finds tables in Indiranagar, books the first available 7:30 PM slot at Toit, then confirms the
booking.

### `/address`

```
> /address
1) Koramangala 4th Block, Bangalore   [active]
2) Indiranagar, Bangalore
3) HSR Layout, Bangalore

> /address use 2
✓ Active address: Indiranagar, Bangalore. Cart was empty, no clear needed.

> /address add "MG Road, Indiranagar, Bangalore"
✓ Added: MG Road, Indiranagar, Bangalore
```

Custom addresses are validated against the baked Bangalore-area table in
`src/tui/data/bangalore-areas.ts`. Unknown areas are rejected with a list of accepted areas.

### `/track` and the pinned tracker

`/track <order-id>` pins a tracker component to the top of the transcript. It polls the right
`track_*` tool every 5 s and updates in place. You can keep typing other commands while it
runs. `/track off` detaches the tracker.

```
> /track FD-2026-05-18-0042
 ▼ track_food_order  (auto-refresh every 5 s — Ctrl-C to detach)
   [████████░░░░░░░░░░░░░░] PREPARING            elapsed 03:12
   Meghana Foods is packing your order.
   Rider: Ramesh K  • 1.8 km away  • ETA 24 min
```

### `/ai` (optional)

`/ai <prompt>` hands the prompt to a configured LLM with all 35 MCP tools exposed via OpenAI
function-calling. **Hidden until `llm` is configured in `config.yml`.**

First-run consent prompt asks for `y/N` before any tokens leave the machine. See
[oauth-pkce.md](oauth-pkce.md) and the [LLM section in the original plan](OVERVIEW.md) for
details.
