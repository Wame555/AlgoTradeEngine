import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Settings } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useIndicators } from "@/hooks/useTradingData";
import { useUserId } from "@/hooks/useSession";

function summarisePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) {
    return "No parameters configured";
  }
  const summary = entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  return entries.length > summary.length ? `${summary.join(", ")}, …` : summary.join(", ");
}

export function ActiveModules() {
  const { data: configs, isLoading } = useIndicators();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = useUserId();

  const requestBase = userId ? `/api/indicators/configs?userId=${encodeURIComponent(userId)}` : '/api/indicators/configs';

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [payloadText, setPayloadText] = useState("{\n  \"length\": 14\n}");

  const totalCount = configs?.length ?? 0;
  const sortedConfigs = useMemo(() => {
    if (!configs) return [];
    return [...configs].sort((a, b) => a.name.localeCompare(b.name));
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { name: string; payload: Record<string, unknown> }) => {
      await apiRequest('POST', requestBase, payload);
    },
    onSuccess: () => {
      toast({
        title: "Configuration saved",
        description: "Indicator configuration stored successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/indicators/configs'] });
      setName("");
      setPayloadText("{\n  \"length\": 14\n}");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || 'Failed to save configuration',
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const url = userId ? `/api/indicators/configs/${id}?userId=${encodeURIComponent(userId)}` : `/api/indicators/configs/${id}`;
      await apiRequest('DELETE', url);
    },
    onSuccess: () => {
      toast({
        title: "Configuration removed",
        description: "Indicator configuration deleted",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/indicators/configs'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || 'Failed to delete configuration',
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast({
        title: "Missing name",
        description: "Provide a configuration name",
        variant: "destructive",
      });
      return;
    }

    try {
      const parsed = payloadText.trim() ? JSON.parse(payloadText) : {};
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Payload must be a JSON object");
      }
      saveMutation.mutate({ name: name.trim(), payload: parsed });
    } catch (error) {
      toast({
        title: "Invalid JSON",
        description: error instanceof Error ? error.message : 'Unable to parse payload JSON',
        variant: "destructive",
      });
    }
  };

  const handleDelete = (id: string) => {
    if (deleteMutation.isPending) return;
    deleteMutation.mutate(id);
  };

  const renderPlaceholder = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Settings className="h-5 w-5" />
          <span>Indicator Configurations</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No indicator configurations available yet.
        </div>
        <div className="pt-3">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full justify-start" data-testid="button-configure-modules">
                <Plus className="mr-2 h-4 w-4" />
                Add configuration
              </Button>
            </DialogTrigger>
            {renderDialogContent()}
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );

  const renderDialogContent = () => (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>Configure Indicator Modules</DialogTitle>
        <DialogDescription>
          Manage indicator presets for your strategies. Provide a name and JSON payload describing the configuration.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 md:grid-cols-[2fr,3fr]">
        <div className="space-y-3">
          <Input
            placeholder="e.g. RSI"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="input-indicator-name"
          />
          <Textarea
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            className="h-48 font-mono text-xs"
            data-testid="textarea-indicator-payload"
          />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Existing configurations</h4>
          <ScrollArea className="h-60 rounded-md border border-border p-3">
            {sortedConfigs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No configurations saved yet.</div>
            ) : (
              <div className="space-y-3">
                {sortedConfigs.map((config) => (
                  <div key={config.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{config.name}</div>
                        <div className="text-xs text-muted-foreground">{summarisePayload(config.payload ?? {})}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(config.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-config-${config.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Indicator Configurations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
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
            <Settings className="h-5 w-5" />
            <span>Indicator Configurations</span>
          </CardTitle>
          <div className="text-sm text-muted-foreground">{totalCount} saved configuration{totalCount !== 1 ? 's' : ''}</div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedConfigs.map((config) => (
            <div key={config.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">{config.name}</div>
                <div className="text-xs text-muted-foreground">{summarisePayload(config.payload ?? {})}</div>
              </div>
              <Badge variant="secondary" className="text-xs">Custom</Badge>
            </div>
          ))}

          <div className="pt-3 border-t border-border">
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full justify-start" data-testid="button-configure-modules">
                <Plus className="mr-2 h-4 w-4" />
                Add configuration
              </Button>
            </DialogTrigger>
          </div>
        </CardContent>
      </Card>

      {renderDialogContent()}
    </Dialog>
  );
}
