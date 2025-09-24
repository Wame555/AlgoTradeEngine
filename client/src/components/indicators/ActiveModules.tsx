import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Activity } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useIndicators } from "@/hooks/useTradingData";

interface EditableConfig {
  id?: string;
  name: string;
  enabled: boolean;
  paramsText: string;
}

export function ActiveModules() {
  const { data: configs, isLoading } = useIndicators();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editableConfigs, setEditableConfigs] = useState<EditableConfig[]>([]);

  useEffect(() => {
    if (!isDialogOpen && configs) {
      setEditableConfigs(
        configs.map((config) => ({
          id: config.id,
          name: config.name,
          enabled: config.enabled,
          paramsText: JSON.stringify(config.params ?? {}, null, 2),
        })),
      );
    }
  }, [configs, isDialogOpen]);

  const activeCount = useMemo(() => configs?.filter((config) => config.enabled).length ?? 0, [configs]);
  const totalCount = configs?.length ?? 0;

  const saveMutation = useMutation({
    mutationFn: async (payload: Array<{ name: string; enabled: boolean; params: Record<string, unknown> }>) => {
      await apiRequest('POST', '/api/indicator-configs', { configs: payload });
    },
    onSuccess: () => {
      toast({
        title: "Modules updated",
        description: "Indicator configurations saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/indicator-configs'] });
      setIsDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || 'Failed to save indicator configurations',
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    try {
      const payload = editableConfigs.map((config) => {
        let parsed: Record<string, unknown> = {};
        if (config.paramsText.trim().length > 0) {
          parsed = JSON.parse(config.paramsText);
        }
        return {
          name: config.name,
          enabled: config.enabled,
          params: parsed,
        };
      });
      saveMutation.mutate(payload);
    } catch (error) {
      toast({
        title: "Invalid parameters",
        description: error instanceof Error ? error.message : 'Ensure parameters are valid JSON objects',
        variant: "destructive",
      });
    }
  };

  const handleToggle = (name: string, enabled: boolean) => {
    setEditableConfigs((prev) => prev.map((config) => (config.name === name ? { ...config, enabled } : config)));
  };

  const handleParamsChange = (name: string, value: string) => {
    setEditableConfigs((prev) => prev.map((config) => (config.name === name ? { ...config, paramsText: value } : config)));
  };

  const renderPlaceholder = () => (
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
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full justify-start" data-testid="button-configure-modules">
                <Settings className="mr-2 h-4 w-4" />
                Configure Modules
              </Button>
            </DialogTrigger>
            {renderDialogContent()}
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );

  const renderDialogContent = () => (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Configure Indicator Modules</DialogTitle>
        <DialogDescription>
          Enable or disable modules and adjust their parameters. Parameters are stored as JSON objects.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {editableConfigs.map((config) => (
          <div key={config.name} className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">{config.name}</h4>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">Enabled</span>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) => handleToggle(config.name, checked)}
                  data-testid={`switch-${config.name}`}
                />
              </div>
            </div>
            <Textarea
              value={config.paramsText}
              onChange={(event) => handleParamsChange(config.name, event.target.value)}
              className="mt-3 h-32 font-mono text-xs"
              data-testid={`textarea-${config.name}`}
            />
          </div>
        ))}
        {editableConfigs.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No configurations available.
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

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

  if (!configs || configs.length === 0) {
    return renderPlaceholder();
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>Active Modules</span>
          </CardTitle>
          <div className="text-sm text-muted-foreground">{activeCount} active of {totalCount} modules</div>
        </CardHeader>

        <CardContent className="space-y-3">
          {configs.map((config) => {
            const paramsEntries = Object.entries(config.params ?? {});
            const summary = paramsEntries.slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`);
            const hasMore = paramsEntries.length > summary.length;

            return (
              <div
                key={config.id}
                className="space-y-2"
                data-testid={`module-${config.name.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{config.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {summary.length > 0 ? summary.join(', ') : 'No parameters configured'}
                      {hasMore ? ', …' : ''}
                    </div>
                  </div>
                  <Badge variant={config.enabled ? 'default' : 'secondary'} className="text-xs">
                    {config.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Updated: {new Date(config.updatedAt).toLocaleString()}
                </div>
              </div>
            );
          })}

          <div className="pt-3 border-t border-border">
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start"
                data-testid="button-configure-modules"
              >
                <Settings className="mr-2 h-4 w-4" />
                Configure Modules
              </Button>
            </DialogTrigger>
          </div>

          <div className="pt-3 border-t border-border">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-lg font-semibold" data-testid="stat-active-modules">
                  {activeCount}
                </div>
                <div className="text-xs text-muted-foreground">Active</div>
              </div>
              <div>
                <div className="text-lg font-semibold" data-testid="stat-total-modules">
                  {totalCount}
                </div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {renderDialogContent()}
    </Dialog>
  );
}
