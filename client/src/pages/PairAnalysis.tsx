import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PriceUpdate, SUPPORTED_TIMEFRAMES, TradingPair } from "@/types/trading";
import { usePairTimeframes, useTradingPairs } from "@/hooks/useTradingData";
import { useChangeStats } from "@/hooks/useChangeStats";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PairAnalysisProps {
  priceData: Map<string, PriceUpdate>;
}

export default function PairAnalysis({ priceData }: PairAnalysisProps) {
  const { data: tradingPairs } = useTradingPairs();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPair, setSelectedPair] = useState<string>('');
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);

  const { data: pairTimeframes = [] } = usePairTimeframes(selectedPair || undefined);
  const { data: selectedPairChangeStats } = useChangeStats(selectedPair || undefined, "1d");

  useEffect(() => {
    if (!selectedPair && tradingPairs && tradingPairs.length > 0) {
      setSelectedPair(tradingPairs[0].symbol);
    }
  }, [tradingPairs, selectedPair]);

  useEffect(() => {
    if (!selectedPair) return;
    if (!Array.isArray(pairTimeframes)) {
      setSelectedTimeframes([]);
      return;
    }
    const valid = pairTimeframes.filter((tf) => SUPPORTED_TIMEFRAMES.includes(tf as typeof SUPPORTED_TIMEFRAMES[number]));
    setSelectedTimeframes(valid);
  }, [pairTimeframes, selectedPair]);

  const sortedPairs = useMemo<TradingPair[]>(() => {
    if (!tradingPairs) return [];
    return [...tradingPairs].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [tradingPairs]);

  const saveTimeframesMutation = useMutation({
    mutationFn: async (data: { symbol: string; timeframes: string[] }) => {
      await apiRequest('PATCH', '/api/pairs/timeframes', {
        symbol: data.symbol,
        activeTimeframes: data.timeframes,
      });
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Success",
        description: "Timeframe settings saved successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pairs/timeframes', { symbol: variables.symbol }] });
    },
    onError: (error: any) => {
      const message = typeof error?.message === 'string' ? error.message : 'Failed to save timeframe settings';
      const statusMatch = message.match(/^\d{3}:\s*(.*)$/);
      toast({
        title: "Error",
        description: statusMatch ? statusMatch[1] : message,
        variant: "destructive",
      });
    },
  });

  const handleSaveTimeframes = () => {
    if (!selectedPair) return;
    saveTimeframesMutation.mutate({
      symbol: selectedPair,
      timeframes: selectedTimeframes,
    });
  };

  const getPriceInfo = (symbol: string) => {
    return priceData.get(symbol);
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-green-500';
    if (change < 0) return 'text-red-500';
    return 'text-muted-foreground';
  };

  if (sortedPairs.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Pair Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Trading pairs have not been initialised yet.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeTimeframesCount = selectedTimeframes.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="pair-analysis-title">Pair Analysis</h2>
          <p className="text-muted-foreground">
            Configure analysis timeframes for each trading pair
          </p>
        </div>
        <Badge variant="secondary">{activeTimeframesCount} active timeframes</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Select Pair</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedPairs.map((pair) => {
              const symbol = pair.symbol;
              const priceInfo = getPriceInfo(symbol);
              const change = priceInfo ? parseFloat(priceInfo.change24h ?? '0') : 0;

              return (
                <div
                  key={symbol}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                    selectedPair === symbol
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPair(symbol)}
                  data-testid={`pair-${symbol}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-xs font-bold text-white">
                        {symbol.replace('USDT', '')}
                      </div>
                      <div>
                        <div className="font-medium">{symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          {priceInfo ? `$${parseFloat(priceInfo.price).toFixed(8)}` : 'Loading...'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium ${getChangeColor(change)}`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                      </div>
                      <div className="text-xs text-muted-foreground">24h</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Timeframes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select timeframes to analyze for {selectedPair}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleGroup
              type="multiple"
              value={selectedTimeframes}
              onValueChange={(values) => setSelectedTimeframes(values as string[])}
              className="flex flex-wrap gap-2"
            >
              {SUPPORTED_TIMEFRAMES.map((timeframe) => (
                <ToggleGroupItem
                  key={timeframe}
                  value={timeframe}
                  className="rounded-full border px-3 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {timeframe}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button onClick={handleSaveTimeframes} disabled={saveTimeframesMutation.isPending}>
              {saveTimeframesMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pair Overview</CardTitle>
            <p className="text-sm text-muted-foreground">
              Recent market snapshot for {selectedPair}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const priceInfo = selectedPair ? getPriceInfo(selectedPair) : undefined;
              if (!priceInfo) {
                return <div className="text-sm text-muted-foreground">No market data available.</div>;
              }
              const change =
                selectedPairChangeStats && !selectedPairChangeStats.partialData
                  ? selectedPairChangeStats.changePct
                  : parseFloat(priceInfo.change24h ?? '0');
              return (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Last Price</div>
                    <div className="text-lg font-semibold">${parseFloat(priceInfo.price).toFixed(6)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">24h Change</div>
                    <div className={`text-sm font-medium ${getChangeColor(change)}`}>
                      {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
