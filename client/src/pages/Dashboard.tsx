import { PairsOverview } from "@/components/trading/PairsOverview";
import { QuickTrade } from "@/components/trading/QuickTrade";
import { ActiveModules } from "@/components/indicators/ActiveModules";
import { RecentSignals } from "@/components/signals/RecentSignals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Trophy, ArrowUpDown, DollarSign } from "lucide-react";
import { PriceUpdate } from "@/types/trading";
import { usePositions } from "@/hooks/useTradingData";

interface DashboardProps {
  priceData: Map<string, PriceUpdate>;
}

export default function Dashboard({ priceData }: DashboardProps) {
  const { data: positions } = usePositions();
  const activePositions = positions?.length || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Statistics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Positions</p>
                <p className="text-2xl font-bold" data-testid="stat-active-positions">{activePositions}</p>
              </div>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <BarChart3 className="text-primary w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold text-green-500" data-testid="stat-win-rate">68.3%</p>
              </div>
              <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                <Trophy className="text-green-500 w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="text-2xl font-bold" data-testid="stat-total-trades">1,247</p>
              </div>
              <div className="w-12 h-12 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                <ArrowUpDown className="text-yellow-500 w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Profit</p>
                <p className="text-2xl font-bold text-green-500" data-testid="stat-avg-profit">$18.75</p>
              </div>
              <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                <DollarSign className="text-green-500 w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
              <button className="px-3 py-1 bg-primary text-primary-foreground rounded-md text-sm">1D</button>
              <button className="px-3 py-1 bg-muted text-muted-foreground rounded-md text-sm hover:bg-accent hover:text-accent-foreground">7D</button>
              <button className="px-3 py-1 bg-muted text-muted-foreground rounded-md text-sm hover:bg-accent hover:text-accent-foreground">30D</button>
              <button className="px-3 py-1 bg-muted text-muted-foreground rounded-md text-sm hover:bg-accent hover:text-accent-foreground">ALL</button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 bg-muted/20 rounded-lg flex items-center justify-center" data-testid="performance-chart">
            <div className="text-center">
              <BarChart3 className="w-16 h-16 text-muted-foreground mb-4 mx-auto" />
              <p className="text-muted-foreground">Performance Chart</p>
              <p className="text-sm text-muted-foreground">Real-time portfolio analytics</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
