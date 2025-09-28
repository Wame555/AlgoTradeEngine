export function toNumLocale(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/\u00A0/g, " ").replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".");
  if (!/^[+-]?\d*(?:\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
export function roundToStep(v: number, step = 1e-8): number {
  const inv = 1 / step;
  return Math.floor(v * inv + 1e-9) / inv;
}
