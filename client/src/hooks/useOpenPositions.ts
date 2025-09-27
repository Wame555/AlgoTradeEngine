import { useQuery } from "@tanstack/react-query";
import type { Position } from "@/types/trading";
import { useUserId } from "@/hooks/useSession";

export function useOpenPositions() {
  const userId = useUserId();

  return useQuery<Position[]>({
    queryKey: ["/api/positions/open", { userId }],
    enabled: Boolean(userId),
    staleTime: 5000,
    refetchInterval: 5000,
    select: (data) =>
      (Array.isArray(data) ? data : []).map((position) => ({
        ...position,
        qty: position?.qty ?? "0",
        sizeUsd: position?.sizeUsd ?? "0",
        amountUsd: position?.amountUsd ?? position?.sizeUsd ?? "0",
        pnlUsd: position?.pnlUsd ?? "0",
      })),
  });
}
