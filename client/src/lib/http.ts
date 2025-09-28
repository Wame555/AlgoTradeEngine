// client/src/lib/http.ts
import { getApiBase } from "./apiBase";

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  console.log(`[http] ${method} ${url}`, body ?? null);
  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  console.log(`[http] ${resp.status} ${url}`, data);
  if (!resp.ok) {
    throw Object.assign(new Error((data as any)?.message ?? "HTTP error"), { status: resp.status, data });
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
};
