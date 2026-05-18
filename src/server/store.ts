import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// TODO(wave2): import richer types from `src/shared/schemas/*` once Track B lands them.
import type {
  InstamartAddress,
  InstamartCart,
  InstamartOrder,
} from "./handlers/instamart/_types.js";
import type {
  Address as FoodAddress,
  FoodCart,
  FoodOrder,
} from "./handlers/food/_types.js";
import type {
  DineoutBooking,
  SavedLocation as DineoutSavedLocation,
} from "./handlers/dineout/_types.js";

export interface PendingCode {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

export interface State {
  schemaVersion: 1;
  auth: {
    pendingCodes: Record<string, PendingCode>;
    revokedJtis: string[];
  };
  addresses: {
    food: FoodAddress[];
    instamart: InstamartAddress[];
    dineout: DineoutSavedLocation[];
  };
  carts: {
    food: Record<string, FoodCart>;
    instamart: Record<string, InstamartCart>;
  };
  orders: {
    food: FoodOrder[];
    instamart: InstamartOrder[];
    dineout: DineoutBooking[];
  };
}

function emptyState(): State {
  return {
    schemaVersion: 1,
    auth: { pendingCodes: {}, revokedJtis: [] },
    addresses: { food: [], instamart: [], dineout: [] },
    carts: { food: {}, instamart: {} },
    orders: { food: [], instamart: [], dineout: [] },
  };
}

// Tiny in-process async mutex; avoids a new dep.
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  }
}

const mutex = new Mutex();

let stateDir: string = defaultStateDir();

function defaultStateDir(): string {
  return path.join(os.homedir(), ".tyda-swiggy");
}

export function setStateDir(dir: string): void {
  stateDir = path.resolve(dir);
}

export function getStateDir(): string {
  return stateDir;
}

function stateFile(): string {
  return path.join(stateDir, "state.json");
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  // mkdir doesn't always set mode on existing dirs; enforce.
  try {
    await fs.chmod(stateDir, 0o700);
  } catch {
    // Best-effort.
  }
}

export async function loadState(): Promise<State> {
  await ensureDir();
  const file = stateFile();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as State;
    return parsed;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      const fresh = emptyState();
      await writeAtomic(fresh);
      return fresh;
    }
    throw err;
  }
}

async function writeAtomic(state: State): Promise<void> {
  await ensureDir();
  const file = stateFile();
  const tmp = file + ".tmp";
  const json = JSON.stringify(state, null, 2);
  await fs.writeFile(tmp, json, { mode: 0o600 });
  await fs.rename(tmp, file);
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Best-effort.
  }
}

export async function saveState(state: State): Promise<void> {
  const release = await mutex.acquire();
  try {
    await writeAtomic(state);
  } finally {
    release();
  }
}

export async function mutate(fn: (state: State) => void | Promise<void>): Promise<State> {
  const release = await mutex.acquire();
  try {
    let state: State;
    try {
      const raw = await fs.readFile(stateFile(), "utf8");
      state = JSON.parse(raw) as State;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
      state = emptyState();
    }
    await fn(state);
    await writeAtomic(state);
    return state;
  } finally {
    release();
  }
}
