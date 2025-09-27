import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Filter, Plus, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { usePositions, useSignals, useTradingPairs, usePairTimeframes, useMarket24hChange } from "@/hooks/useTradingData";
import { useSession } from "@/hooks/useSession";
import { useChangeStats } from "@/hooks/useChangeStats";
import { TIMEFRAMES } from "@/constants/timeframes";
import { formatPct, formatUsd, trendClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Position,
  PriceUpdate,
  TradingPair,
  Signal,
  Timeframe,
} from "@/types/trading";

interface PairsOverviewProps {
  priceData: Map<string, PriceUpdate>;
}

interface PairRowProps {
  pair: TradingPair;
  priceInfo?: PriceUpdate;
  position?: Position;
  signal?: Signal;
  dailyChangePct?: number | null;
  onOpenPosition: (symbol: string, side: "LONG" | "SHORT") => void;
  onClosePosition: (positionId: string) => void;
  canOpenPosition: boolean;
  isOpenPending: boolean;
  isClosePending: boolean;
}

function getCoinIcon(symbol: string) {
  const coin = symbol.replace("USDT", "");
  const colors: Record<string, string> = {
    BTC: "from-yellow-400 to-orange-500",
    ETH: "from-blue-400 to-purple-500",
    SOL: "from-purple-400 to-pink-500",
    ADA: "from-red-400 to-pink-500",
    AVAX: "from-green-400 to-blue-500",
    DOT: "from-pink-400 to-purple-500",
    ENJ: "from-indigo-400 to-purple-500",
    GALA: "from-green-500 to-teal-500",
    EGLD: "from-yellow-500 to-orange-500",
    SNX: "from-blue-500 to-cyan-500",
    MANA: "from-red-500 to-pink-500",
    ARPA: "from-gray-400 to-gray-600",
    SEI: "from-purple-500 to-pink-500",
    ACH: "from-blue-400 to-blue-600",
    ATOM: "from-indigo-500 to-purple-500",
  };

  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${colors[coin] || "from-gray-400 to-gray-600"} text-xs font-bold text-white`}
    >
      {coin.substring(0, 3)}
    </div>
  );
}

function getSignalBadge(signal?: { signal: string; confidence: number }) {
  if (!signal) {
    return (
      <Badge variant="outline" className="text-xs">
        No Signal
      </Badge>
    );
  }

  const { signal: signalType, confidence } = signal;
  const colorClass = signalType === "LONG"
    ? "bg-green-500/10 text-green-500"
    : signalType === "SHORT"
    ? "bg-red-500/10 text-red-500"
    : "bg-gray-500/10 text-gray-500";

  return (
    <Badge className={`${colorClass} text-xs`}>
      {signalType} {confidence.toFixed(0)}%
    </Badge>
  );
}

function PairRow({
  pair,
  priceInfo,
  position,
  signal,
  dailyChangePct,
  onOpenPosition,
  onClosePosition,
  canOpenPosition,
  isOpenPending,
  isClosePending,
}: PairRowProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>("1m");
  const { data: availableTimeframes } = usePairTimeframes(pair.symbol);
  const allowedTimeframes = useMemo(() => {
    if (!availableTimeframes || availableTimeframes.length === 0) {
      return new Set<Timeframe>();
    }
    return new Set(
      availableTimeframes.filter((tf): tf is Timeframe => (TIMEFRAMES as readonly string[]).includes(tf)),
    );
  }, [availableTimeframes]);
  const { data: changeStats, isLoading } = useChangeStats(pair.symbol, selectedTimeframe);

  useEffect(() => {
    if (allowedTimeframes.size === 0) {
      return;
    }
    if (!allowedTimeframes.has(selectedTimeframe)) {
      const fallback = (TIMEFRAMES as readonly Timeframe[]).find((tf) => allowedTimeframes.has(tf));
      if (fallback && fallback !== selectedTimeframe) {
        setSelectedTimeframe(fallback);
      }
    }
  }, [allowedTimeframes, selectedTimeframe]);

  const handleTimeframeChange = (value: string) => {
    if ((TIMEFRAMES as readonly string[]).includes(value)) {
      setSelectedTimeframe(value as Timeframe);
    }
  };

  const changePct = changeStats?.changePct ?? 0;
  const pnlValue = position ? changeStats?.pnlUsdForOpenPositionsBySymbol ?? 0 : 0;
  const changeClass = trendClass(changePct);
  const pnlClass = trendClass(pnlValue);
  const hasPosition = Boolean(position);
  const price = priceInfo ? `$${parseFloat(priceInfo.price).toFixed(8)}` : "…";
  const dailyChange = dailyChangePct != null && Number.isFinite(dailyChangePct) ? dailyChangePct : null;
  const dailyChangeClass = dailyChange != null ? trendClass(dailyChange) : "text-muted-foreground";

  return (
    <tr key={pair.symbol} data-testid={`pair-row-${pair.symbol}`}>
      <td>
        <div className="flex items-center space-x-2">
          {getCoinIcon(pair.symbol)}
          <span className="font-medium">{pair.symbol}</span>
        </div>
      </td>

      <td className="text-right font-mono" data-testid={`price-${pair.symbol}`}>
        {price}
      </td>

      <td className={cn("text-right font-mono", dailyChangeClass)} data-testid={`change-${pair.symbol}`}>
        {dailyChange != null
          ? `${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}%`
          : "—"}
      </td>

      <td className="text-right align-top">
        <div className="flex flex-col items-end gap-1">
          <Select value={selectedTimeframe} onValueChange={handleTimeframeChange}>
            <SelectTrigger className="h-8 w-[88px] text-xs">
              <SelectValue placeholder="TF" />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((tf) => {
                const disabled = allowedTimeframes.size > 0 && !allowedTimeframes.has(tf);
                const item = (
                  <SelectItem
                    key={tf}
                    value={tf}
                    disabled={disabled}
                    className={cn(
                      "text-xs",
                      disabled &&
                        "text-muted-foreground pointer-events-auto data-[disabled]:pointer-events-auto",
                    )}
                  >
                    {tf}
                  </SelectItem>
                );

                if (!disabled) {
                  return item;
                }

                return (
                  <Tooltip key={tf}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent>No data yet for this timeframe</TooltipContent>
                  </Tooltip>
                );
              })}
            </SelectContent>
          </Select>

          <span className={cn("font-mono text-sm", changeClass)}>
            {isLoading ? "…" : formatPct(changePct)}
          </span>

          {hasPosition ? (
            <span className={cn("font-mono text-sm", pnlClass)}>
              {isLoading ? "…" : `${formatUsd(pnlValue)} $`}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No position</span>
          )}
        </div>
      </td>

      <td className="text-center" data-testid={`signal-${pair.symbol}`}>
        {getSignalBadge(signal)}
      </td>

      <td className="text-center">
        {signal ? (
          <div className="flex items-center justify-center">
            <Progress value={signal.confidence} className="h-2 w-12" />
            <span className="ml-2 text-xs font-mono">{signal.confidence.toFixed(0)}%</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>

      <td className="text-center" data-testid={`position-${pair.symbol}`}>
        {position ? (
          <Badge
            className={
              position.side === "LONG"
                ? "bg-green-500/10 text-green-500"
                : "bg-red-500/10 text-red-500"
            }
          >
            {position.side}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">
            -
          </Badge>
        )}
      </td>

      <td className="text-center">
        {position ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => position && onClosePosition(position.id)}
            disabled={isClosePending}
            className="text-red-500 hover:text-red-700"
            data-testid={`button-close-${pair.symbol}`}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenPosition(pair.symbol, signal?.signal === "SHORT" ? "SHORT" : "LONG")}
            disabled={isOpenPending || !canOpenPosition}
            className="text-primary hover:text-primary/80"
            data-testid={`button-open-${pair.symbol}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}

export function PairsOverview({ priceData }: PairsOverviewProps) {
  const { data: positions } = usePositions();
  const { data: signals } = useSignals(100);
  const { data: tradingPairs } = useTradingPairs();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.userId;

  const sortedPairs = useMemo<TradingPair[]>(() => {
    if (!tradingPairs) return [];
    return [...tradingPairs].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [tradingPairs]);

  const symbolList = useMemo(() => sortedPairs.map((pair) => pair.symbol), [sortedPairs]);
  const { data: dailyChangeMap } = useMarket24hChange(symbolList);

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      await apiRequest("POST", `/api/trades/close`, { positionId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position closed successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/positions/open"] });
        queryClient.invalidateQueries({ queryKey: ["/api/positions/closed"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close position",
        variant: "destructive",
      });
    },
  });

  const createPositionMutation = useMutation({
    mutationFn: async (data: { symbol: string; side: "LONG" | "SHORT" }) => {
      if (!userId) {
        throw new Error("Missing user context");
      }
      await apiRequest("POST", "/api/positions", {
        userId,
        symbol: data.symbol,
        side: data.side,
        size: "0.01",
        entryPrice: "0",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position opened successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/positions/open"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open position",
        variant: "destructive",
      });
    },
  });

  const getPositionForSymbol = (symbol: string) => {
    return positions?.find((pos) => pos.symbol === symbol);
  };

  const getLatestSignalForSymbol = (symbol: string) => {
    if (!signals) return undefined;
    return signals
      .filter((signal) => signal.symbol === symbol)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  };

  if (sortedPairs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Pairs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Trading pairs have not been initialised yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Pairs</CardTitle>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" data-testid="button-filter">
                <Filter className="mr-1 h-4 w-4" />
                Filter
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="button-refresh"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/market-data"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/market/24h"] });
                }}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr>
                  <th className="text-left">Pair</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">24h %</th>
                  <th className="text-right">TF Δ% / P&amp;L</th>
                  <th className="text-center">Signal</th>
                  <th className="text-center">Confidence</th>
                  <th className="text-center">Position</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedPairs.map((pair) => {
                  const symbol = pair.symbol;
                  const priceInfo = priceData.get(symbol);
                  const position = getPositionForSymbol(symbol);
                  const signal = getLatestSignalForSymbol(symbol);
                  return (
                    <PairRow
                      key={symbol}
                      pair={pair}
                      priceInfo={priceInfo}
                      position={position}
                      signal={signal}
                      dailyChangePct={dailyChangeMap?.get(symbol)?.changePct ?? null}
                      onOpenPosition={(sym, side) => createPositionMutation.mutate({ symbol: sym, side })}
                      onClosePosition={(positionId) => closePositionMutation.mutate(positionId)}
                      canOpenPosition={Boolean(userId)}
                      isOpenPending={createPositionMutation.isPending}
                      isClosePending={closePositionMutation.isPending}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
