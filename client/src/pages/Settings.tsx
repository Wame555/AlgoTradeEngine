import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useUserSettings } from "@/hooks/useTradingData";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertUserSettingsSchema } from "@shared/schema";
import { z } from "zod";
import { Save, Key, Shield, DollarSign } from "lucide-react";

const MOCK_USER_ID = 'mock-user-123';

const settingsFormSchema = insertUserSettingsSchema.extend({
  userId: z.string().default(MOCK_USER_ID),
});

type SettingsForm = z.infer<typeof settingsFormSchema>;

export default function Settings() {
  const { data: settings, isLoading } = useUserSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      userId: MOCK_USER_ID,
      binanceApiKey: settings?.binanceApiKey || '',
      binanceApiSecret: settings?.binanceApiSecret || '',
      isTestnet: settings?.isTestnet ?? true,
      defaultLeverage: settings?.defaultLeverage || 1,
      riskPercent: settings?.riskPercent || 2,
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: SettingsForm) => {
      await apiRequest('POST', '/api/settings', data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Settings saved successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SettingsForm) => {
    saveSettingsMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="settings-title">Settings</h2>
          <p className="text-muted-foreground">
            Configure your trading bot and API connections
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Binance API Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Key className="w-5 h-5" />
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
                        {...field}
                        value={field.value ?? ''}
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
                        {...field}
                        value={field.value ?? ''}
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
                <Shield className="w-5 h-5" />
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
                      value={field.value?.toString() ?? '1'}
                      onValueChange={(value) => field.onChange(parseInt(value))}
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
                    <FormLabel>Risk Per Trade (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        placeholder="2.0"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        data-testid="input-risk-percent"
                      />
                    </FormControl>
                    <div className="text-sm text-muted-foreground">
                      Maximum percentage of account balance to risk per trade
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Trading Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <DollarSign className="w-5 h-5" />
                <span>Trading Preferences</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Configure default trading behavior and preferences
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Maximum Daily Trades</Label>
                  <Input
                    type="number"
                    placeholder="50"
                    min="1"
                    max="1000"
                    data-testid="input-max-trades"
                  />
                  <div className="text-sm text-muted-foreground">
                    Maximum number of trades per day
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Stop Loss Default (%)</Label>
                  <Input
                    type="number"
                    placeholder="5.0"
                    min="0.1"
                    max="50"
                    step="0.1"
                    data-testid="input-stop-loss"
                  />
                  <div className="text-sm text-muted-foreground">
                    Default stop loss percentage
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Auto-trading</Label>
                  <div className="text-sm text-muted-foreground">
                    Enable automatic trade execution based on signals
                  </div>
                </div>
                <Switch data-testid="switch-auto-trading" />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Emergency Stop</Label>
                  <div className="text-sm text-muted-foreground">
                    Enable emergency stop on significant losses
                  </div>
                </div>
                <Switch data-testid="switch-emergency-stop" />
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saveSettingsMutation.isPending}
              className="min-w-[120px]"
              data-testid="button-save-settings"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
