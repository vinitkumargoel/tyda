# MCP tools reference

All 35 Swiggy MCP tools, grouped by server. Descriptions are lifted from the spec snapshot in
`spec/`. The **upstream** column links to the canonical Swiggy reference doc for each tool.

The **mutating** column flags tools that write state on the server. Read-only tools are safe to
retry; mutating tools should be guarded with care in an LLM-driven loop.

| Server | Endpoint | Tools | Source |
| --- | --- | --- | --- |
| Food | `POST /food` | 14 | `src/server/mcp/food.ts` |
| Instamart | `POST /im` | 13 | `src/server/mcp/instamart.ts` |
| Dineout | `POST /dineout` | 8 | `src/server/mcp/dineout.ts` |

## Food (14 tools)

The Food server backs delivery: searching restaurants, browsing menus, building a per-restaurant
cart, applying coupons, placing the order, and tracking the rider. Cart state is keyed by
`(user_id, restaurant_id)` — switching restaurants triggers the TUI's `/clear` prompt.

| Tool | Mutating | Description | Upstream |
| --- | --- | --- | --- |
| `get_addresses` | no | Get all saved delivery addresses for the authenticated Swiggy user. Shared with Instamart. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/get_addresses) |
| `search_restaurants` | no | Search restaurants for food delivery from the user's preferred address. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/search_restaurants) |
| `search_menu` | no | Search dishes and menu items across restaurants for delivery. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/search_menu) |
| `get_restaurant_menu` | no | Get the complete menu of a restaurant, paginated by category. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/get_restaurant_menu) |
| `fetch_food_coupons` | no | Get available coupons and offers for a food delivery order. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/fetch_food_coupons) |
| `apply_food_coupon` | yes | Apply a coupon code or discount to the current food delivery cart. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/apply_food_coupon) |
| `get_food_cart` | no | Get current food delivery cart with all items, fees, and totals. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/get_food_cart) |
| `update_food_cart` | yes | Add or update items in the food delivery cart. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/update_food_cart) |
| `flush_food_cart` | yes | Clear or empty the food delivery cart. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/flush_food_cart) |
| `place_food_order` | yes | Place the current food delivery cart and confirm the order. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/place_food_order) |
| `get_food_orders` | no | Get active food delivery orders and current order statuses. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/get_food_orders) |
| `get_food_order_details` | no | Get detailed information about a specific food delivery order. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/get_food_order_details) |
| `track_food_order` | no | Track food delivery order status, ETA, and rider position. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/track_food_order) |
| `report_error` | yes | Generate an error report (pre-filled mailto link) for the Swiggy MCP team. | [docs](https://mcp.swiggy.com/builders/docs/reference/food/report_error) |

## Instamart (13 tools)

Instamart is the grocery domain. Cart is single-tenant (no per-store split), inventory simulates
occasional out-of-stock states (~5 % of SKUs daily), and `checkout` collapses cart-finalize +
payment into a single call.

| Tool | Mutating | Description | Upstream |
| --- | --- | --- | --- |
| `get_addresses` | no | Saved delivery addresses (shared with Food). | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/get_addresses) |
| `create_address` | yes | Create a new delivery address. Used by the TUI's onboarding picker. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/create_address) |
| `delete_address` | yes | Delete a saved address. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/delete_address) |
| `search_products` | no | Search Instamart products available at the selected address. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/search_products) |
| `your_go_to_items` | no | Fetch the user's frequently or recently ordered items for the active address. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/your_go_to_items) |
| `get_cart` | no | Get the current Instamart grocery cart with bill breakdown. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/get_cart) |
| `update_cart` | yes | Replace the Instamart cart with the provided item list. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/update_cart) |
| `clear_cart` | yes | Remove all items from the Instamart cart. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/clear_cart) |
| `checkout` | yes | Place and confirm an Instamart order (cart-finalize + payment in one call). | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/checkout) |
| `get_orders` | no | Instamart order history. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/get_orders) |
| `get_order_details` | no | Detailed info for a specific Instamart order. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/get_order_details) |
| `track_order` | no | Real-time Instamart order tracking. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/track_order) |
| `report_error` | yes | Error report mailto for the Swiggy MCP team. | [docs](https://mcp.swiggy.com/builders/docs/reference/instamart/report_error) |

## Dineout (8 tools)

Dineout handles table reservations. Only **free** bookings are supported (`isFree=true`,
`bookingPrice=0`); paid deals are explicitly rejected per Swiggy spec. Slot grids decay
deterministically as bookings land.

| Tool | Mutating | Description | Upstream |
| --- | --- | --- | --- |
| `get_saved_locations` | no | User's saved Dineout addresses; returns IDs to feed into search. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/get_saved_locations) |
| `search_restaurants_dineout` | no | Search restaurants for table booking / reservations. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/search_restaurants_dineout) |
| `get_restaurant_details` | no | Ratings, deals, timings, and address for a Dineout restaurant. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/get_restaurant_details) |
| `get_available_slots` | no | Available time slots for table booking, up to 7 days out. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/get_available_slots) |
| `create_cart` | yes | Create a Dineout cart for a table booking or bill payment. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/create_cart) |
| `book_table` | yes | Book a free table at a chosen slot. Paid deals rejected. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/book_table) |
| `get_booking_status` | no | Status and details for a Dineout booking. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/get_booking_status) |
| `report_error` | yes | Error report mailto for the Swiggy MCP team. | [docs](https://mcp.swiggy.com/builders/docs/reference/dineout/report_error) |

## Schema source of truth

Every tool above has a matching Zod schema at `src/shared/schemas/<server>/<tool>.ts`. The mock
validates incoming arguments against these schemas before dispatch; the same schemas are
converted into OpenAI function-call schemas for the `/ai` bridge via `src/shared/zod-to-openai.ts`.

If Swiggy ships a spec update, the workflow is:

1. Re-snapshot the affected files into `spec/`.
2. Run `npm test` — the tool-count and schema-conversion tests will fail first.
3. Update the Zod schema (and handler if shape changed).
4. Re-run tests until green.
