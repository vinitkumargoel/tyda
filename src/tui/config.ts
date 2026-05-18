import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type DemoSpeed = "fast" | "real";

export interface Config {
  swiggy: { remote: string; demoSpeed: DemoSpeed };
  llm?: {
    provider?: string;
    baseUrl: string;
    token: string;
    model: string;
    maxSteps?: number;
    temperature?: number;
    pricing?: { input: number; output: number };
  };
}

export interface LoadConfigOpts {
  flags: Record<string, string | undefined>;
  configPath?: string;
  /** Override env (defaults to process.env). Useful for tests. */
  env?: Record<string, string | undefined>;
}

const DEFAULT_REMOTE = "http://127.0.0.1:8787";
const DEFAULT_DEMO_SPEED: DemoSpeed = "fast";

/** Convert snake_case to camelCase recursively for plain objects. */
function camelize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelize);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out[camelKey] = camelize(v);
    }
    return out;
  }
  return value;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function readYamlFile(filePath: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const parsed: unknown = parseYaml(text);
  if (parsed === null || parsed === undefined) return {};
  if (!isObject(parsed)) {
    throw new Error(`Config file ${filePath} did not parse to a mapping`);
  }
  const camel = camelize(parsed);
  if (!isObject(camel)) {
    throw new Error(`Config file ${filePath} did not parse to an object`);
  }
  return camel;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pickDemoSpeed(v: unknown): DemoSpeed | undefined {
  return v === "fast" || v === "real" ? v : undefined;
}

function defaultConfigPath(env: Record<string, string | undefined>): string {
  const home = env.HOME ?? homedir();
  return join(home, ".tyda-swiggy", "config.yml");
}

export function loadConfig(opts: LoadConfigOpts): Config {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const flags = opts.flags;

  const yamlPath = opts.configPath ?? flags["config"] ?? defaultConfigPath(env);
  const yaml = readYamlFile(yamlPath);

  const swiggyYaml = isObject(yaml["swiggy"]) ? (yaml["swiggy"] as Record<string, unknown>) : {};
  const llmYaml = isObject(yaml["llm"]) ? (yaml["llm"] as Record<string, unknown>) : undefined;

  const remote =
    pickString(flags["remote"]) ??
    pickString(env["TYDA_REMOTE"]) ??
    pickString(swiggyYaml["remote"]) ??
    DEFAULT_REMOTE;

  const demoSpeed =
    pickDemoSpeed(flags["demoSpeed"] ?? flags["demo-speed"]) ??
    pickDemoSpeed(env["TYDA_DEMO_SPEED"]) ??
    pickDemoSpeed(swiggyYaml["demoSpeed"]) ??
    DEFAULT_DEMO_SPEED;

  const llmBaseUrl =
    pickString(flags["llmBaseUrl"] ?? flags["llm-base-url"]) ??
    pickString(env["TYDA_LLM_BASE_URL"]) ??
    (llmYaml ? pickString(llmYaml["baseUrl"]) : undefined);

  const llmToken =
    pickString(flags["llmToken"] ?? flags["llm-token"]) ??
    pickString(env["TYDA_LLM_TOKEN"]) ??
    (llmYaml ? pickString(llmYaml["token"]) : undefined);

  const llmModel =
    pickString(flags["llmModel"] ?? flags["llm-model"]) ??
    pickString(env["TYDA_LLM_MODEL"]) ??
    (llmYaml ? pickString(llmYaml["model"]) : undefined);

  const config: Config = {
    swiggy: { remote, demoSpeed },
  };

  if (llmBaseUrl && llmToken && llmModel) {
    const llm: NonNullable<Config["llm"]> = {
      baseUrl: llmBaseUrl,
      token: llmToken,
      model: llmModel,
    };
    if (llmYaml) {
      const provider = pickString(llmYaml["provider"]);
      if (provider) llm.provider = provider;
      const maxSteps = pickNumber(llmYaml["maxSteps"]);
      if (maxSteps !== undefined) llm.maxSteps = maxSteps;
      const temperature = pickNumber(llmYaml["temperature"]);
      if (temperature !== undefined) llm.temperature = temperature;
      const pricing = llmYaml["pricing"];
      if (isObject(pricing)) {
        const input = pickNumber(pricing["input"]);
        const output = pickNumber(pricing["output"]);
        if (input !== undefined && output !== undefined) {
          llm.pricing = { input, output };
        }
      }
    }
    config.llm = llm;
  }

  return config;
}

/** Resolve the state directory the same way loadConfig resolves $HOME. */
export function resolveStateDir(opts: { flags: Record<string, string | undefined>; env?: Record<string, string | undefined> }): string {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const flag = pickString(opts.flags["stateDir"] ?? opts.flags["state-dir"]);
  if (flag) return flag;
  const envDir = pickString(env["TYDA_STATE_DIR"]);
  if (envDir) return envDir;
  const home = env.HOME ?? homedir();
  return join(home, ".tyda-swiggy");
}
