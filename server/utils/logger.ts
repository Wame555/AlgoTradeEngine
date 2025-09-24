import path from "path";
import { promises as fs } from "fs";

const LOG_DIR = path.resolve(process.cwd(), "server/logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

function normaliseError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? undefined };
  }
  if (typeof error === "object") {
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

export async function logError(scope: string, error: unknown): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const normalised = normaliseError(error);
    const payload = [
      `[${new Date().toISOString()}] ${scope}`,
      `Message: ${normalised.message}`,
      normalised.stack ? `Stack: ${normalised.stack}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    await fs.appendFile(LOG_FILE, `${payload}\n`);
  } catch (loggingError) {
    console.error("Failed to write to application log", loggingError);
  }
}
