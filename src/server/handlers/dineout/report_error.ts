import { logger } from "../../logger.js";
import type { Response } from "../../../shared/response.js";

interface Args {
  tool: string;
  domain?: string;
  errorMessage: string;
  flowDescription?: string;
  toolContext?: Record<string, unknown>;
  userNotes?: string;
}

export type ReportErrorResult = Response<{
  mailto: string;
  summary: string;
}>;

const SUPPORT_EMAIL = "swiggy-mcp-support@swiggy.com";

function lines(args: Args): string[] {
  const out: string[] = [];
  out.push(`Tool: ${args.tool}`);
  out.push(`Domain: ${args.domain ?? "dineout"}`);
  out.push(`Error: ${args.errorMessage}`);
  if (args.flowDescription) out.push(`Flow: ${args.flowDescription}`);
  if (args.toolContext) {
    out.push("Context:");
    for (const [k, v] of Object.entries(args.toolContext)) {
      out.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  if (args.userNotes) out.push(`Notes: ${args.userNotes}`);
  return out;
}

export async function reportError(args: Args): Promise<ReportErrorResult> {
  const body = lines(args).join("\n");
  const subject = `[MCP/dineout] ${args.tool}: ${args.errorMessage.slice(0, 60)}`;
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  logger.warn("dineout.report_error", {
    tool: args.tool,
    errorMessage: args.errorMessage,
    flowDescription: args.flowDescription,
    toolContext: args.toolContext,
  });

  return {
    success: true,
    data: { mailto, summary: body },
    message: "Error report logged. Use the mailto link to email the team.",
  };
}
