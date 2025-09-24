import { QueryClient, QueryFunction, QueryFunctionContext, QueryKey } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function buildUrlFromQueryKey(queryKey: QueryKey): string {
  let path = "";
  const params = new URLSearchParams();

  for (const part of queryKey) {
    if (part == null) continue;

    if (typeof part === "string" || typeof part === "number") {
      const segment = String(part);
      if (!segment) continue;

      if (segment.startsWith("/")) {
        if (!path) {
          path = segment;
        } else {
          path = `${path.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
        }
      } else {
        path = path
          ? `${path.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`
          : `/${segment}`;
      }
    } else if (typeof part === "object" && !Array.isArray(part)) {
      for (const [key, value] of Object.entries(part)) {
        if (value == null || value === "") continue;
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item != null) {
              params.append(key, String(item));
            }
          });
        } else {
          params.set(key, String(value));
        }
      }
    }
  }

  if (!path) {
    throw new Error("Query key must include a path string");
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

type UnauthorizedReturnNull = {
  on401: "returnNull";
};

type UnauthorizedThrow = {
  on401: "throw";
};

type GetQueryFnOptions = UnauthorizedReturnNull | UnauthorizedThrow;

export function getQueryFn<T>(options: UnauthorizedThrow): QueryFunction<T>;
export function getQueryFn<T>(options: UnauthorizedReturnNull): QueryFunction<T | null>;
export function getQueryFn<T>({ on401 }: GetQueryFnOptions): QueryFunction<T | null> | QueryFunction<T> {
  const makeRequest = async (
    { queryKey }: QueryFunctionContext<QueryKey>,
  ): Promise<T | null> => {
    const url = buildUrlFromQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (on401 === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data: T = await res.json();
    return data;
  };

  if (on401 === "returnNull") {
    return makeRequest;
  }

  const queryFn: QueryFunction<T> = async (context) => {
    const result = await makeRequest(context);
    if (result == null) {
      throw new Error("Expected response body but received null");
    }
    return result;
  };

  return queryFn;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
