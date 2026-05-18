import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredToken {
  accessToken: string;
  expiresAt: number;
  issuer: string;
}

function defaultStateDir(): string {
  return join(homedir(), ".tyda-swiggy");
}

function tokenPath(stateDir: string | undefined): string {
  return join(stateDir ?? defaultStateDir(), "token.json");
}

function isStoredToken(x: unknown): x is StoredToken {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.accessToken === "string" &&
    typeof o.expiresAt === "number" &&
    typeof o.issuer === "string"
  );
}

export async function loadToken(stateDir?: string): Promise<StoredToken | null> {
  const file = tokenPath(stateDir);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isStoredToken(parsed) ? parsed : null;
}

export async function saveToken(stateDir: string | undefined, token: StoredToken): Promise<void> {
  const file = tokenPath(stateDir);
  await fs.mkdir(dirname(file), { recursive: true });
  // Write+rename for atomicity; chmod to 0600.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(token), { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  // Some platforms reset perms on rename — re-chmod the target.
  try {
    await fs.chmod(file, 0o600);
  } catch {
    /* best-effort */
  }
}

export async function clearToken(stateDir?: string): Promise<void> {
  const file = tokenPath(stateDir);
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
