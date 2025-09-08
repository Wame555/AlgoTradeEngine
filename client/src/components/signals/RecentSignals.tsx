import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, List } from "lucide-react";
import { useSignals } from "@/hooks/useTradingData";
import { formatDistanceToNow } from 'date-fns';

export function RecentSignals() {
  const { data: signals, isLoading } = useSignals(10); // Get last 10 signals

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case 'LONG':
        return <TrendingUp className="w-3 h-3" />;
      case 'SHORT':
        return <TrendingDown className="w-3 h-3" />;
      default:
        return <Minus className="w-3 h-3" />;
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
      <Card>
        <CardHeader>
          <CardTitle>Recent Signals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <TrendingUp className="w-5 h-5" />
          <span>Recent Signals</span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {!signals || signals.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
              📡
            </div>
            <div className="text-sm text-muted-foreground">No recent signals</div>
          </div>
        ) : (
          signals.map((signal) => (
            <div key={signal.id} className="flex items-center justify-between" data-testid={`signal-${signal.id}`}>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div className="font-medium text-sm">{signal.symbol}</div>
                  <Badge 
                    className={`${getSignalColor(signal.signal)} flex items-center space-x-1 text-xs`}
                    data-testid={`signal-badge-${signal.id}`}
                  >
                    {getSignalIcon(signal.signal)}
                    <span>{signal.signal}</span>
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground" data-testid={`signal-time-${signal.id}`}>
                  {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono" data-testid={`signal-confidence-${signal.id}`}>
                  {signal.confidence.toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.timeframe}
                </div>
              </div>
            </div>
          ))
        )}

        <div className="pt-3 border-t border-border">
          <Button 
            variant="outline" 
            className="w-full justify-start"
            data-testid="button-view-all-signals"
          >
            <List className="w-4 h-4 mr-2" />
            View All Signals
          </Button>
        </div>

        {/* Signal Summary */}
        {signals && signals.length > 0 && (
          <div className="pt-3 border-t border-border">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-semibold text-green-500" data-testid="stat-long-signals">
                  {signals.filter(s => s.signal === 'LONG').length}
                </div>
                <div className="text-xs text-muted-foreground">Long</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-red-500" data-testid="stat-short-signals">
                  {signals.filter(s => s.signal === 'SHORT').length}
                </div>
                <div className="text-xs text-muted-foreground">Short</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-500" data-testid="stat-wait-signals">
                  {signals.filter(s => s.signal === 'WAIT').length}
                </div>
                <div className="text-xs text-muted-foreground">Wait</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
