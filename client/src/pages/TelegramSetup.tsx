import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useUserSettings } from "@/hooks/useTradingData";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Send, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useSession } from "@/hooks/useSession";

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
  const { session } = useSession();
  const userId = session?.userId;

  const form = useForm<TelegramForm>({
    resolver: zodResolver(telegramFormSchema),
    defaultValues: {
      telegramBotToken: '',
      telegramChatId: '',
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        telegramBotToken: settings.telegramBotToken ?? '',
        telegramChatId: settings.telegramChatId ?? '',
      });
    }
  }, [settings, form]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: TelegramForm) => {
      if (!userId) {
        throw new Error('Missing user context');
      }
      await apiRequest('POST', '/api/settings', {
        userId,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Telegram settings saved successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ['/api/settings', userId] });
      }
    },
    onError: (error: any) => {
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
    onError: (error: any) => {
      setTestStatus('error');
      toast({
        title: "Error",
        description: error.message || "Failed to test Telegram connection",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TelegramForm) => {
    if (!userId) {
      toast({
        title: "Missing user",
        description: "User session is not ready yet.",
        variant: "destructive",
      });
      return;
    }
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

  if (isLoading || !userId) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          {[1, 2].map((i) => (
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
            <Info className="h-5 w-5" />
            <span>Setup Instructions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex items-start space-x-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </div>
              <div>
                <div className="font-medium">Get Chat ID</div>
                <div className="text-muted-foreground">
                  Start a chat with your bot and send any message. Then visit:
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                    https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates
                  </code>
                  and find your chat ID in the response
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                4
              </div>
              <div>
                <div className="font-medium">Test Connection</div>
                <div className="text-muted-foreground">
                  Use the test button below to ensure your bot can send messages to the chat ID
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <MessageCircle className="h-5 w-5" />
            <span>Bot Configuration</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="telegramBotToken">Bot Token</Label>
              <Input
                id="telegramBotToken"
                placeholder="123456789:ABCdefGhIjKlMnOpQrStUvWxYz"
                {...form.register('telegramBotToken')}
                data-testid="input-bot-token"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegramChatId">Chat ID</Label>
              <Input
                id="telegramChatId"
                placeholder="123456789"
                {...form.register('telegramChatId')}
                data-testid="input-chat-id"
              />
            </div>

            <Alert variant="default">
              <AlertDescription className="text-sm text-muted-foreground">
                We recommend creating a dedicated chat for the bot to avoid sharing personal messages.
              </AlertDescription>
            </Alert>

            <div className="flex space-x-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={testConnectionMutation.isPending}
                data-testid="button-test-telegram"
              >
                <Send className={`mr-2 h-4 w-4 ${testConnectionMutation.isPending ? 'animate-spin' : ''}`} />
                {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
              </Button>

              <Button
                type="submit"
                disabled={saveSettingsMutation.isPending || !userId}
                data-testid="button-save-telegram"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {saveSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Status Alerts */}
      {testStatus === 'success' && (
        <Alert className="border-green-500/40 bg-green-500/10 text-green-600">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Your Telegram bot is connected and ready to send notifications.
          </AlertDescription>
        </Alert>
      )}

      {testStatus === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Unable to connect to Telegram. Please verify your bot token and chat ID.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
