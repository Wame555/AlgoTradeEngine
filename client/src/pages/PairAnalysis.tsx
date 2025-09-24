import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PriceUpdate, SUPPORTED_TIMEFRAMES, TradingPair } from "@/types/trading";
import { usePairTimeframes, useTradingPairs } from "@/hooks/useTradingData";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/useSession";

interface PairAnalysisProps {
  priceData: Map<string, PriceUpdate>;
}

export default function PairAnalysis({ priceData }: PairAnalysisProps) {
  const { data: pairTimeframes } = usePairTimeframes();
  const { data: tradingPairs } = useTradingPairs();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;

  const [selectedPair, setSelectedPair] = useState<string>('');
  const [selectedTimeframes, setSelectedTimeframes] = useState<Record<string, boolean>>({});

  const sortedPairs = useMemo<TradingPair[]>(() => {
    if (!tradingPairs) return [];
    return [...tradingPairs].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [tradingPairs]);

  useEffect(() => {
    if (selectedPair || sortedPairs.length === 0) return;
    setSelectedPair(sortedPairs[0].symbol);
  }, [sortedPairs, selectedPair]);

  useEffect(() => {
    if (!selectedPair) return;
    const entry = pairTimeframes?.find((pt) => pt.symbol === selectedPair);
    const enabledSet = new Set<string>(Array.isArray(entry?.timeframes) ? entry.timeframes : []);
    const nextState: Record<string, boolean> = {};
    SUPPORTED_TIMEFRAMES.forEach((tf) => {
      nextState[tf] = enabledSet.has(tf);
    });
    setSelectedTimeframes(nextState);
  }, [pairTimeframes, selectedPair]);

  const saveTimeframesMutation = useMutation({
    mutationFn: async (data: { symbol: string; timeframes: string[] }) => {
      if (!userId) {
        throw new Error('Missing user context');
      }
      await apiRequest('POST', '/api/pair-timeframes', {
        userId,
        symbol: data.symbol,
        timeframes: data.timeframes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Timeframe settings saved successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ['/api/pair-timeframes', userId] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save timeframe settings",
        variant: "destructive",
      });
    },
  });

  const handleTimeframeChange = (timeframe: string, checked: boolean) => {
    setSelectedTimeframes((prev) => ({
      ...prev,
      [timeframe]: checked,
    }));
  };

  const handleSaveTimeframes = () => {
    if (!selectedPair) return;
    const enabledTimeframes = Object.entries(selectedTimeframes)
      .filter(([_, enabled]) => enabled)
      .map(([tf]) => tf);

    saveTimeframesMutation.mutate({
      symbol: selectedPair,
      timeframes: enabledTimeframes,
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

  const activeTimeframesCount = Object.values(selectedTimeframes).filter(Boolean).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="pair-analysis-title">Pair Analysis</h2>
          <p className="text-muted-foreground">
            Configure analysis timeframes for each trading pair
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pair Selection */}
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

        {/* Timeframe Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Active Timeframes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select timeframes to analyze for {selectedPair}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {SUPPORTED_TIMEFRAMES.map((timeframe) => (
              <div key={timeframe} className="flex items-center space-x-3">
                <Checkbox
                  id={`timeframe-${timeframe}`}
                  checked={selectedTimeframes[timeframe] || false}
                  onCheckedChange={(checked) =>
                    handleTimeframeChange(timeframe, Boolean(checked))
                  }
                  data-testid={`checkbox-${timeframe}`}
                />
                <label
                  htmlFor={`timeframe-${timeframe}`}
                  className="flex-1 cursor-pointer text-sm font-medium"
                >
                  {timeframe}
                </label>
                <Badge variant="outline" className="text-xs">
                  {timeframe === '1m' ? 'Fast'
                   : timeframe === '1h' ? 'Medium'
                   : timeframe === '1d' ? 'Slow' : 'Custom'}
                </Badge>
              </div>
            ))}

            <Button
              onClick={handleSaveTimeframes}
              disabled={saveTimeframesMutation.isPending || !userId}
              className="mt-4 w-full"
              data-testid="button-save-timeframes"
            >
              {saveTimeframesMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          </CardContent>
        </Card>

        {/* Analysis Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Analysis Summary</CardTitle>
            <p className="text-sm text-muted-foreground">
              Current analysis status for {selectedPair}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Active Timeframes</span>
                <span className="text-sm font-medium" data-testid="active-timeframes-count">
                  {activeTimeframesCount} of {SUPPORTED_TIMEFRAMES.length}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Data Streams</span>
                <span className="text-sm font-medium">
                  {activeTimeframesCount} active
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Last Update</span>
                <span className="text-sm font-medium">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="text-sm text-muted-foreground mb-2">Quick Actions</div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    const allEnabled = SUPPORTED_TIMEFRAMES.reduce((acc, tf) => {
                      acc[tf] = true;
                      return acc;
                    }, {} as Record<string, boolean>);
                    setSelectedTimeframes(allEnabled);
                  }}
                  data-testid="button-enable-all"
                >
                  Enable All Timeframes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    const defaults = { '1h': true, '4h': true, '1d': true };
                    setSelectedTimeframes(defaults);
                  }}
                  data-testid="button-reset-default"
                >
                  Reset to Defaults
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analysis Chart Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Price Analysis - {selectedPair}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-96 items-center justify-center rounded-lg bg-muted/20" data-testid="analysis-chart">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl">
                📈
              </div>
              <h3 className="mb-2 text-lg font-medium">Multi-Timeframe Analysis</h3>
              <p className="text-sm text-muted-foreground">
                Detailed price analysis across selected timeframes will be displayed here
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
