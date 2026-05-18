import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";

import { App } from "../../src/tui/app.jsx";
import { COMMANDS } from "../../src/tui/slash/registry.js";
import type { McpDispatcher } from "../../src/tui/slash/types.js";

function stubDispatcher(): McpDispatcher {
  const fail = (): never => {
    throw new Error("test-stub: not wired");
  };
  return {
    call: async () => fail(),
    ensureAuth: async () => fail(),
  };
}

// Wait for Ink to flush React state updates into a frame.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe("TUI smoke", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the header banner with the remote URL", async () => {
    const remoteUrl = "http://127.0.0.1:8787";
    const { lastFrame, unmount } = render(
      <App remoteUrl={remoteUrl} mcp={stubDispatcher()} />,
    );
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("tyda — Swiggy MCP terminal");
    expect(frame).toContain(remoteUrl);
    expect(frame).toContain("/help");
    unmount();
  });

  it("/help lists every non-hidden slash command", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App remoteUrl="http://127.0.0.1:8787" mcp={stubDispatcher()} />,
    );
    await flush();

    // Type "/help" + Enter.
    stdin.write("/help");
    await flush();
    stdin.write("\r"); // Enter
    await flush();

    const frame = lastFrame() ?? "";

    const visible = COMMANDS.filter((c) => !c.hidden);
    for (const c of visible) {
      expect(frame, `missing /${c.name} in /help output`).toContain(
        `/${c.name}`,
      );
    }

    // The hidden /ai command must NOT appear in /help output.
    const hidden = COMMANDS.filter((c) => c.hidden);
    for (const c of hidden) {
      // It's fine if "/ai" never appears in the frame at all; what matters
      // is that the help listing didn't surface it.
      // A reliable check: no help row should match `/ai ` as a prefix.
      expect(frame).not.toMatch(new RegExp(`^\\s*/${c.name}\\s`, "m"));
    }

    unmount();
  });

  it("reports an error for an unknown command", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App remoteUrl="http://127.0.0.1:8787" mcp={stubDispatcher()} />,
    );
    await flush();

    stdin.write("/nope");
    await flush();
    stdin.write("\r");
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("unknown command");
    unmount();
  });
});
