import { SYMBOL_LIST } from "../../src/config/env";

function normalizeSymbol(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function getConfiguredSymbols(): string[] {
  const seen = new Set<string>();
  for (const raw of SYMBOL_LIST) {
    const normalized = typeof raw === "string" ? normalizeSymbol(raw) : null;
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
    }
  }
  return Array.from(seen);
}

export const CONFIGURED_SYMBOLS: readonly string[] = getConfiguredSymbols();
export const CONFIGURED_SYMBOL_SET: ReadonlySet<string> = new Set(CONFIGURED_SYMBOLS);
