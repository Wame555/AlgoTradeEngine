import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTradingPairs, useUserSettings } from "@/hooks/useTradingData";
import { useSession } from "@/hooks/useSession";

const tradeFormSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  side: z.enum(['LONG', 'SHORT']),
  size: z.string().min(1, "Size is required").refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Size must be a positive number",
  }),
  leverage: z.number().min(1).max(20),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
});

type TradeForm = z.infer<typeof tradeFormSchema>;

export function QuickTrade() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: tradingPairs } = useTradingPairs();
  const { data: settings } = useUserSettings();

  const form = useForm<TradeForm>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      symbol: '',
      side: 'LONG',
      size: '0.01',
      leverage: settings?.defaultLeverage ?? 1,
      stopLoss: '',
      takeProfit: '',
    },
  });

  useEffect(() => {
    if (tradingPairs && tradingPairs.length > 0) {
      const currentSymbol = form.getValues('symbol');
      if (!currentSymbol) {
        form.setValue('symbol', tradingPairs[0].symbol);
      }
    }
  }, [tradingPairs, form]);

  useEffect(() => {
    if (settings?.defaultLeverage) {
      form.setValue('leverage', settings.defaultLeverage);
    }
  }, [settings, form]);

  const createPositionMutation = useMutation({
    mutationFn: async (data: TradeForm) => {
      if (!userId) {
        throw new Error('Missing user context');
      }
      if (!data.symbol) {
        throw new Error('Select a symbol to trade');
      }

      const positionData = {
        userId,
        symbol: data.symbol,
        side: data.side,
        size: data.size,
        entryPrice: '0',
        stopLoss: data.stopLoss || undefined,
        takeProfit: data.takeProfit || undefined,
      };

      await apiRequest('POST', '/api/positions', positionData);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position opened successfully",
        variant: "default",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ['/api/positions', userId] });
        queryClient.invalidateQueries({ queryKey: ['/api/positions', userId, 'stats'] });
      }
      form.reset({
        symbol: tradingPairs?.[0]?.symbol ?? '',
        side: 'LONG',
        size: '0.01',
        leverage: settings?.defaultLeverage ?? 1,
        stopLoss: '',
        takeProfit: '',
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open position",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TradeForm) => {
    if (!userId) {
      toast({
        title: "Missing user",
        description: "User session is not ready yet.",
        variant: "destructive",
      });
      return;
    }

    if (!data.symbol) {
      toast({
        title: "Select symbol",
        description: "Choose a trading pair before placing an order.",
        variant: "destructive",
      });
      return;
    }

    createPositionMutation.mutate(data);
  };

  const handleSideClick = (side: 'LONG' | 'SHORT') => {
    form.setValue('side', side);
  };

  const availablePairs = tradingPairs ?? [];
  const tradingDisabled = availablePairs.length === 0 || !userId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="symbol"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Symbol</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={availablePairs.length === 0}>
                    <FormControl>
                      <SelectTrigger data-testid="select-symbol">
                        <SelectValue placeholder={availablePairs.length === 0 ? 'No pairs available' : 'Select symbol'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePairs.map((pair) => (
                        <SelectItem key={pair.id} value={pair.symbol}>
                          {pair.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0.01"
                        {...field}
                        data-testid="input-size"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="leverage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Leverage</FormLabel>
                    <Select
                      value={field.value.toString()}
                      onValueChange={(value) => field.onChange(parseInt(value, 10))}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-leverage">
                          <SelectValue placeholder="Select leverage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[1, 3, 5, 10, 20].map((lev) => (
                          <SelectItem key={lev} value={lev.toString()}>{lev}x</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="stopLoss"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stop Loss (%)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="5.0"
                        type="number"
                        step="0.1"
                        {...field}
                        data-testid="input-stop-loss"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="takeProfit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Take Profit (%)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="10.0"
                        type="number"
                        step="0.1"
                        {...field}
                        data-testid="input-take-profit"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                className={`${
                  form.watch('side') === 'LONG'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-green-600 hover:text-white'
                }`}
                onClick={() => handleSideClick('LONG')}
                data-testid="button-long"
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                Long
              </Button>

              <Button
                type="button"
                className={`${
                  form.watch('side') === 'SHORT'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-red-600 hover:text-white'
                }`}
                onClick={() => handleSideClick('SHORT')}
                data-testid="button-short"
              >
                <TrendingDown className="mr-2 h-4 w-4" />
                Short
              </Button>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={createPositionMutation.isPending || tradingDisabled}
              data-testid="button-place-order"
            >
              {createPositionMutation.isPending ? 'Placing Order...' : 'Place Order'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
