import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setStateDir, loadState, saveState, mutate, getStateDir } from "../../src/server/store.js";

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tyda-store-"));
  return dir;
}

describe("store", () => {
  beforeEach(async () => {
    const dir = await tempDir();
    setStateDir(dir);
  });

  it("loads an empty state and creates state.json on disk", async () => {
    const s = await loadState();
    expect(s.schemaVersion).toBe(1);
    expect(s.auth.pendingCodes).toEqual({});
    const file = path.join(getStateDir(), "state.json");
    const stat = await fs.stat(file);
    // Mask off file-type bits; just check perm bits.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("round-trips saveState/loadState", async () => {
    const s = await loadState();
    s.auth.revokedJtis.push("abc");
    await saveState(s);
    const s2 = await loadState();
    expect(s2.auth.revokedJtis).toEqual(["abc"]);
  });

  it("mutate persists updates via the mutex", async () => {
    await loadState();
    await mutate((s) => {
      s.auth.revokedJtis.push("one");
    });
    await mutate((s) => {
      s.auth.revokedJtis.push("two");
    });
    const s = await loadState();
    expect(s.auth.revokedJtis).toEqual(["one", "two"]);
  });

  it("concurrent mutate calls don't corrupt state", async () => {
    await loadState();
    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < 25; i++) {
      tasks.push(
        mutate((s) => {
          s.auth.revokedJtis.push(`jti-${i}`);
        }),
      );
    }
    await Promise.all(tasks);
    const s = await loadState();
    expect(s.auth.revokedJtis).toHaveLength(25);
    const set = new Set(s.auth.revokedJtis);
    expect(set.size).toBe(25);
  });

  it("preserves 0600 mode after writes", async () => {
    await loadState();
    await mutate((s) => {
      s.auth.revokedJtis.push("x");
    });
    const file = path.join(getStateDir(), "state.json");
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
