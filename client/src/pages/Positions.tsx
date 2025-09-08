import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Edit } from "lucide-react";
import { usePositions } from "@/hooks/useTradingData";
import { PriceUpdate } from "@/types/trading";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PositionsProps {
  priceData: Map<string, PriceUpdate>;
}

export default function Positions({ priceData }: PositionsProps) {
  const { data: positions, isLoading } = usePositions();
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

  const handleClosePosition = (positionId: string) => {
    if (window.confirm('Are you sure you want to close this position?')) {
      closePositionMutation.mutate(positionId);
    }
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

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="positions-title">Open Positions</h2>
          <p className="text-muted-foreground">
            {positions?.length || 0} active position{positions?.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {!positions || positions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                📊
              </div>
              <h3 className="text-lg font-medium mb-2">No Open Positions</h3>
              <p className="text-sm">Start trading by opening a position from the Dashboard or Analysis tabs.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {positions.map((position) => {
            const priceInfo = priceData.get(position.symbol);
            const currentPrice = priceInfo?.price;
            const pnl = calculatePnL(position, currentPrice);
            const pnlColor = pnl >= 0 ? 'text-green-500' : 'text-red-500';

            return (
              <Card key={position.id} className="relative">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-sm font-bold text-white">
                          {position.symbol.replace('USDT', '')}
                        </div>
                        <div>
                          <div className="font-medium text-lg" data-testid={`position-symbol-${position.id}`}>
                            {position.symbol}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Size: {position.size} • Entry: ${position.entryPrice}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-6">
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">Side</div>
                        <Badge 
                          variant={position.side === 'LONG' ? 'default' : 'destructive'}
                          className={position.side === 'LONG' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}
                          data-testid={`position-side-${position.id}`}
                        >
                          {position.side}
                        </Badge>
                      </div>

                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">Current Price</div>
                        <div className="font-mono font-medium" data-testid={`position-price-${position.id}`}>
                          ${currentPrice || position.currentPrice || position.entryPrice}
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">P&L</div>
                        <div className={`font-mono font-bold ${pnlColor}`} data-testid={`position-pnl-${position.id}`}>
                          {formatPnL(pnl)}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-edit-${position.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleClosePosition(position.id)}
                          disabled={closePositionMutation.isPending}
                          data-testid={`button-close-${position.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {(position.stopLoss || position.takeProfit) && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="flex items-center space-x-6 text-sm">
                        {position.stopLoss && (
                          <div>
                            <span className="text-muted-foreground">Stop Loss: </span>
                            <span className="font-mono">${position.stopLoss}</span>
                          </div>
                        )}
                        {position.takeProfit && (
                          <div>
                            <span className="text-muted-foreground">Take Profit: </span>
                            <span className="font-mono">${position.takeProfit}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
