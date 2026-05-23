/**
 * zepto TUI — an Ink slash-REPL wired to the REAL Zepto integration.
 *
 *   npm run zepto:tui
 *
 * Commands:
 *   /login <phone>     send OTP to your number (real SMS)
 *   /otp <code>        verify the OTP (or just type the digits after /login)
 *   /status            token validity + account
 *   /search <query>    anonymous catalog search → numbered results
 *   /add <n> [qty]     add result #n to the cart (real) → shows the bill
 *   /cart              re-read the current cart bill
 *   /clear             empty the cart
 *   /help  /quit
 *
 * It never places an order. Auth + cart hit production; search is anonymous.
 */
import React, { useState, useRef, useEffect } from "react";
import { render, Box, Text, Static, useApp, useInput } from "ink";
import Spinner from "ink-spinner";

import { ZeptoHttp } from "./auth/http-client.js";
import { loadSession, userLabel, type ZeptoSession } from "./auth/session.js";
import { tokenStatus, humanLeft, tryRefresh } from "./auth/refresh.js";
import { sendOtp, verifyOtp } from "./auth/otp.js";
import { renderThumbnail, renderThumbnailLines } from "./image.js";
import {
  searchProducts,
  getDeliveryContext,
  setCart,
  billSummary,
  resolveStoreId,
  type Product,
  type CartItem,
  type DeliveryCtx,
} from "./commerce.js";

const rupee = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** Command catalogue used for the live `/` suggestion panel. */
const COMMANDS: Array<{ name: string; args: string; desc: string }> = [
  { name: "/login", args: "<phone>", desc: "send a real OTP to your number" },
  { name: "/otp", args: "<code>", desc: "verify the OTP code" },
  { name: "/search", args: "<query>", desc: "search products (shows pictures)" },
  { name: "/pic", args: "<n>", desc: "bigger picture of result n" },
  { name: "/add", args: "<n> [qty]", desc: "add result n to your cart" },
  { name: "/cart", args: "", desc: "show the current cart & bill" },
  { name: "/clear", args: "", desc: "empty the cart" },
  { name: "/status", args: "", desc: "session & token status" },
  { name: "/help", args: "", desc: "list all commands" },
  { name: "/quit", args: "", desc: "exit the app" },
];

type LogEntry =
  | { kind: "text"; key: number; text: string; color?: string }
  | { kind: "card"; key: number; idx: number; product: Product; lines: string[] };

interface CartLine {
  item: CartItem;
  name: string;
  price: number;
  qty: number;
}

/** A bordered product card: image on the left, wrapped name + price + actions on the right. */
export const ProductCard: React.FC<{ idx: number; product: Product; lines: string[] }> = ({ idx, product, lines }) => {
  const termW = process.stdout.columns || 80;
  const discount = product.mrp > product.price ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  return (
    <Box
      width={Math.min(termW - 1, 76)}
      borderStyle="round"
      borderColor={product.outOfStock ? "gray" : "cyan"}
      paddingX={1}
      marginBottom={1}
    >
      {/* image as ONE multi-line Text (single Text renders the half-block art
          solid; per-line Texts get mangled by Ink's row layout). flexShrink:0 keeps
          its natural width so the art never wraps. */}
      <Box flexShrink={0} marginRight={2}>
        <Text>{lines.join("\n")}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold wrap="wrap">
          {idx}. {product.name}
        </Text>
        <Box marginTop={1}>
          <Text color="green" bold>
            {rupee(product.price)}
          </Text>
          {discount > 0 && <Text color="gray">{`  MRP ${rupee(product.mrp)} `}</Text>}
          {discount > 0 && <Text color="yellow">{`${discount}% off`}</Text>}
        </Box>
        <Text color={product.outOfStock ? "red" : "green"}>
          {product.outOfStock ? "✗ out of stock" : "✓ in stock"}
        </Text>
        <Box marginTop={1}>
          <Text color="cyan">{`/add ${idx}`}</Text>
          <Text color="gray">{`     /pic ${idx}`}</Text>
        </Box>
      </Box>
    </Box>
  );
};

function clientFromSession(s: ZeptoSession): ZeptoHttp {
  return new ZeptoHttp({
    deviceId: s.deviceId,
    sessionId: s.sessionId,
    cookies: s.cookies,
    token: s.token,
    storeId: s.storeId,
  });
}

/** Text input line with a block cursor (replaces ink-text-input for full control). */
export const InputLine: React.FC<{ value: string; cursor: number; placeholder?: string }> = ({
  value,
  cursor,
  placeholder,
}) => {
  if (!value) {
    return (
      <Text>
        <Text inverse> </Text>
        {placeholder ? (
          <Text color="gray" dimColor>
            {placeholder}
          </Text>
        ) : null}
      </Text>
    );
  }
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
};

const App: React.FC = () => {
  const { exit } = useApp();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0); // cursor offset within `input`
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "awaiting_otp">("normal");
  const [selIdx, setSelIdx] = useState(0);

  // Live `/` command suggestions (while typing the command word, before any space).
  const token = input.trim();
  const suggestions =
    !busy && mode === "normal" && token.startsWith("/") && !/\s/.test(token)
      ? COMMANDS.filter((c) => c.name.startsWith(token.toLowerCase()))
      : [];
  const sel = suggestions.length ? Math.min(selIdx, suggestions.length - 1) : 0;

  // Mutable app state (avoids stale closures in async handlers).
  const keyRef = useRef(0);
  const sessionRef = useRef<ZeptoSession | null>(null);
  const loginRef = useRef<{ http: ZeptoHttp; phone: string } | null>(null);
  const ctxRef = useRef<DeliveryCtx | null>(null);
  const resultsRef = useRef<Product[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const pendingRef = useRef<string | null>(null); // command to resume after auto-refresh
  const refreshingRef = useRef(false);
  const warnedRef = useRef(false); // so the "expiring soon" warning logs once
  const historyRef = useRef<string[]>([]); // submitted command history (oldest→newest)
  const histPosRef = useRef(-1); // -1 = editing a fresh line; 0 = most recent, …

  const print = (text: string, color?: string) =>
    setLog((l) => [...l, { kind: "text", key: keyRef.current++, text, color }]);
  const pushCard = (idx: number, product: Product, lines: string[]) =>
    setLog((l) => [...l, { kind: "card", key: keyRef.current++, idx, product, lines }]);

  useEffect(() => {
    print("╭───────────────────────────────────────────────────────╮", "magenta");
    print("│  ✦  zepto — order groceries from your terminal         │", "magenta");
    print("│     real Zepto API · type / for commands              │", "magenta");
    print("╰───────────────────────────────────────────────────────╯", "magenta");
    const s = loadSession();
    sessionRef.current = s;
    if (s?.token) {
      const ts = tokenStatus(s);
      if (ts.valid) {
        print(`  Logged in as ${userLabel(s.user, s.phone)} — token valid (${humanLeft(ts.secondsLeft)} left).`, "green");
      } else {
        print(`  ${userLabel(s.user, s.phone)} — session expired; it will auto-refresh on your next action.`, "yellow");
      }
    } else {
      print("  Not logged in — type /login <phone> to start.", "yellow");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Token-expiry watcher: warn once when the token is about to lapse. The actual
  // refresh fires automatically on the next authenticated action (see autoRefresh).
  useEffect(() => {
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s?.token) return;
      const ts = tokenStatus(s);
      if (ts.valid && (ts.secondsLeft ?? 0) <= 60 && !warnedRef.current && mode === "normal") {
        warnedRef.current = true;
        print("↻ token expiring soon — it will auto-refresh on your next action.", "yellow");
      }
      if (ts.valid && (ts.secondsLeft ?? 0) > 60) warnedRef.current = false;
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function ensureLoggedIn(): ZeptoSession {
    const s = sessionRef.current;
    if (!s?.token) throw new Error("Not logged in. /login <phone> first.");
    if (!tokenStatus(s).valid) throw new Error("Token expired — refreshing.");
    return s;
  }

  /**
   * Automatic token refresh. Tries a silent refresh first (tryRefresh — the seam for
   * a real bearer-refresh endpoint); if that's unavailable, falls back to an OTP
   * re-login, auto-sending the code to the saved number. Every step is logged.
   * Returns true if the session is immediately usable, false if it now awaits an OTP.
   */
  async function autoRefresh(reason: string): Promise<boolean> {
    const s = sessionRef.current;
    if (!s?.token) {
      print("Not logged in — /login <phone>.", "yellow");
      return false;
    }
    if (refreshingRef.current) return false;
    refreshingRef.current = true;
    try {
      print(`↻ ${reason} — refreshing session…`, "yellow");
      const r = await tryRefresh(s);
      if (r.ok && r.session) {
        sessionRef.current = r.session;
        print(`✓ token refreshed silently (valid ${humanLeft(tokenStatus(r.session).secondsLeft)}).`, "green");
        return true;
      }
      if (!s.phone) {
        print("Cannot auto-refresh: no saved phone. Type /login <phone>.", "red");
        return false;
      }
      print(`↻ auto re-login: sending OTP to +91 ${s.phone}…`, "yellow");
      const send = await sendOtp(s.phone);
      if (!send.ok || !send.http) {
        print("✘ auto-refresh failed: " + send.reason, "red");
        return false;
      }
      loginRef.current = { http: send.http, phone: s.phone };
      setMode("awaiting_otp");
      print("✓ OTP sent — enter the code to finish refreshing.", "green");
      return false;
    } finally {
      refreshingRef.current = false;
    }
  }

  async function ensureCtx(s: ZeptoSession, http: ZeptoHttp): Promise<DeliveryCtx> {
    if (!ctxRef.current) ctxRef.current = await getDeliveryContext(http, s);
    return ctxRef.current;
  }

  function showBill(cart: any) {
    const b = billSummary(cart);
    print("── Cart ───────────────────────────────", "gray");
    for (const c of cartRef.current) print(`  ${c.qty}× ${c.name}  ${rupee(c.price)}`);
    print(`  items: ${b.itemCount}   item total: ${rupee(b.itemTotal)}`);
    print(`  delivery: ${rupee(b.deliveryFee)}   handling: ${rupee(b.handlingFee)}`);
    print(`  TO PAY: ${rupee(b.toPay)}   ETA: ${b.eta}   pay: ${b.paymentFlow}`, "green");
    print("───────────────────────────────────────", "gray");
  }

  async function syncCart(): Promise<void> {
    const s = ensureLoggedIn();
    const http = clientFromSession(s);
    const ctx = await ensureCtx(s, http);
    const items: CartItem[] = cartRef.current.map((c) => ({ ...c.item, quantity: c.qty }));
    const cart = await setCart(http, ctx, items);
    showBill(cart);
  }

  async function handle(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line) return;

    // In OTP mode, bare digits are treated as the code.
    if (mode === "awaiting_otp" && !line.startsWith("/")) {
      await doVerify(line);
      return;
    }

    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");

    // Auto-refresh gate: authenticated commands check the token first. If it has
    // lapsed, kick off the refresh, queue this command, and resume it afterward.
    const AUTH_CMDS = new Set(["/search", "/add", "/cart", "/clear"]);
    if (AUTH_CMDS.has(cmd)) {
      const s = sessionRef.current;
      if (!s?.token) {
        print("Not logged in — type /login <phone>.", "yellow");
        return;
      }
      if (!tokenStatus(s).valid) {
        pendingRef.current = line; // resume after the refresh completes
        await autoRefresh("token expired");
        return;
      }
    }

    switch (cmd) {
      case "/help":
        print("commands: /login <phone> · /otp <code> · /status · /search <q> · /pic <n> · /add <n> [qty] · /cart · /clear · /quit");
        break;
      case "/quit":
      case "/exit":
        exit();
        break;
      case "/status": {
        const s = sessionRef.current;
        if (!s?.token) return print("Not logged in.", "yellow");
        const ts = tokenStatus(s);
        print(`${userLabel(s.user, s.phone)} · token ${ts.valid ? humanLeft(ts.secondsLeft) + " left" : "EXPIRED"} · storeId ${s.storeId ?? "(unresolved)"}`);
        break;
      }
      case "/login":
        await doLogin(arg);
        break;
      case "/otp":
        await doVerify(arg);
        break;
      case "/search":
        await doSearch(arg);
        break;
      case "/pic":
        await doPic(rest[0]);
        break;
      case "/add":
        await doAdd(rest[0], rest[1]);
        break;
      case "/cart":
        if (!cartRef.current.length) return print("Cart is empty. /add <n> first.", "yellow");
        await syncCart();
        break;
      case "/clear":
        await doClear();
        break;
      default:
        print(`Unknown command: ${cmd}. /help`, "red");
    }
  }

  async function doLogin(phone: string): Promise<void> {
    if (!phone) return print("Usage: /login <phone>", "yellow");
    print(`Sending OTP to +91 ${phone.replace(/\D/g, "").slice(-10)}…`);
    const r = await sendOtp(phone);
    if (!r.ok || !r.http) return print("✘ " + r.reason, "red");
    loginRef.current = { http: r.http, phone };
    setMode("awaiting_otp");
    print("✓ OTP sent. Type the code (or /otp <code>).", "green");
  }

  async function doVerify(otp: string): Promise<void> {
    const lg = loginRef.current;
    if (!lg) return print("No login in progress. /login <phone> first.", "yellow");
    print("Verifying…");
    const r = await verifyOtp(lg.http, lg.phone, otp);
    if (!r.ok || !r.session) return print("✘ " + r.reason, "red");
    sessionRef.current = r.session;
    ctxRef.current = null;
    loginRef.current = null;
    setMode("normal");
    warnedRef.current = false;
    print(`✔ Logged in as ${userLabel(r.user, r.session.phone)} — token valid (${humanLeft(tokenStatus(r.session).secondsLeft)}).`, "green");
    // resolve storeId in the background so search/cart are ready
    try {
      await resolveStoreId(clientFromSession(r.session), r.session);
    } catch {
      /* non-fatal */
    }
    // Resume whatever the user was doing when the token lapsed.
    if (pendingRef.current) {
      const cmd = pendingRef.current;
      pendingRef.current = null;
      print(`↻ resuming: ${cmd}`, "gray");
      await handle(cmd);
    }
  }

  async function doSearch(query: string): Promise<void> {
    if (!query) return print("Usage: /search <query>", "yellow");
    const s = ensureLoggedIn();
    const storeId = s.storeId ?? (await resolveStoreId(clientFromSession(s), s));
    if (!storeId) return print("No storeId (no past orders to resolve it).", "red");
    const prods = await searchProducts(query, storeId);
    resultsRef.current = prods;
    if (!prods.length) return print(`No results for "${query}".`, "yellow");
    print(`Results for "${query}":`, "cyan");
    const top = prods.slice(0, 8);
    // small but sharp: quadrant art packs 2×2 px/cell, so ~14 cols carries plenty
    const termW = process.stdout.columns || 80;
    const imgCols = Math.max(12, Math.min(16, Math.floor(termW * 0.16)));
    const arts = await Promise.all(top.map((p) => renderThumbnailLines(p.image, imgCols)));
    top.forEach((p, i) => pushCard(i + 1, p, arts[i]));
    if (prods.length > top.length) print(`(+${prods.length - top.length} more — refine the query)`, "gray");
    print("Add an item:  /add <n> [qty]   ·   bigger picture:  /pic <n>", "gray");
  }

  async function doPic(nStr?: string): Promise<void> {
    const n = Number(nStr);
    const prods = resultsRef.current;
    if (!n || n < 1 || n > prods.length) return print("Usage: /pic <n> (n from the last /search)", "yellow");
    const p = prods[n - 1];
    if (!p.image) return print(`No image for "${p.name}".`, "yellow");
    print(`${p.name} — ${rupee(p.price)}`, "cyan");
    print(await renderThumbnail(p.image, Math.min(30, (process.stdout.columns || 80) - 6)));
  }

  async function doAdd(nStr?: string, qtyStr?: string): Promise<void> {
    const n = Number(nStr);
    const qty = Math.max(1, Number(qtyStr) || 1);
    const prods = resultsRef.current;
    if (!n || n < 1 || n > prods.length) return print("Usage: /add <n> [qty] (n from the last /search)", "yellow");
    const p = prods[n - 1];
    if (p.outOfStock) return print(`"${p.name}" is out of stock.`, "yellow");
    ensureLoggedIn();
    const existing = cartRef.current.find((c) => c.item.productVariantId === p.pvid);
    if (existing) existing.qty += qty;
    else
      cartRef.current.push({
        item: { productVariantId: p.pvid, storeProductId: p.storeProductId, productId: p.productId, quantity: qty },
        name: p.name,
        price: p.price,
        qty,
      });
    print(`Added ${qty}× ${p.name}.`);
    if (p.image) print(await renderThumbnail(p.image, 12));
    await syncCart();
  }

  async function doClear(): Promise<void> {
    const s = ensureLoggedIn();
    const http = clientFromSession(s);
    const ctx = await ensureCtx(s, http);
    await setCart(http, ctx, []);
    cartRef.current = [];
    print("Cart cleared.", "green");
  }

  const awaitingOtp = mode === "awaiting_otp";

  function submitCurrent(): void {
    const value = input;
    if (value.trim() && historyRef.current[historyRef.current.length - 1] !== value) {
      historyRef.current.push(value);
    }
    histPosRef.current = -1;
    setInput("");
    setCursor(0);
    setSelIdx(0);
    if (!value.trim()) return;
    print((awaitingOtp ? "otp> " : "> ") + value, "gray");
    setBusy("working");
    handle(value)
      .catch((e) => print("✘ " + (e as Error).message, "red"))
      .finally(() => setBusy(null));
  }

  function recallHistory(dir: -1 | 1): void {
    const h = historyRef.current;
    if (!h.length) return;
    // dir +1 = older, -1 = newer
    let pos = histPosRef.current + dir;
    pos = Math.max(-1, Math.min(h.length - 1, pos));
    histPosRef.current = pos;
    const v = pos < 0 ? "" : h[h.length - 1 - pos];
    setInput(v);
    setCursor(v.length);
    setSelIdx(0);
  }

  // Custom input: full control over cursor, Tab-completion (cursor jumps to end),
  // and ↑/↓ history (when the suggestion menu isn't open).
  useInput((ch, key) => {
    if (busy) return;

    if (key.return) return submitCurrent();

    if (key.tab) {
      if (suggestions.length) {
        const c = suggestions[sel];
        const v = c.name + (c.args ? " " : "");
        setInput(v);
        setCursor(v.length); // ← fix: cursor follows to the end
        setSelIdx(0);
      }
      return;
    }

    if (key.upArrow) {
      if (suggestions.length) setSelIdx((i) => Math.max(0, i - 1));
      else recallHistory(+1);
      return;
    }
    if (key.downArrow) {
      if (suggestions.length) setSelIdx((i) => Math.min(suggestions.length - 1, i + 1));
      else recallHistory(-1);
      return;
    }

    if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.rightArrow) return setCursor((c) => Math.min(input.length, c + 1));
    if (key.ctrl && ch === "a") return setCursor(0);
    if (key.ctrl && ch === "e") return setCursor(input.length);
    if (key.ctrl && ch === "u") {
      setInput("");
      setCursor(0);
      setSelIdx(0);
      histPosRef.current = -1;
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setInput(input.slice(0, cursor - 1) + input.slice(cursor));
        setCursor(cursor - 1);
        setSelIdx(0);
        histPosRef.current = -1;
      }
      return;
    }

    if (key.escape) return setSelIdx(0);

    // printable text (also handles paste of multiple chars)
    if (ch && !key.ctrl && !key.meta) {
      const clean = ch.replace(/[\r\n\t]/g, "");
      if (!clean) return;
      setInput(input.slice(0, cursor) + clean + input.slice(cursor));
      setCursor(cursor + clean.length);
      setSelIdx(0);
      histPosRef.current = -1;
    }
  });
  return (
    <Box flexDirection="column">
      <Static items={log}>
        {(l) =>
          l.kind === "card" ? (
            <ProductCard key={l.key} idx={l.idx} product={l.product} lines={l.lines} />
          ) : (
            <Text key={l.key} color={l.color}>
              {l.text}
            </Text>
          )
        }
      </Static>

      {busy ? (
        <Box paddingX={1}>
          <Text color="yellow">
            <Spinner type="dots" /> {busy}…
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* rounded input box, Claude-Code style — custom-rendered line with cursor */}
          <Box borderStyle="round" borderColor={awaitingOtp ? "yellow" : "cyan"} paddingX={1}>
            <Text color={awaitingOtp ? "yellow" : "cyan"} bold>
              {awaitingOtp ? "otp " : "› "}
            </Text>
            <InputLine
              value={input}
              cursor={cursor}
              placeholder={awaitingOtp ? "enter the OTP you received…" : "type a message, or / for commands"}
            />
          </Box>

          {/* command menu */}
          {suggestions.length > 0 && (
            <Box flexDirection="column" paddingX={1}>
              {suggestions.map((c, i) => {
                const label = `${c.name}${c.args ? " " + c.args : ""}`.padEnd(20);
                return (
                  <Text
                    key={c.name}
                    backgroundColor={i === sel ? "cyan" : undefined}
                    color={i === sel ? "black" : "gray"}
                  >
                    {(i === sel ? "› " : "  ") + label + "  " + c.desc + " "}
                  </Text>
                );
              })}
            </Box>
          )}

          {/* hint line */}
          <Box paddingX={1}>
            <Text color="gray" dimColor>
              {awaitingOtp
                ? "type the OTP and press Enter"
                : suggestions.length > 0
                  ? "↑↓ select · Tab complete · Enter run"
                  : "/ for commands · Ctrl+C to quit"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// Only render when run directly (so the module can be imported without a TTY).
const entry = process.argv[1] ?? "";
if (/zepto\/tui\.(tsx|jsx|js)$/.test(entry)) {
  render(<App />);
}

export default App;
