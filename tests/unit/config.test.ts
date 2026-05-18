import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../../src/tui/config.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tyda-cfg-"));
}

async function writeYaml(dir: string, content: string): Promise<string> {
  const file = path.join(dir, "config.yml");
  await fs.writeFile(file, content, "utf8");
  return file;
}

describe("config.loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await tempDir();
  });

  it("returns defaults when nothing is set", () => {
    const cfg = loadConfig({
      flags: {},
      configPath: path.join(dir, "missing.yml"),
      env: {},
    });
    expect(cfg.swiggy.remote).toBe("http://127.0.0.1:8787");
    expect(cfg.swiggy.demoSpeed).toBe("fast");
    expect(cfg.llm).toBeUndefined();
  });

  it("reads YAML-only swiggy config and camelCases keys", async () => {
    const file = await writeYaml(
      dir,
      [
        "swiggy:",
        "  remote: http://yaml-host:9000",
        "  demo_speed: real",
        "llm:",
        "  provider: gateway",
        "  base_url: https://example.test/v1",
        "  token: t-yaml",
        "  model: gpt-test",
        "  max_steps: 5",
        "  temperature: 0.4",
        "  pricing:",
        "    input:  0.10",
        "    output: 0.50",
      ].join("\n"),
    );
    const cfg = loadConfig({ flags: {}, configPath: file, env: {} });
    expect(cfg.swiggy.remote).toBe("http://yaml-host:9000");
    expect(cfg.swiggy.demoSpeed).toBe("real");
    expect(cfg.llm).toBeDefined();
    expect(cfg.llm!.baseUrl).toBe("https://example.test/v1");
    expect(cfg.llm!.token).toBe("t-yaml");
    expect(cfg.llm!.model).toBe("gpt-test");
    expect(cfg.llm!.maxSteps).toBe(5);
    expect(cfg.llm!.temperature).toBe(0.4);
    expect(cfg.llm!.pricing).toEqual({ input: 0.1, output: 0.5 });
  });

  it("env overrides YAML", async () => {
    const file = await writeYaml(
      dir,
      ["swiggy:", "  remote: http://yaml-host:9000", "  demo_speed: real"].join("\n"),
    );
    const cfg = loadConfig({
      flags: {},
      configPath: file,
      env: {
        TYDA_REMOTE: "http://env-host:1234",
        TYDA_DEMO_SPEED: "fast",
      },
    });
    expect(cfg.swiggy.remote).toBe("http://env-host:1234");
    expect(cfg.swiggy.demoSpeed).toBe("fast");
  });

  it("flag beats env beats YAML beats default", async () => {
    const file = await writeYaml(
      dir,
      ["swiggy:", "  remote: http://yaml-host:9000"].join("\n"),
    );
    const cfg = loadConfig({
      flags: { remote: "http://flag-host:7777" },
      configPath: file,
      env: { TYDA_REMOTE: "http://env-host:1234" },
    });
    expect(cfg.swiggy.remote).toBe("http://flag-host:7777");
  });

  it("env-only LLM works (no YAML)", () => {
    const cfg = loadConfig({
      flags: {},
      configPath: path.join(dir, "absent.yml"),
      env: {
        TYDA_LLM_BASE_URL: "https://env.test/v1",
        TYDA_LLM_TOKEN: "env-token",
        TYDA_LLM_MODEL: "env-model",
      },
    });
    expect(cfg.llm).toBeDefined();
    expect(cfg.llm!.baseUrl).toBe("https://env.test/v1");
    expect(cfg.llm!.token).toBe("env-token");
    expect(cfg.llm!.model).toBe("env-model");
  });

  it("flag overrides env for LLM token", async () => {
    const file = await writeYaml(
      dir,
      [
        "llm:",
        "  base_url: https://yaml.test/v1",
        "  token: yaml-token",
        "  model: yaml-model",
      ].join("\n"),
    );
    const cfg = loadConfig({
      flags: { llmToken: "flag-token" },
      configPath: file,
      env: { TYDA_LLM_TOKEN: "env-token" },
    });
    expect(cfg.llm!.token).toBe("flag-token");
    // YAML still supplies base_url + model.
    expect(cfg.llm!.baseUrl).toBe("https://yaml.test/v1");
    expect(cfg.llm!.model).toBe("yaml-model");
  });

  it("missing LLM token in YAML and env yields no llm block", async () => {
    const file = await writeYaml(
      dir,
      [
        "llm:",
        "  base_url: https://yaml.test/v1",
        "  model: yaml-model",
      ].join("\n"),
    );
    const cfg = loadConfig({ flags: {}, configPath: file, env: {} });
    expect(cfg.llm).toBeUndefined();
  });
});
