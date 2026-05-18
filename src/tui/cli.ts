#!/usr/bin/env node
import React from "react";
import { render } from "ink";

import { App } from "./app.jsx";
import { loadConfig, type Config } from "./config.js";
import { setAiCommandVisibility } from "./slash/registry.js";
import { createDispatcher } from "./mcp-client.js";
import type { TranscriptEntry } from "./slash/types.js";


export interface CliFlags {
  remote: string;
  demoSpeed: "fast" | "real";
  stateDir: string | null;
  autoApprove: boolean;
  configPath: string | null;
  /** Passthrough — unused by the TUI, accepted for parity with the server flag. */
  port: number | null;
}

const DEFAULT_REMOTE = "http://127.0.0.1:8787";

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    remote: DEFAULT_REMOTE,
    demoSpeed: "fast",
    stateDir: null,
    autoApprove: false,
    configPath: null,
    port: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--remote":
        flags.remote = argv[++i] ?? DEFAULT_REMOTE;
        break;
      case "--demo-speed": {
        const v = argv[++i];
        if (v === "fast" || v === "real") flags.demoSpeed = v;
        break;
      }
      case "--state-dir":
        flags.stateDir = argv[++i] ?? null;
        break;
      case "--auto-approve":
        flags.autoApprove = true;
        break;
      case "--config":
        flags.configPath = argv[++i] ?? null;
        break;
      case "--port": {
        const v = argv[++i];
        const n = v ? Number.parseInt(v, 10) : NaN;
        flags.port = Number.isFinite(n) ? n : null;
        break;
      }
      default:
        // Ignore unknown flags rather than crashing; the TUI is interactive,
        // and Track E may add more flags later.
        break;
    }
  }

  return flags;
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const flags = parseArgs(argv);
  const cfgFlags: Record<string, string | undefined> = {
    remote: flags.remote,
    demoSpeed: flags.demoSpeed,
  };
  if (flags.configPath) cfgFlags["config"] = flags.configPath;
  const config: Config = loadConfig({ flags: cfgFlags });
  setAiCommandVisibility(Boolean(config.llm));
  const stateDir = flags.stateDir ?? `${process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~"}/.tyda-swiggy`;

  // Filled in once App mounts via onMounted. The OAuth URL callback captures
  // this ref so the authorize URL is always shown in the transcript.
  let pushToTranscript: ((entry: TranscriptEntry) => void) | null = null;

  const mcp = createDispatcher({
    config,
    stateDir,
    onAuthorizeUrl: (url) => {
      pushToTranscript?.({ kind: "info", text: `Open in browser to log in:\n  ${url}` });
    },
  });
  render(
    React.createElement(App, {
      remoteUrl: flags.remote,
      mcp,
      config,
      onMounted: (push) => { pushToTranscript = push; },
    }),
  );
}

// Only run when invoked directly, not when imported by tests.
const isDirectInvocation =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  // Best-effort: the entry is this file when run via `tsx src/tui/cli.ts`
  // or `node dist/tui/cli.js`. Compare on the resolved path suffix.
  /(?:^|\/)cli\.(?:ts|js)$/.test(process.argv[1]);

if (isDirectInvocation) {
  main();
}
