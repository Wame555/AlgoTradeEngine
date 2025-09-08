import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { useSignals } from "@/hooks/useTradingData";
import { formatDistanceToNow } from 'date-fns';

export default function Signals() {
  const { data: signals, isLoading, refetch, isRefetching } = useSignals(100);

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case 'LONG':
        return <TrendingUp className="w-4 h-4" />;
      case 'SHORT':
        return <TrendingDown className="w-4 h-4" />;
      default:
        return <Minus className="w-4 h-4" />;
    }
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'LONG':
        return 'bg-green-500/10 text-green-500';
      case 'SHORT':
        return 'bg-red-500/10 text-red-500';
      default:
        return 'bg-gray-500/10 text-gray-500';
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="signals-title">Trading Signals</h2>
          <p className="text-muted-foreground">
            Latest trading signals from all active indicators
          </p>
        </div>
        <Button 
          onClick={() => refetch()} 
          disabled={isRefetching}
          variant="outline"
          data-testid="button-refresh-signals"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {!signals || signals.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-muted-foreground">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                📡
              </div>
              <h3 className="text-lg font-medium mb-2">No Signals Available</h3>
              <p className="text-sm">Signals will appear here once the analysis modules are running.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {signals.map((signal) => (
            <Card key={signal.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-sm font-bold text-white">
                        {signal.symbol.replace('USDT', '')}
                      </div>
                      <div>
                        <div className="font-medium text-lg" data-testid={`signal-symbol-${signal.id}`}>
                          {signal.symbol}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {signal.timeframe} • Price: ${parseFloat(signal.price).toFixed(8)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6">
                    <div className="text-center">
                      <div className="text-sm text-muted-foreground mb-1">Signal</div>
                      <Badge 
                        className={`${getSignalColor(signal.signal)} flex items-center space-x-1`}
                        data-testid={`signal-type-${signal.id}`}
                      >
                        {getSignalIcon(signal.signal)}
                        <span>{signal.signal}</span>
                      </Badge>
                    </div>

                    <div className="text-center min-w-[120px]">
                      <div className="text-sm text-muted-foreground mb-1">Confidence</div>
                      <div className="flex items-center space-x-2">
                        <Progress value={signal.confidence} className="w-16 h-2" />
                        <span className="text-sm font-mono" data-testid={`signal-confidence-${signal.id}`}>
                          {signal.confidence.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="text-sm text-muted-foreground mb-1">Age</div>
                      <div className="text-sm" data-testid={`signal-age-${signal.id}`}>
                        {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Indicator details */}
                {signal.indicators && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-sm text-muted-foreground mb-2">Contributing Indicators:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(signal.indicators).map(([name, data]: [string, any]) => (
                        <Badge key={name} variant="outline" className="text-xs">
                          {name}: {data.confidence ? `${data.confidence.toFixed(0)}%` : 'N/A'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
