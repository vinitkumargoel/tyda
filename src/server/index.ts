import { buildApp } from "./http.js";
import { setStateDir, loadState, getStateDir } from "./store.js";
import { getKeys } from "./oauth/jwt.js";
import { logger } from "./logger.js";

interface CliArgs {
  port: number;
  stateDir?: string;
  autoApprove: boolean;
  heartbeatMs?: number;
  issuer?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: Number(process.env.PORT ?? 8787),
    autoApprove: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") {
      args.port = Number(argv[++i]);
    } else if (a === "--state-dir") {
      args.stateDir = argv[++i];
    } else if (a === "--auto-approve") {
      args.autoApprove = true;
    } else if (a === "--heartbeat-ms") {
      args.heartbeatMs = Number(argv[++i]);
    } else if (a === "--issuer") {
      args.issuer = argv[++i];
    }
  }
  return args;
}

export async function start(argv: string[] = process.argv.slice(2)): Promise<{ close: () => Promise<void>; port: number }> {
  const args = parseArgs(argv);
  if (args.stateDir) setStateDir(args.stateDir);

  await loadState();
  await getKeys();

  const issuer = args.issuer ?? `http://127.0.0.1:${args.port}`;
  process.env.OAUTH_ISSUER = issuer;

  const app = await buildApp({
    issuer,
    autoApprove: args.autoApprove,
    heartbeatMs: args.heartbeatMs,
  });

  const address = await app.listen({ port: args.port, host: "127.0.0.1" });
  logger.info("server.listening", { address, issuer, stateDir: getStateDir() });

  return {
    port: args.port,
    close: async () => {
      await app.close();
    },
  };
}

const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const url = new URL(`file://${entry}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  start().catch((err) => {
    logger.error("server.start_failed", { err: (err as Error).message });
    process.exit(1);
  });
}
