/**
 * Wave 2 / Track J — Address & Auth Slash Flow.
 *
 * Exports a handler map for the registry to consume in Wave 3:
 *  - /login            — re-runs the OAuth PKCE flow via the dispatcher.
 *  - /address          — alias for `/address list`.
 *  - /address list     — fetches saved addresses, renders a numbered list.
 *  - /address use <n>  — selects the n-th listed address as active.
 *  - /address add "<line1>, <area>, <city>"
 *                      — creates a new address on Instamart with curated
 *                        lat/lng filled in from the Bangalore areas table.
 *  - /address pick <n> — first-run preset picker (1..4 -> top 4 areas).
 *  - /quit             — handled by registry.ts; included here only as a
 *                        defensive fallback if Wave 3 wires this map in
 *                        before /quit (registry.ts already has it).
 */

import {
  BANGALORE_AREAS,
  findArea,
  type BangaloreArea,
} from "../../data/bangalore-areas.js";
import type { ServerName, SlashContext } from "../types.js";

/** Slash handler signature mirrors SlashCommand['handler']. */
export type SlashHandler = (
  ctx: SlashContext,
  argv: string[],
) => Promise<void>;

/** Top 4 areas surfaced by the first-run picker. */
const PRESET_PICKS: readonly BangaloreArea[] = BANGALORE_AREAS.slice(0, 4);

/** Server we ask for the user's address book; default is `food`. */
const ADDRESS_LIST_SERVER: ServerName = "food";

/**
 * Per-session cache of the last `/address list` rendering so `/address use`
 * and `/address pick` can map the displayed ordinal back to a stable id.
 *
 * Keyed off SlashContext.state by identity so multiple sessions in the same
 * process (unlikely outside tests) stay isolated.
 */
const listCache = new WeakMap<SlashContext["state"], AddressView[]>();

interface AddressView {
  id: string;
  label: string;
}

/** Read the structured payload out of an MCP CallToolResult-shaped object. */
function extractToolPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent;
  }
  if (Array.isArray(r.content)) {
    // Try parsing the first text block as JSON; fall back to the raw object.
    for (const block of r.content as Array<{ type?: string; text?: string }>) {
      if (block?.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text);
        } catch {
          // Not JSON; keep looking.
        }
      }
    }
  }
  return raw;
}

/** Best-effort flatten of a server payload into an AddressView[]. */
function coerceAddressList(payload: unknown): AddressView[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(obj.addresses)) candidates.push(...obj.addresses);
  else if (Array.isArray(obj.items)) candidates.push(...obj.items);
  else if (Array.isArray(obj.data)) candidates.push(...obj.data);
  else if (Array.isArray(payload as unknown)) candidates.push(...(payload as unknown[]));

  const out: AddressView[] = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = String(e.id ?? e.addressId ?? e.address_id ?? "");
    if (!id) continue;
    const tag =
      typeof e.addressTag === "string" && e.addressTag
        ? e.addressTag
        : typeof e.tag === "string"
          ? e.tag
          : "";
    const line =
      typeof e.fullAddress === "string"
        ? e.fullAddress
        : [e.addressLine, e.locality, e.city, e.postalCode]
            .filter((p) => typeof p === "string" && p.length > 0)
            .join(", ");
    const label = tag ? `${tag} — ${line || id}` : line || id;
    out.push({ id, label });
  }
  return out;
}

/** Render the picker prompt when get_addresses comes back empty. */
function renderFirstRunPicker(ctx: SlashContext): void {
  ctx.push({
    kind: "info",
    text: "No saved delivery address yet. Pick one (you can change later):",
  });
  PRESET_PICKS.forEach((area, idx) => {
    ctx.push({
      kind: "info",
      text: `  ${idx + 1}) ${area.name}, Bangalore   →  /address pick ${idx + 1}`,
    });
  });
  ctx.push({
    kind: "info",
    text: `  ${PRESET_PICKS.length + 1}) Type a custom address  →  /address add "<line1>, <area>, <city>"`,
  });
}

const SUPPORTED_AREA_HINT =
  "Unknown area — supported areas: " +
  BANGALORE_AREAS.map((a) => a.name.split(/\s+/)[0]).join(", ");

async function loginHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  ctx.push({ kind: "info", text: "Re-running login..." });
  try {
    await ctx.mcp.ensureAuth();
    ctx.push({ kind: "info", text: "Login successful." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `login failed: ${msg}` });
  }
}

async function addressList(ctx: SlashContext): Promise<void> {
  let raw: unknown;
  try {
    raw = await ctx.mcp.call(ADDRESS_LIST_SERVER, "get_addresses", {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `address list failed: ${msg}` });
    return;
  }
  const list = coerceAddressList(extractToolPayload(raw));
  listCache.set(ctx.state, list);
  if (list.length === 0) {
    renderFirstRunPicker(ctx);
    return;
  }
  ctx.push({ kind: "info", text: "Saved addresses:" });
  list.forEach((a, idx) => {
    const marker = a.id === ctx.state.activeAddressId ? " (active)" : "";
    ctx.push({ kind: "info", text: `  ${idx + 1}) ${a.label}${marker}` });
  });
}

async function addressUse(ctx: SlashContext, argv: string[]): Promise<void> {
  const arg = argv[1];
  const n = Number.parseInt(arg ?? "", 10);
  if (!Number.isFinite(n) || n < 1) {
    ctx.push({
      kind: "error",
      text: 'usage: /address use <n> — run /address list first to see numbers',
    });
    return;
  }
  const list = listCache.get(ctx.state);
  if (!list || list.length === 0) {
    ctx.push({
      kind: "error",
      text: "no address list cached — run /address list first",
    });
    return;
  }
  if (n > list.length) {
    ctx.push({
      kind: "error",
      text: `only ${list.length} addresses listed; got ${n}`,
    });
    return;
  }
  const chosen = list[n - 1]!;
  ctx.state.activeAddressId = chosen.id;
  ctx.push({ kind: "info", text: `Active address: ${chosen.label}` });
}

interface ParsedAddressLine {
  line1: string;
  areaInput: string;
  city: string;
}

function parseAddressString(s: string): ParsedAddressLine | null {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  // Conventions accepted:
  //   "<line1>, <area>, <city>"  (3 parts)
  //   "<area>, <city>"           (2 parts — line1 == area)
  if (parts.length === 2) {
    return { line1: parts[0]!, areaInput: parts[0]!, city: parts[1]! };
  }
  const city = parts[parts.length - 1]!;
  const areaInput = parts[parts.length - 2]!;
  const line1 = parts.slice(0, parts.length - 2).join(", ");
  return { line1, areaInput, city };
}

async function createAddressFromArea(
  ctx: SlashContext,
  area: BangaloreArea,
  line1: string,
  city: string,
): Promise<void> {
  const fullAddress = `${line1}, ${area.name}, ${city}`;
  const args: Record<string, unknown> = {
    fullAddress,
    addressLine: line1,
    addressLine2: "",
    locality: area.name,
    city,
    postalCode: area.pincode,
    latitude: area.lat,
    longitude: area.lng,
    addressCategory: "HOME",
    userName: "tyda user",
    userPhone: "0000000000",
  };
  try {
    const raw = await ctx.mcp.call("im", "create_address", args);
    const payload = extractToolPayload(raw) as Record<string, unknown> | null;
    const newId =
      (payload &&
        (payload.id ??
          (payload.address as Record<string, unknown> | undefined)?.id ??
          payload.addressId)) ||
      null;
    if (typeof newId === "string" && newId.length > 0) {
      ctx.state.activeAddressId = newId;
    }
    ctx.push({
      kind: "info",
      text: `Created address: ${fullAddress}${newId ? " (set active)" : ""}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.push({ kind: "error", text: `create address failed: ${msg}` });
  }
}

async function addressAdd(ctx: SlashContext, argv: string[]): Promise<void> {
  const blob = argv[1];
  if (!blob || typeof blob !== "string") {
    ctx.push({
      kind: "error",
      text: 'usage: /address add "<line1>, <area>, <city>"',
    });
    return;
  }
  const parsed = parseAddressString(blob);
  if (!parsed) {
    ctx.push({
      kind: "error",
      text: 'could not parse — expected "<line1>, <area>, <city>"',
    });
    return;
  }
  const area = findArea(parsed.areaInput);
  if (!area) {
    ctx.push({ kind: "error", text: SUPPORTED_AREA_HINT });
    return;
  }
  await createAddressFromArea(ctx, area, parsed.line1, parsed.city);
}

async function addressPick(ctx: SlashContext, argv: string[]): Promise<void> {
  const arg = argv[1];
  const n = Number.parseInt(arg ?? "", 10);
  if (!Number.isFinite(n) || n < 1 || n > PRESET_PICKS.length) {
    ctx.push({
      kind: "error",
      text: `usage: /address pick <1-${PRESET_PICKS.length}>`,
    });
    return;
  }
  const area = PRESET_PICKS[n - 1]!;
  // Use a sensible default line1; the user can refine later via /address add.
  await createAddressFromArea(ctx, area, area.name, "Bangalore");
}

async function addressHandler(
  ctx: SlashContext,
  argv: string[],
): Promise<void> {
  const sub = (argv[0] ?? "list").toLowerCase();
  switch (sub) {
    case "list":
      await addressList(ctx);
      return;
    case "use":
      await addressUse(ctx, argv);
      return;
    case "add":
      await addressAdd(ctx, argv);
      return;
    case "pick":
      await addressPick(ctx, argv);
      return;
    default:
      ctx.push({
        kind: "error",
        text: `unknown subcommand: /address ${sub} — try list, use, add, pick`,
      });
  }
}

async function quitHandler(ctx: SlashContext, _argv: string[]): Promise<void> {
  ctx.exit();
}

/**
 * Handler map exported for Wave 3 to merge into the registry.
 */
export const miscHandlers: Record<string, SlashHandler> = {
  login: loginHandler,
  address: addressHandler,
  quit: quitHandler,
};
