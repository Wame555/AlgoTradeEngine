import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useUserSettings } from "@/hooks/useTradingData";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertUserSettingsSchema } from "@shared/schema";
import { Save, Key, Shield, DollarSign, TrendingUp } from "lucide-react";
import { useSession } from "@/hooks/useSession";

const settingsFormSchema = insertUserSettingsSchema.extend({
  userId: z.string(),
});

type SettingsForm = z.infer<typeof settingsFormSchema>;

export default function Settings() {
  const { data: settings, isLoading } = useUserSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.userId ?? "";
  const [isPatchDialogOpen, setIsPatchDialogOpen] = useState(false);
  const [patchValues, setPatchValues] = useState({ initialBalance: "", feesMultiplier: "" });

  const resetStatsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/account/reset");
    },
    onSuccess: () => {
      toast({
        title: "Statistics reset",
        description: "Closed positions and indicator configurations have been reset.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/indicators/configs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions/open"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset account statistics",
        variant: "destructive",
      });
    },
  });

  const accountPatchMutation = useMutation({
    mutationFn: async (payload: { initialBalance?: number; feesMultiplier?: number }) => {
      await apiRequest("POST", "/api/account/patch", payload);
    },
    onSuccess: () => {
      toast({
        title: "Patch applied",
        description: "Account adjustments saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/account"] });
      setIsPatchDialogOpen(false);
      setPatchValues({ initialBalance: "", feesMultiplier: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply account patch",
        variant: "destructive",
      });
    },
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      userId,
      binanceApiKey: "",
      binanceApiSecret: "",
      isTestnet: true,
    defaultLeverage: 1,
    riskPercent: 2,
    demoEnabled: true,
    defaultTpPct: "1.00",
    defaultSlPct: "0.50",
      telegramBotToken: "",
      telegramChatId: "",
    },
  });

  useEffect(() => {
    if (!userId) return;
    form.setValue("userId", userId);
  }, [userId, form]);

  useEffect(() => {
    if (!userId) return;

    if (settings) {
      form.reset({
        userId,
        binanceApiKey: settings.binanceApiKey ?? "",
        binanceApiSecret: settings.binanceApiSecret ?? "",
        isTestnet: settings.isTestnet ?? true,
        defaultLeverage: settings.defaultLeverage ?? 1,
        riskPercent: Number(settings.riskPercent ?? 2),
        demoEnabled: settings.demoEnabled ?? true,
        defaultTpPct: settings.defaultTpPct != null ? settings.defaultTpPct.toString() : "1.00",
        defaultSlPct: settings.defaultSlPct != null ? settings.defaultSlPct.toString() : "0.50",
        telegramBotToken: settings.telegramBotToken ?? "",
        telegramChatId: settings.telegramChatId ?? "",
      });
    } else {
      form.reset({
        userId,
        binanceApiKey: "",
        binanceApiSecret: "",
        isTestnet: true,
        defaultLeverage: 1,
        riskPercent: 2,
        demoEnabled: true,
        defaultTpPct: "1.00",
        defaultSlPct: "0.50",
        telegramBotToken: "",
        telegramChatId: "",
      });
    }
  }, [settings, userId, form]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: SettingsForm) => {
      await apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Settings saved successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/settings", userId] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SettingsForm) => {
    if (!userId) {
      toast({
        title: "Missing user",
        description: "User session is not ready yet.",
        variant: "destructive",
      });
      return;
    }

    saveSettingsMutation.mutate({ ...data, userId });
  };

  const handlePatchApply = () => {
    const payload: { initialBalance?: number; feesMultiplier?: number } = {};

    if (patchValues.initialBalance.trim().length > 0) {
      const balance = Number(patchValues.initialBalance);
      if (!Number.isFinite(balance) || balance <= 0) {
        toast({
          title: "Invalid value",
          description: "Initial balance must be a positive number",
          variant: "destructive",
        });
        return;
      }
      payload.initialBalance = balance;
    }

    if (patchValues.feesMultiplier.trim().length > 0) {
      const multiplier = Number(patchValues.feesMultiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        toast({
          title: "Invalid value",
          description: "Fees multiplier must be greater than zero",
          variant: "destructive",
        });
        return;
      }
      payload.feesMultiplier = multiplier;
    }

    if (!payload.initialBalance && !payload.feesMultiplier) {
      toast({
        title: "Missing values",
        description: "Provide at least one field to patch.",
        variant: "destructive",
      });
      return;
    }

    accountPatchMutation.mutate(payload);
  };

  if (isLoading || !userId) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="settings-title">
            Settings
          </h2>
          <p className="text-muted-foreground">
            Configure your trading bot and API connections
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={resetStatsMutation.isPending}>
              Reset Stats
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset statistics?</AlertDialogTitle>
              <AlertDialogDescription>
                This will clear all closed positions and restore indicator configurations to their default presets. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetStatsMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => resetStatsMutation.mutate()}
                disabled={resetStatsMutation.isPending}
              >
                {resetStatsMutation.isPending ? 'Resetting...' : 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={isPatchDialogOpen} onOpenChange={(open) => {
          setIsPatchDialogOpen(open);
          if (!open) {
            setPatchValues({ initialBalance: "", feesMultiplier: "" });
          }
        }}>
          <DialogTrigger asChild>
            <Button variant="outline">Apply Account Patch</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Manual Account Patch</DialogTitle>
              <DialogDescription>
                Provide values to adjust the paper account. Leave a field blank to keep it unchanged.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <FormLabel>Initial Balance (USD)</FormLabel>
                <Input
                  type="number"
                  placeholder="10000"
                  value={patchValues.initialBalance}
                  onChange={(event) => setPatchValues((prev) => ({ ...prev, initialBalance: event.target.value }))}
                  data-testid="input-initial-balance"
                />
              </div>
              <div>
                <FormLabel>Fees Multiplier</FormLabel>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="1.0"
                  value={patchValues.feesMultiplier}
                  onChange={(event) => setPatchValues((prev) => ({ ...prev, feesMultiplier: event.target.value }))}
                  data-testid="input-fees-multiplier"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPatchDialogOpen(false)} disabled={accountPatchMutation.isPending}>
                Cancel
              </Button>
              <Button onClick={handlePatchApply} disabled={accountPatchMutation.isPending}>
                {accountPatchMutation.isPending ? 'Applying...' : 'Apply Patch'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Binance API Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Key className="h-5 w-5" />
                <span>Binance API Configuration</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Configure your Binance API credentials for trading
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="binanceApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your Binance API key"
                        type="password"
                        name={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        data-testid="input-api-key"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="binanceApiSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Secret</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your Binance API secret"
                        type="password"
                        name={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        data-testid="input-api-secret"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isTestnet"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Use Testnet</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Enable to use Binance testnet for safe testing
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        data-testid="switch-testnet"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Risk Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Risk Management</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Configure risk parameters and position sizing
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="defaultLeverage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Leverage</FormLabel>
                    <Select
                      value={field.value?.toString() ?? "1"}
                      onValueChange={(value) => field.onChange(parseInt(value, 10))}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-leverage">
                          <SelectValue placeholder="Select leverage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">1x</SelectItem>
                        <SelectItem value="3">3x</SelectItem>
                        <SelectItem value="5">5x</SelectItem>
                        <SelectItem value="10">10x</SelectItem>
                        <SelectItem value="20">20x</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="riskPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk per Trade (%)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="2"
                        type="number"
                        step="0.1"
                        name={field.name}
                        value={field.value?.toString() ?? ""}
                        onChange={(event) => field.onChange(Number(event.target.value))}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        data-testid="input-risk-percent"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Demo Trading Defaults */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5" />
                <span>Demo Trading Defaults</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Configure default take profit and stop loss targets for demo orders
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="demoEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div>
                      <FormLabel className="text-base">Use demo account</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Toggle demo trading features and default order protections.
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                        data-testid="switch-demo-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="defaultTpPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Take Profit (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0.1}
                          max={50}
                          step={0.1}
                          value={field.value?.toString() ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            field.onChange(value === "" ? undefined : Number(value));
                          }}
                          data-testid="input-default-tp"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultSlPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Stop Loss (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0.1}
                          max={50}
                          step={0.1}
                          value={field.value?.toString() ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            field.onChange(value === "" ? undefined : Number(value));
                          }}
                          data-testid="input-default-sl"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Telegram */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <DollarSign className="h-5 w-5" />
                <span>Telegram Notifications</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Configure Telegram bot credentials for notifications
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="telegramBotToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Token</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your Telegram bot token"
                        name={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        data-testid="input-telegram-bot-token"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="telegramChatId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chat ID</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your Telegram chat ID"
                        name={field.name}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        data-testid="input-telegram-chat-id"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Separator />

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saveSettingsMutation.isPending}
              className="flex items-center"
              data-testid="button-save-settings"
            >
              <Save className="mr-2 h-4 w-4" />
              {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
