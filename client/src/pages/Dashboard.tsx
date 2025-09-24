import { useMemo } from "react";
import { BarChart3, Trophy, ArrowUpDown, DollarSign } from "lucide-react";

import { PairsOverview } from "@/components/trading/PairsOverview";
import { QuickTrade } from "@/components/trading/QuickTrade";
import { ActiveModules } from "@/components/indicators/ActiveModules";
import { RecentSignals } from "@/components/signals/RecentSignals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriceUpdate } from "@/types/trading";
import { usePositions, usePositionStats } from "@/hooks/useTradingData";

interface DashboardProps {
  priceData: Map<string, PriceUpdate>;
}

export default function Dashboard({ priceData }: DashboardProps) {
  const { data: positions } = usePositions();
  const { data: positionStats } = usePositionStats();

  const activePositions = positions?.length ?? 0;
  const winRate = useMemo(() => {
    if (!positionStats) return 0;
    const totalDecided = positionStats.winningTrades + positionStats.losingTrades;
    if (totalDecided === 0) return 0;
    return (positionStats.winningTrades / totalDecided) * 100;
  }, [positionStats]);

  const totalTrades = positionStats?.totalTrades ?? 0;
  const averageProfit = positionStats?.averageProfit ?? 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Statistics Overview */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Positions</p>
                <p className="text-2xl font-bold" data-testid="stat-active-positions">{activePositions}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold text-green-500" data-testid="stat-win-rate">{winRate.toFixed(1)}%</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
                <Trophy className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="text-2xl font-bold" data-testid="stat-total-trades">{totalTrades}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-yellow-500/10">
                <ArrowUpDown className="h-6 w-6 text-yellow-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Profit</p>
                <p className={`text-2xl font-bold ${averageProfit >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="stat-avg-profit">
                  {formatCurrency(averageProfit)}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
                <DollarSign className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pairs Overview */}
        <div className="lg:col-span-2">
          <PairsOverview priceData={priceData} />
        </div>

        {/* Right Panel */}
        <div className="space-y-6">
          <QuickTrade />
          <ActiveModules />
          <RecentSignals />
        </div>
      </div>

      {/* Performance Chart Placeholder */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Portfolio Performance</CardTitle>
            <div className="flex items-center space-x-2">
              <button className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground">1D</button>
              <button className="rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">7D</button>
              <button className="rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">30D</button>
              <button className="rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">ALL</button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center rounded-lg bg-muted/20" data-testid="performance-chart">
            <div className="text-center">
              <BarChart3 className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">Performance Chart</p>
              <p className="text-sm text-muted-foreground">Real-time portfolio analytics</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
