import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useUserSettings } from "@/hooks/useTradingData";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { MessageCircle, Send, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useState } from "react";

const MOCK_USER_ID = 'mock-user-123';

const telegramFormSchema = z.object({
  telegramBotToken: z.string().min(1, "Bot token is required"),
  telegramChatId: z.string().min(1, "Chat ID is required"),
});

type TelegramForm = z.infer<typeof telegramFormSchema>;

export default function TelegramSetup() {
  const { data: settings, isLoading } = useUserSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const form = useForm<TelegramForm>({
    resolver: zodResolver(telegramFormSchema),
    defaultValues: {
      telegramBotToken: settings?.telegramBotToken || '',
      telegramChatId: settings?.telegramChatId || '',
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: TelegramForm) => {
      await apiRequest('POST', '/api/settings', {
        userId: MOCK_USER_ID,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Telegram settings saved successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save Telegram settings",
        variant: "destructive",
      });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (data: TelegramForm) => {
      const response = await apiRequest('POST', '/api/telegram/test', data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setTestStatus('success');
        toast({
          title: "Success",
          description: "Telegram connection test successful!",
          variant: "default",
        });
      } else {
        setTestStatus('error');
        toast({
          title: "Error",
          description: "Telegram connection test failed",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      setTestStatus('error');
      toast({
        title: "Error",
        description: error.message || "Failed to test Telegram connection",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TelegramForm) => {
    saveSettingsMutation.mutate(data);
  };

  const handleTestConnection = () => {
    const formData = form.getValues();
    if (!formData.telegramBotToken || !formData.telegramChatId) {
      toast({
        title: "Error",
        description: "Please fill in both bot token and chat ID",
        variant: "destructive",
      });
      return;
    }
    
    setTestStatus('testing');
    testConnectionMutation.mutate(formData);
  };

  const getStatusBadge = () => {
    switch (testStatus) {
      case 'testing':
        return <Badge variant="secondary">Testing...</Badge>;
      case 'success':
        return <Badge className="bg-green-500/10 text-green-500">Connected</Badge>;
      case 'error':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">Not tested</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          {[1, 2].map((i) => (
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
          <h2 className="text-2xl font-bold" data-testid="telegram-setup-title">Telegram Setup</h2>
          <p className="text-muted-foreground">
            Configure Telegram notifications for trading alerts
          </p>
        </div>
        {getStatusBadge()}
      </div>

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Info className="w-5 h-5" />
            <span>Setup Instructions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground">
                1
              </div>
              <div>
                <div className="font-medium">Create a Telegram Bot</div>
                <div className="text-muted-foreground">
                  Message @BotFather on Telegram and use /newbot command to create a new bot
                </div>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground">
                2
              </div>
              <div>
                <div className="font-medium">Get Bot Token</div>
                <div className="text-muted-foreground">
                  Copy the bot token provided by @BotFather (format: 123456789:ABCdefGhIjKlMnOpQrStUvWxYz)
                </div>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground">
                3
              </div>
              <div>
                <div className="font-medium">Get Chat ID</div>
                <div className="text-muted-foreground">
                  Start a chat with your bot and send any message. Then visit: 
                  <code className="mx-1 px-1 py-0.5 bg-muted rounded text-xs">
                    https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates
                  </code>
                  and find your chat ID in the response
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <MessageCircle className="w-5 h-5" />
                <span>Bot Configuration</span>
              </CardTitle>
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
                        placeholder="123456789:ABCdefGhIjKlMnOpQrStUvWxYz"
                        type="password"
                        {...field}
                        data-testid="input-bot-token"
                      />
                    </FormControl>
                    <div className="text-sm text-muted-foreground">
                      Your Telegram bot token from @BotFather
                    </div>
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
                        placeholder="123456789"
                        {...field}
                        data-testid="input-chat-id"
                      />
                    </FormControl>
                    <div className="text-sm text-muted-foreground">
                      Your Telegram chat ID where notifications will be sent
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex space-x-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testConnectionMutation.isPending}
                  data-testid="button-test-connection"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
                </Button>

                <Button
                  type="submit"
                  disabled={saveSettingsMutation.isPending}
                  data-testid="button-save-telegram"
                >
                  {saveSettingsMutation.isPending ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>

      {/* Status Alerts */}
      {testStatus === 'success' && (
        <Alert className="border-green-500/20 bg-green-500/10">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700 dark:text-green-400">
            Telegram connection successful! You should have received a test message.
          </AlertDescription>
        </Alert>
      )}

      {testStatus === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to connect to Telegram. Please check your bot token and chat ID.
          </AlertDescription>
        </Alert>
      )}

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure which events trigger Telegram notifications
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded" data-testid="checkbox-trade-signals" />
              <span>Trading Signals</span>
            </Label>
            
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded" data-testid="checkbox-position-updates" />
              <span>Position Updates</span>
            </Label>
            
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded" data-testid="checkbox-profit-loss" />
              <span>Profit/Loss Alerts</span>
            </Label>
            
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded" data-testid="checkbox-system-alerts" />
              <span>System Alerts</span>
            </Label>
            
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" className="rounded" data-testid="checkbox-daily-summary" />
              <span>Daily Summary</span>
            </Label>
            
            <Label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" className="rounded" data-testid="checkbox-error-alerts" />
              <span>Error Alerts</span>
            </Label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
