const FALLBACK_TYPE = "GENERIC";
const NORMALISED_MATCHES: Array<{ match: string; type: string }> = [
  { match: "RSI", type: "RSI" },
  { match: "EMA", type: "EMA" },
  { match: "FVG", type: "FVG" },
];

function normalise(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

export function resolveIndicatorType(name: string, requestedType?: string | null): string {
  const explicit = normalise(requestedType ?? "");
  if (explicit) {
    return explicit;
  }

  const normalisedName = normalise(name);
  for (const candidate of NORMALISED_MATCHES) {
    if (normalisedName.includes(candidate.match)) {
      return candidate.type;
    }
  }

  return FALLBACK_TYPE;
}
