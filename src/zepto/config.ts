/**
 * Unified config + credentials store: ~/.tyda/config.yml
 *
 * One YAML file holds everything that must survive a restart — the Zepto session
 * (credentials: token, refresh token, cookies, device/session ids, storeId) plus
 * any future config (default store, llm settings, …). Reopen the tool and you're
 * still logged in.
 *
 * Written 0600 — it contains a live bearer token for the user's real account.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { parse, stringify } from "yaml";

export const CONFIG_DIR = join(homedir(), ".tyda");
export const CONFIG_PATH = join(CONFIG_DIR, "config.yml");

export type Config = Record<string, unknown> & {
  zepto?: { session?: unknown } & Record<string, unknown>;
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return (parse(readFileSync(CONFIG_PATH, "utf8")) as Config) ?? {};
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Config): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    "# tyda config + credentials. Contains a live Zepto token — keep private.\n" + stringify(cfg),
  );
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort */
  }
  return CONFIG_PATH;
}
