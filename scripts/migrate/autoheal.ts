import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type ChangeSummary = {
  description: string;
  count: number;
};

const DISABLE_AUTOHEAL = (process.env.AUTOHEAL_DISABLE ?? "").toLowerCase() === "true";

async function main(): Promise<void> {
  if (DISABLE_AUTOHEAL) {
    console.warn("[autoheal] AUTOHEAL_DISABLE=true -> skipping file sanitization");
    return;
  }

  const drizzleDir = path.resolve(process.cwd(), "drizzle");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(drizzleDir);
  } catch (error) {
    console.error(
      "[autoheal] unable to read drizzle directory:",
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const sqlFiles = entries.filter((entry) => entry.endsWith(".sql"));
  if (sqlFiles.length === 0) {
    console.warn("[autoheal] no drizzle SQL files detected, nothing to sanitize");
    return;
  }

  for (const fileName of sqlFiles.sort()) {
    const filePath = path.join(drizzleDir, fileName);
    try {
      await sanitizeFile(filePath, fileName);
    } catch (error) {
      console.error(
        `[autoheal] failed to sanitize ${fileName}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function sanitizeFile(filePath: string, fileName: string): Promise<void> {
  let original: string;
  try {
    original = await fs.readFile(filePath, "utf8");
  } catch (error) {
    console.error(
      `[autoheal] unable to read ${fileName}:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const changeSummary: ChangeSummary[] = [];
  let content = original;

  const statementResult = removeStatementBreakpoints(content);
  if (statementResult.removed > 0) {
    content = statementResult.content;
    changeSummary.push({
      description: "removed statement-breakpoint markers",
      count: statementResult.removed,
    });
  }

  const normalizationResult = normalizeIndexStatements(content);
  content = normalizationResult.content;
  if (normalizationResult.updated > 0) {
    changeSummary.push({
      description: "normalized index statements",
      count: normalizationResult.updated,
    });
  }

  if (content !== original) {
    try {
      await fs.writeFile(filePath, ensureTrailingNewline(content), "utf8");
    } catch (error) {
      console.error(
        `[autoheal] unable to write ${fileName}:`,
        error instanceof Error ? error.message : error,
      );
      return;
    }
  }

  const total = changeSummary.reduce((sum, change) => sum + change.count, 0);
  if (total > 0) {
    const details = changeSummary.map((change) => `${change.description} (${change.count})`).join(", ");
    console.warn(`[autoheal] ${fileName}: ${details} -> total ${total} adjustment(s)`);
  }
}

function removeStatementBreakpoints(content: string): { content: string; removed: number } {
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter(
    (line) => !line.trim().startsWith("-->") || !line.includes("statement-breakpoint"),
  );
  const removed = lines.length - filtered.length;
  return {
    content: filtered.join("\n"),
    removed,
  };
}

function normalizeIndexStatements(content: string): { content: string; updated: number } {
  const lines = content.split(/\r?\n/);
  let updated = 0;
  let insideDoBlock = false;

  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower.includes("do $$")) {
      insideDoBlock = true;
    }

    if (insideDoBlock) {
      if (lower.includes("$$;")) {
        insideDoBlock = false;
      }
      return line;
    }

    if (trimmed.startsWith("--") || trimmed.length === 0) {
      return line;
    }

    const dropMatch = trimmed.match(/^drop\s+index\s+(?:if\s+exists\s+)?([\"\w\.]+)\s*;$/i);
    if (dropMatch) {
      updated += 1;
      const identifier = dropMatch[1]!.replace(/"/g, "");
      const indexName = identifier.split(".").pop() ?? identifier;
      const prefix = line.slice(0, line.length - trimmed.length);
      return `${prefix}DROP INDEX IF EXISTS public.${indexName};`;
    }

    const createMatch = trimmed.match(
      /^create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([\w]+)"?\s+on\s+"?([\w\.]+)"?\s*\(([^)]+)\);$/i,
    );
    if (createMatch) {
      updated += 1;
      const unique = Boolean(createMatch[1]);
      const indexName = createMatch[2]!;
      const tableIdentifier = createMatch[3]!.replace(/"/g, "");
      const tableName = tableIdentifier.split(".").pop() ?? tableIdentifier;
      const columns = createMatch[4]!.trim();
      const prefix = line.slice(0, line.length - trimmed.length);
      const keyword = unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
      return `${prefix}${keyword} IF NOT EXISTS ${indexName} ON public.${tableName}(${columns});`;
    }

    return line;
  });

  return { content: normalizedLines.join("\n"), updated };
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

void main().catch((error) => {
  console.error("[autoheal] unexpected failure", error);
  process.exitCode = 1;
});
