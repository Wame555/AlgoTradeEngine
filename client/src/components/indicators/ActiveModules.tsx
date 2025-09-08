import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Settings, Activity, BarChart3 } from "lucide-react";
import { useIndicators } from "@/hooks/useTradingData";

const DEFAULT_MODULES = [
  { name: 'RSI Module', type: 'RSI', weight: 30, isActive: true, description: 'Relative Strength Index' },
  { name: 'MACD Module', type: 'MACD', weight: 25, isActive: true, description: 'Moving Average Convergence Divergence' },
  { name: 'MA Module', type: 'MA', weight: 20, isActive: true, description: 'Moving Average Crossover' },
  { name: 'Bollinger Bands', type: 'BB', weight: 15, isActive: false, description: 'Volatility Bands' },
  { name: 'Volume Profile', type: 'VP', weight: 10, isActive: false, description: 'Volume Analysis' },
];

export function ActiveModules() {
  const { data: indicators, isLoading } = useIndicators();

  // Use actual indicators data if available, otherwise fall back to defaults
  const modules = indicators && indicators.length > 0 ? indicators : DEFAULT_MODULES;

  const getStatusColor = (isActive: boolean) => {
    return isActive ? 'bg-green-500' : 'bg-red-500';
  };

  const getStatusText = (isActive: boolean) => {
    return isActive ? 'Active' : 'Inactive';
  };

  const getTotalWeight = () => {
    return modules
      .filter(module => module.isActive)
      .reduce((sum, module) => sum + (module.weight || 0), 0);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 bg-muted rounded" />
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
          <Activity className="w-5 h-5" />
          <span>Active Modules</span>
        </CardTitle>
        <div className="text-sm text-muted-foreground">
          Total Weight: {getTotalWeight()}%
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {modules.map((module, index) => (
          <div key={('id' in module && module.id) || index} className="space-y-2" data-testid={`module-${module.name.replace(/\s+/g, '-').toLowerCase()}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(module.isActive)}`} />
                <div>
                  <div className="text-sm font-medium">{module.name}</div>
                  {('description' in module && module.description) && (
                    <div className="text-xs text-muted-foreground">{'description' in module ? module.description : ''}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge 
                  variant={module.isActive ? "default" : "secondary"}
                  className="text-xs"
                >
                  {getStatusText(module.isActive)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {module.weight || 0}%
                </span>
              </div>
            </div>
            
            {module.isActive && (
              <div className="ml-5">
                <Progress 
                  value={module.weight || 0} 
                  className="h-1" 
                  data-testid={`progress-${module.name.replace(/\s+/g, '-').toLowerCase()}`}
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
            <Settings className="w-4 h-4 mr-2" />
            Configure Modules
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="pt-3 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold" data-testid="stat-active-modules">
                {modules.filter(m => m.isActive).length}
              </div>
              <div className="text-xs text-muted-foreground">Active</div>
            </div>
            <div>
              <div className="text-lg font-semibold" data-testid="stat-total-modules">
                {modules.length}
              </div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
