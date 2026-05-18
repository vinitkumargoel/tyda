import { describe, it, expect, beforeEach } from "vitest";

import { miscHandlers } from "../../src/tui/slash/commands/misc.js";
import type {
  McpDispatcher,
  ServerName,
  SlashCommand,
  SlashContext,
  TranscriptEntry,
} from "../../src/tui/slash/types.js";
import { findArea } from "../../src/tui/data/bangalore-areas.js";

interface CallRecord {
  server: ServerName;
  tool: string;
  args: Record<string, unknown>;
}

interface Harness {
  ctx: SlashContext;
  entries: TranscriptEntry[];
  calls: CallRecord[];
  counters: { ensureAuth: number; exit: number };
  setNextResponse: (server: ServerName, tool: string, value: unknown) => void;
}

function makeHarness(): Harness {
  const entries: TranscriptEntry[] = [];
  const calls: CallRecord[] = [];
  const responses = new Map<string, unknown>();
  const counters = { ensureAuth: 0, exit: 0 };

  const mcp: McpDispatcher = {
    async ensureAuth() {
      counters.ensureAuth += 1;
    },
    async call(server, tool, args) {
      calls.push({ server, tool, args });
      const key = `${server}:${tool}`;
      if (responses.has(key)) return responses.get(key);
      // Default fake structuredContent for create_address.
      if (tool === "create_address") {
        return { structuredContent: { id: "ADDR-NEW", ok: true } };
      }
      if (tool === "get_addresses") {
        return { structuredContent: { addresses: [] } };
      }
      return { structuredContent: {} };
    },
  };

  const ctx: SlashContext = {
    mcp,
    push(entry) {
      entries.push(entry);
    },
    setTracker() {
      /* no-op */
    },
    exit() {
      counters.exit += 1;
    },
    clearTranscript() {
      entries.length = 0;
    },
    state: {
      activeAddressId: null,
      activeRestaurantId: null,
      lastOrderId: null,
    },
    registry: new Map<string, SlashCommand>(),
  };

  return {
    ctx,
    entries,
    calls,
    counters,
    setNextResponse(server, tool, value) {
      responses.set(`${server}:${tool}`, value);
    },
  };
}

describe("/login", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("calls ensureAuth and reports success", async () => {
    await miscHandlers.login!(h.ctx, []);
    expect(h.counters.ensureAuth).toBe(1);
    const texts = h.entries
      .filter((e) => e.kind === "info" || e.kind === "error")
      .map((e) => (e as { text: string }).text);
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Re-running login/i),
        expect.stringMatching(/Login successful/i),
      ]),
    );
  });

  it("reports an error entry when ensureAuth throws", async () => {
    h.ctx.mcp.ensureAuth = async () => {
      throw new Error("boom");
    };
    await miscHandlers.login!(h.ctx, []);
    const errors = h.entries.filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect((errors[0] as { text: string }).text).toMatch(/boom/);
  });
});

describe("/address pick", () => {
  it("creates the preset Koramangala address with correct lat/lng", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["pick", "1"]);

    const koramangala = findArea("koramangala")!;
    const createCall = h.calls.find((c) => c.tool === "create_address");
    expect(createCall).toBeDefined();
    expect(createCall!.server).toBe("im");
    expect(createCall!.args.latitude).toBeCloseTo(koramangala.lat, 4);
    expect(createCall!.args.longitude).toBeCloseTo(koramangala.lng, 4);
    expect(createCall!.args.postalCode).toBe(koramangala.pincode);
    expect(createCall!.args.city).toBe("Bangalore");
    // The fake returns id ADDR-NEW; handler should mark it active.
    expect(h.ctx.state.activeAddressId).toBe("ADDR-NEW");
  });

  it("rejects out-of-range picks", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["pick", "99"]);
    const errs = h.entries.filter((e) => e.kind === "error");
    expect(errs).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });
});

describe("/address use", () => {
  it("sets activeAddressId from the previously listed addresses", async () => {
    const h = makeHarness();
    h.setNextResponse("food", "get_addresses", {
      structuredContent: {
        addresses: [
          { id: "A1", fullAddress: "1 Main, Koramangala, Bangalore" },
          { id: "A2", fullAddress: "2 Side, Indiranagar, Bangalore" },
        ],
      },
    });
    await miscHandlers.address!(h.ctx, ["list"]);
    expect(h.calls.some((c) => c.tool === "get_addresses")).toBe(true);

    await miscHandlers.address!(h.ctx, ["use", "2"]);
    expect(h.ctx.state.activeAddressId).toBe("A2");
  });

  it("errors when no list has been cached", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["use", "1"]);
    const errs = h.entries.filter((e) => e.kind === "error");
    expect(errs).toHaveLength(1);
  });
});

describe("/address add", () => {
  it("dispatches create_address on Instamart with looked-up lat/lng", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["add", "MG Road, Bangalore"]);

    const mg = findArea("mg-road")!;
    const call = h.calls.find((c) => c.tool === "create_address");
    expect(call).toBeDefined();
    expect(call!.server).toBe("im");
    expect(call!.args.latitude).toBeCloseTo(mg.lat, 4);
    expect(call!.args.longitude).toBeCloseTo(mg.lng, 4);
    expect(call!.args.postalCode).toBe(mg.pincode);
    expect(call!.args.city).toBe("Bangalore");
  });

  it("parses three-comma form with explicit line1", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, [
      "add",
      "Flat 3B, Indiranagar, Bangalore",
    ]);
    const ind = findArea("indiranagar")!;
    const call = h.calls.find((c) => c.tool === "create_address");
    expect(call).toBeDefined();
    expect(call!.args.addressLine).toBe("Flat 3B");
    expect(call!.args.latitude).toBeCloseTo(ind.lat, 4);
    expect(call!.args.longitude).toBeCloseTo(ind.lng, 4);
  });

  it("aborts with an error on unknown areas and does not call MCP", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["add", "Flat 1, Atlantis, Bangalore"]);
    const errs = h.entries.filter((e) => e.kind === "error");
    expect(errs).toHaveLength(1);
    expect((errs[0] as { text: string }).text).toMatch(/Unknown area/);
    expect(h.calls).toHaveLength(0);
  });
});

describe("/address list first-run picker", () => {
  it("renders the preset picker when the address book is empty", async () => {
    const h = makeHarness();
    await miscHandlers.address!(h.ctx, ["list"]);
    const info = h.entries
      .filter((e) => e.kind === "info")
      .map((e) => (e as { text: string }).text)
      .join("\n");
    expect(info).toMatch(/No saved delivery address yet/i);
    expect(info).toMatch(/Koramangala/);
    expect(info).toMatch(/\/address pick 1/);
    expect(info).toMatch(/\/address add/);
  });
});
