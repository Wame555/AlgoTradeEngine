import { useEffect } from "react";
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
import { useUserSettings } from "@/hooks/useTradingData";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertUserSettingsSchema } from "@shared/schema";
import { Save, Key, Shield, DollarSign } from "lucide-react";
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
  const userId = session?.user.id ?? "";

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      userId,
      binanceApiKey: "",
      binanceApiSecret: "",
      isTestnet: true,
      defaultLeverage: 1,
      riskPercent: 2,
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
        riskPercent: settings.riskPercent ?? 2,
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
