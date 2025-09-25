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
        console.info("[autoheal] AUTOHEAL_DISABLE=true -> skipping file sanitization");
        return;
    }

    const drizzleDir = path.resolve(process.cwd(), "drizzle");
    let entries: string[] = [];
    try {
        entries = await fs.readdir(drizzleDir);
    } catch (error) {
        console.error(
            "[autoheal] unable to read drizzle directory:",
            error instanceof Error ? error.message : error
        );
        return;
    }

    const sqlFiles = entries.filter((entry) => entry.endsWith(".sql"));
    if (sqlFiles.length === 0) {
        console.info("[autoheal] no drizzle SQL files detected, nothing to sanitize");
        return;
    }

    for (const fileName of sqlFiles.sort()) {
        const filePath = path.join(drizzleDir, fileName);
        try {
            await sanitizeFile(filePath, fileName);
        } catch (error) {
            console.error(
                `[autoheal] failed to sanitize ${fileName}:`,
                error instanceof Error ? error.message : error
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
            error instanceof Error ? error.message : error
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

    const dropResult = normalizeDropIndexStatements(content);
    content = dropResult.content;
    if (dropResult.updated > 0) {
        changeSummary.push({
            description: "normalized DROP INDEX statements",
            count: dropResult.updated,
        });
    }

    const createResult = normalizeCreateIndexStatements(content);
    content = createResult.content;
    if (createResult.updated > 0) {
        changeSummary.push({
            description: "normalized CREATE INDEX statements",
            count: createResult.updated,
        });
    }

    const quoteResult = quoteTimeIdentifiers(content);
    content = quoteResult.content;
    if (quoteResult.updated > 0) {
        changeSummary.push({
            description: "quoted \"time\" column references",
            count: quoteResult.updated,
        });
    }

    if (content !== original) {
        try {
            await fs.writeFile(filePath, ensureTrailingNewline(content), "utf8");
        } catch (error) {
            console.error(
                `[autoheal] unable to write ${fileName}:`,
                error instanceof Error ? error.message : error
            );
            return;
        }
    }

    const total = changeSummary.reduce((sum, change) => sum + change.count, 0);
    if (total > 0) {
        const details = changeSummary
            .map((change) => `${change.description} (${change.count})`)
            .join(", ");
        console.info(`[autoheal] ${fileName}: ${details} -> total ${total} adjustment(s)`);
    } else {
        console.info(`[autoheal] ${fileName}: no changes required`);
    }
}

function removeStatementBreakpoints(content: string): { content: string; removed: number } {
    const lines = content.split(/\r?\n/);
    const filtered = lines.filter((line) => !line.trim().startsWith("-->") || !line.includes("statement-breakpoint"));
    const removed = lines.length - filtered.length;
    return {
        content: filtered.join("\n"),
        removed,
    };
}

function normalizeDropIndexStatements(content: string): { content: string; updated: number } {
    let updated = 0;
    const dropRegex = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_\."]+)\s*;/gi;
    const newContent = content.replace(dropRegex, (match, identifier) => {
        const normalizedIdentifier = identifier.replace(/"/g, "");
        const indexName = normalizedIdentifier.split(".").pop() ?? normalizedIdentifier;
        const replacement = `DROP INDEX IF EXISTS public.${indexName};`;
        if (normalizeWhitespace(match) === normalizeWhitespace(replacement)) {
            return match;
        }
        updated += 1;
        return replacement;
    });
    return { content: newContent, updated };
}

function normalizeCreateIndexStatements(content: string): { content: string; updated: number } {
    let updated = 0;
    const createRegex = /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_\"]+)\s+ON\s+([A-Za-z0-9_\.\"]+)\s*\(([\s\S]*?)\);/gi;
    const newContent = content.replace(createRegex, (match, rawIndexName, rawTableName, columns) => {
        const indexName = rawIndexName.replace(/"/g, "");
        const tableNameParts = rawTableName.replace(/"/g, "").split(".");
        const tableName = tableNameParts.pop() ?? rawTableName.replace(/"/g, "");
        const columnList = columns.trim().replace(/\s+/g, " ");
        const replacement = `CREATE INDEX IF NOT EXISTS public.${indexName} ON public.${tableName}(${columnList});`;
        if (normalizeWhitespace(match) === normalizeWhitespace(replacement)) {
            return match;
        }
        updated += 1;
        return replacement;
    });
    return { content: newContent, updated };
}

function quoteTimeIdentifiers(content: string): { content: string; updated: number } {
    let updated = 0;
    const columnRegex = /(\(|,)\s*"?time"?(\s*(?:ASC|DESC|asc|desc)?)?/g;
    let newContent = content.replace(columnRegex, (match, prefix: string, order = "") => {
        const replacement = `${prefix} "time"${order ?? ""}`;
        if (match === replacement) {
            return match;
        }
        updated += 1;
        return replacement;
    });

    const orderRegex = /(ORDER\s+BY)\s+"?time"?(\s+(?:ASC|DESC|asc|desc))?/g;
    newContent = newContent.replace(orderRegex, (match, clause: string, direction = "") => {
        const replacement = `${clause} "time"${direction ?? ""}`;
        if (match === replacement) {
            return match;
        }
        updated += 1;
        return replacement;
    });

    return { content: newContent, updated };
}

function ensureTrailingNewline(content: string): string {
    return content.endsWith("\n") ? content : `${content}\n`;
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

void main().catch((error) => {
    console.error("[autoheal] unexpected failure", error);
});
