import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Settings, Activity } from "lucide-react";

import { useIndicators } from "@/hooks/useTradingData";

export function ActiveModules() {
  const { data: indicators, isLoading } = useIndicators();

  const activeIndicators = indicators?.filter((indicator) => indicator.isActive) ?? [];
  const totalWeight = activeIndicators.reduce((sum, indicator) => sum + (indicator.weight ?? 0), 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!indicators || indicators.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>Active Modules</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No indicator configurations have been added yet.
          </div>
          <div className="pt-3">
            <Button variant="outline" className="w-full justify-start" data-testid="button-configure-modules">
              <Settings className="mr-2 h-4 w-4" />
              Configure Modules
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Activity className="h-5 w-5" />
          <span>Active Modules</span>
        </CardTitle>
        <div className="text-sm text-muted-foreground">Total Weight: {totalWeight.toFixed(2)}%</div>
      </CardHeader>

      <CardContent className="space-y-3">
        {indicators.map((indicator) => (
          <div
            key={indicator.id}
            className="space-y-2"
            data-testid={`module-${indicator.name.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`h-2 w-2 rounded-full ${indicator.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                <div>
                  <div className="text-sm font-medium">{indicator.name}</div>
                  <div className="text-xs text-muted-foreground">{indicator.type}</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge variant={indicator.isActive ? "default" : "secondary"} className="text-xs">
                  {indicator.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <span className="text-xs text-muted-foreground">{indicator.weight ?? 0}%</span>
              </div>
            </div>

            {indicator.isActive && (
              <div className="ml-5">
                <Progress
                  value={indicator.weight ?? 0}
                  className="h-1"
                  data-testid={`progress-${indicator.name.replace(/\s+/g, '-').toLowerCase()}`}
                />
              </div>
            )}
          </div>
        ))}

        <div className="pt-3 border-t border-border">
          <Button
            variant="outline"
            className="w-full justify-start"
            data-testid="button-configure-modules"
          >
            <Settings className="mr-2 h-4 w-4" />
            Configure Modules
          </Button>
        </div>

        <div className="pt-3 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold" data-testid="stat-active-modules">
                {activeIndicators.length}
              </div>
              <div className="text-xs text-muted-foreground">Active</div>
            </div>
            <div>
              <div className="text-lg font-semibold" data-testid="stat-total-modules">
                {indicators.length}
              </div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
