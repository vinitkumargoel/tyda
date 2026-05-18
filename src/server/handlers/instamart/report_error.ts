import { logger } from "../../logger.js";
import type { OkResponse } from "../../../shared/response.js";

export interface ReportErrorInput {
  tool: string;
  domain?: string;
  errorMessage: string;
  flowDescription?: string;
  toolContext?: Record<string, unknown>;
  userNotes?: string;
}

function buildMailto(args: ReportErrorInput): string {
  const subject = encodeURIComponent(
    `[Swiggy MCP] Instamart error: ${args.tool}`,
  );
  const lines: string[] = [
    `Tool: ${args.tool}`,
    `Domain: ${args.domain ?? "im"}`,
    `Error: ${args.errorMessage}`,
  ];
  if (args.flowDescription) lines.push(`Flow: ${args.flowDescription}`);
  if (args.toolContext) lines.push(`Context: ${JSON.stringify(args.toolContext)}`);
  if (args.userNotes) lines.push(`Notes: ${args.userNotes}`);
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:mcp-support@swiggy.com?subject=${subject}&body=${body}`;
}

export async function reportError(
  args: ReportErrorInput,
): Promise<
  OkResponse<{ mailtoUrl: string; summary: string; loggedAt: number }>
> {
  const mailtoUrl = buildMailto(args);
  const loggedAt = Date.now();
  logger.error("instamart.report_error", {
    tool: args.tool,
    domain: args.domain ?? "im",
    errorMessage: args.errorMessage,
    flowDescription: args.flowDescription,
    toolContext: args.toolContext,
    userNotes: args.userNotes,
    loggedAt,
  });
  const summary =
    `Error report logged for tool "${args.tool}": ${args.errorMessage}`;
  return {
    success: true,
    data: { mailtoUrl, summary, loggedAt },
    message: "Error report captured. Use the mailtoUrl to share with the Swiggy MCP team.",
  };
}
