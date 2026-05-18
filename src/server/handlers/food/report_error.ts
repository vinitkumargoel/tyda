/**
 * report_error — append a structured error report to
 * `<stateDir>/error-log.json` and return a mailto: URL for the user.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { getStateDir } from "../../store.js";
import type { HandlerContext } from "./_types.js";

interface Input {
  tool: string;
  domain?: string;
  errorMessage: string;
  flowDescription?: string;
  toolContext?: Record<string, unknown>;
  userNotes?: string;
}

export interface ReportErrorOutput {
  success: true;
  data: { mailtoUrl: string; summary: string };
}

interface LogEntry extends Input {
  reportedAt: string;
  userId: string;
}

async function appendLog(entry: LogEntry): Promise<void> {
  const file = path.join(getStateDir(), "error-log.json");
  let existing: LogEntry[] = [];
  try {
    const raw = await fs.readFile(file, "utf8");
    existing = JSON.parse(raw) as LogEntry[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
  existing.push(entry);
  await fs.writeFile(file, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

export default async function handle(
  input: Input,
  ctx: HandlerContext,
): Promise<ReportErrorOutput> {
  const entry: LogEntry = {
    ...input,
    domain: input.domain ?? "food",
    reportedAt: new Date().toISOString(),
    userId: ctx.auth.sub,
  };
  await appendLog(entry);

  const subject = `Swiggy MCP error in ${input.tool}`;
  const bodyLines = [
    `Tool: ${input.tool}`,
    `Domain: ${entry.domain}`,
    `Error: ${input.errorMessage}`,
  ];
  if (input.flowDescription) bodyLines.push(`Flow: ${input.flowDescription}`);
  if (input.userNotes) bodyLines.push(`Notes: ${input.userNotes}`);
  const body = bodyLines.join("\n");
  const mailtoUrl = `mailto:mcp-support@swiggy.in?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const summary = bodyLines.join(" | ");

  return {
    success: true,
    data: { mailtoUrl, summary },
  };
}
