import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Filter, Plus, X } from "lucide-react";
import { PriceUpdate, SUPPORTED_PAIRS } from "@/types/trading";
import { usePositions, useSignals } from "@/hooks/useTradingData";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PairsOverviewProps {
  priceData: Map<string, PriceUpdate>;
}

const MOCK_USER_ID = 'mock-user-123';

export function PairsOverview({ priceData }: PairsOverviewProps) {
  const { data: positions } = usePositions();
  const { data: signals } = useSignals(100);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      await apiRequest('DELETE', `/api/positions/${positionId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position closed successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close position",
        variant: "destructive",
      });
    },
  });

  const createPositionMutation = useMutation({
    mutationFn: async (data: { symbol: string; side: 'LONG' | 'SHORT' }) => {
      await apiRequest('POST', '/api/positions', {
        userId: MOCK_USER_ID,
        symbol: data.symbol,
        side: data.side,
        size: '0.01',
        entryPrice: '0',
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position opened successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open position",
        variant: "destructive",
      });
    },
  });

  const getPositionForSymbol = (symbol: string) => {
    return positions?.find(pos => pos.symbol === symbol);
  };

  const getLatestSignalForSymbol = (symbol: string) => {
    return signals
      ?.filter(signal => signal.symbol === symbol)
      ?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  };

  const getPriceChangeColor = (change: number) => {
    if (change > 0) return 'text-green-500';
    if (change < 0) return 'text-red-500';
    return 'text-muted-foreground';
  };

  const getSignalBadge = (signal?: { signal: string; confidence: number }) => {
    if (!signal) {
      return <Badge variant="outline" className="text-xs">No Signal</Badge>;
    }

    const { signal: signalType, confidence } = signal;
    const colorClass = signalType === 'LONG' 
      ? 'bg-green-500/10 text-green-500' 
      : signalType === 'SHORT'
      ? 'bg-red-500/10 text-red-500'
      : 'bg-gray-500/10 text-gray-500';

    return (
      <Badge className={`${colorClass} text-xs`}>
        {signalType} {confidence.toFixed(0)}%
      </Badge>
    );
  };

  const calculatePnL = (position: any, currentPrice?: string) => {
    if (!currentPrice) return parseFloat(position.pnl || '0');
    
    const entryPrice = parseFloat(position.entryPrice);
    const price = parseFloat(currentPrice);
    const size = parseFloat(position.size);
    
    if (position.side === 'LONG') {
      return (price - entryPrice) * size;
    } else {
      return (entryPrice - price) * size;
    }
  };

  const formatPnL = (pnl: number) => {
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)}`;
  };

  const getCoinIcon = (symbol: string) => {
    const coin = symbol.replace('USDT', '');
    const colors: { [key: string]: string } = {
      'BTC': 'from-yellow-400 to-orange-500',
      'ETH': 'from-blue-400 to-purple-500',
      'SOL': 'from-purple-400 to-pink-500',
      'ADA': 'from-red-400 to-pink-500',
      'AVAX': 'from-green-400 to-blue-500',
      'DOT': 'from-pink-400 to-purple-500',
      'ENJ': 'from-indigo-400 to-purple-500',
      'GALA': 'from-green-500 to-teal-500',
      'EGLD': 'from-yellow-500 to-orange-500',
      'SNX': 'from-blue-500 to-cyan-500',
      'MANA': 'from-red-500 to-pink-500',
      'ARPA': 'from-gray-400 to-gray-600',
      'SEI': 'from-purple-500 to-pink-500',
      'ACH': 'from-blue-400 to-blue-600',
      'ATOM': 'from-indigo-500 to-purple-500',
    };

    return (
      <div className={`w-8 h-8 bg-gradient-to-br ${colors[coin] || 'from-gray-400 to-gray-600'} rounded-full flex items-center justify-center text-xs font-bold text-white`}>
        {coin.substring(0, 3)}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active Pairs</CardTitle>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" data-testid="button-filter">
              <Filter className="w-4 h-4 mr-1" />
              Filter
            </Button>
            <Button variant="outline" size="sm" data-testid="button-refresh">
              <RefreshCw className="w-4 h-4 mr-1" />
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
                <th className="text-center">Signal</th>
                <th className="text-center">Confidence</th>
                <th className="text-center">Position</th>
                <th className="text-right">P&L</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_PAIRS.map((symbol) => {
                const priceInfo = priceData.get(symbol);
                const position = getPositionForSymbol(symbol);
                const signal = getLatestSignalForSymbol(symbol);
                const change24h = priceInfo ? parseFloat(priceInfo.change24h) : 0;
                const pnl = position ? calculatePnL(position, priceInfo?.price) : 0;

                return (
                  <tr key={symbol} data-testid={`pair-row-${symbol}`}>
                    <td>
                      <div className="flex items-center space-x-2">
                        {getCoinIcon(symbol)}
                        <span className="font-medium">{symbol}</span>
                      </div>
                    </td>
                    
                    <td className="text-right font-mono" data-testid={`price-${symbol}`}>
                      ${priceInfo ? parseFloat(priceInfo.price).toFixed(8) : 'Loading...'}
                    </td>
                    
                    <td className={`text-right font-mono ${getPriceChangeColor(change24h)}`} data-testid={`change-${symbol}`}>
                      {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                    </td>
                    
                    <td className="text-center" data-testid={`signal-${symbol}`}>
                      {getSignalBadge(signal)}
                    </td>
                    
                    <td className="text-center">
                      {signal ? (
                        <div className="flex items-center justify-center">
                          <Progress value={signal.confidence} className="w-12 h-2" />
                          <span className="ml-2 text-xs font-mono">{signal.confidence.toFixed(0)}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    
                    <td className="text-center" data-testid={`position-${symbol}`}>
                      {position ? (
                        <Badge 
                          className={position.side === 'LONG' 
                            ? 'bg-green-500/10 text-green-500' 
                            : 'bg-red-500/10 text-red-500'
                          }
                        >
                          {position.side}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">-</Badge>
                      )}
                    </td>
                    
                    <td className={`text-right font-mono ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid={`pnl-${symbol}`}>
                      {position ? formatPnL(pnl) : '$0.00'}
                    </td>
                    
                    <td className="text-center">
                      {position ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => closePositionMutation.mutate(position.id)}
                          disabled={closePositionMutation.isPending}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`button-close-${symbol}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => createPositionMutation.mutate({
                            symbol,
                            side: signal?.signal === 'SHORT' ? 'SHORT' : 'LONG'
                          })}
                          disabled={createPositionMutation.isPending}
                          className="text-primary hover:text-primary/80"
                          data-testid={`button-open-${symbol}`}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
