import path from "node:path";
import fs from "node:fs/promises";

const LOG_DIR = path.resolve(process.cwd(), "server/logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const ENV = (process.env.NODE_ENV ?? "development").toLowerCase();

let configured = false;
let fallbackConsoleError: ((...args: any[]) => void) | null = null;

async function ensureLogDirectory(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

function serializeArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLogMessage(args: unknown[]): string {
  return args.map(serializeArgument).join(" ");
}

async function appendLog(level: string, message: string): Promise<void> {
  try {
    await ensureLogDirectory();
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;
    await fs.appendFile(LOG_FILE, line, "utf8");
  } catch (error) {
    if (fallbackConsoleError) {
      fallbackConsoleError("[logger] failed to write log entry", error);
    }
  }
}

function shouldOutputToConsole(level: "info" | "warn" | "error"): boolean {
  if (ENV === "production") {
    return level === "error";
  }
  return level !== "info";
}

function createConsoleHandler(
  level: "info" | "warn" | "error",
  original: (...args: any[]) => void,
): (...args: any[]) => void {
  return (...args: any[]) => {
    const message = formatLogMessage(args);
    void appendLog(level, message);
    if (shouldOutputToConsole(level)) {
      original(...args);
    }
  };
}

export function configureLogging(): void {
  if (configured) {
    return;
  }

  configured = true;
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  fallbackConsoleError = originalError;

  const infoHandler = createConsoleHandler("info", originalInfo);
  const logHandler = createConsoleHandler("info", originalLog);
  const warnHandler = createConsoleHandler("warn", originalWarn);
  const errorHandler = createConsoleHandler("error", originalError);

  console.log = logHandler;
  console.info = infoHandler;
  console.warn = warnHandler;
  console.error = errorHandler;
}

function normaliseError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? undefined };
  }
  if (typeof error === "object" && error !== null) {
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

export async function logError(scope: string, error: unknown): Promise<void> {
  const normalised = normaliseError(error);
  const payload = [
    `${scope}`,
    `Message: ${normalised.message}`,
    normalised.stack ? `Stack: ${normalised.stack}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
  await appendLog("error", payload);
}
