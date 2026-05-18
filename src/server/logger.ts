// Minimal structured JSON-lines logger. Wave 2 may swap for pino.
// TODO(wave2): consider integrating with a richer logger if observability needs grow.

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const minLevel = LEVELS[envLevel()];
  if (LEVELS[level] < minLevel) return;
  const record: Record<string, unknown> = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(fields ?? {}),
  };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(JSON.stringify(record) + "\n");
}

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    emit("debug", msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit("error", msg, fields);
  },
};
