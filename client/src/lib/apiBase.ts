// client/src/lib/apiBase.ts
export function getApiBase(): string {
  const fromVite = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined;
  const fromCRA = typeof process !== "undefined"
    ? ((process as any)?.env?.REACT_APP_API_BASE_URL as string | undefined)
    : undefined;
  const base = (fromVite ?? fromCRA ?? "/api").trim();
  return base.endsWith("/") ? base.slice(0, -1) : base;
}
