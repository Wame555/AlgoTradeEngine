import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTradingPairs, useUserSettings } from "@/hooks/useTradingData";
import { useSession } from "@/hooks/useSession";
import { calculateQuantityFromUsd, QuantityValidationError } from "@shared/tradingUtils";
import { PriceUpdate, TradingPair } from "@/types/trading";

const tradeFormSchema = z
  .object({
    symbol: z.string().min(1, "Symbol is required"),
    side: z.enum(['LONG', 'SHORT']),
    mode: z.enum(['QTY', 'USDT']).default('QTY'),
    size: z
      .string()
      .optional()
      .refine((val) => val == null || (!isNaN(Number(val)) && Number(val) > 0), {
        message: "Size must be a positive number",
      }),
    amountUsd: z
      .string()
      .optional()
      .refine((val) => val == null || (!isNaN(Number(val)) && Number(val) > 0), {
        message: "Amount must be a positive number",
      }),
    leverage: z.number().min(1).max(20),
    stopLoss: z.string().optional(),
    takeProfit: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'QTY') {
      if (!data.size || Number(data.size) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a valid position size',
          path: ['size'],
        });
      }
    } else {
      if (!data.amountUsd || Number(data.amountUsd) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a valid USDT amount',
          path: ['amountUsd'],
        });
      }
    }
  });

type TradeForm = z.infer<typeof tradeFormSchema>;

interface QuickTradeProps {
  priceData: Map<string, PriceUpdate>;
}

export function QuickTrade({ priceData }: QuickTradeProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.userId;
  const { data: tradingPairs } = useTradingPairs();
  const { data: settings } = useUserSettings();

  const form = useForm<TradeForm>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      symbol: '',
      side: 'LONG',
      mode: 'QTY',
      size: '0.01',
      amountUsd: '100',
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

  const resolveFilters = (pair: TradingPair | undefined) => {
    return {
      stepSize: pair?.stepSize ? Number(pair.stepSize) : undefined,
      minQty: pair?.minQty ? Number(pair.minQty) : undefined,
      minNotional: pair?.minNotional ? Number(pair.minNotional) : undefined,
    };
  };

  const getLastPrice = (symbol: string): number | null => {
    const priceEntry = priceData.get(symbol);
    if (!priceEntry) {
      return null;
    }
    const price = Number(priceEntry.price);
    return Number.isFinite(price) ? price : null;
  };

  const createPositionMutation = useMutation({
    mutationFn: async (data: TradeForm) => {
      if (!userId) {
        throw new Error('Missing user context');
      }
      if (!data.symbol) {
        throw new Error('Select a symbol to trade');
      }

      let sizeToUse = data.mode === 'QTY' ? data.size : undefined;
      let amountToUse = data.mode === 'USDT' ? data.amountUsd : undefined;

      if (data.mode === 'USDT') {
        const price = getLastPrice(data.symbol);
        if (!price) {
          throw new Error('Live price is unavailable for the selected symbol');
        }
        const pairForSymbol = tradingPairs?.find((pair) => pair.symbol === data.symbol);
        const filters = resolveFilters(pairForSymbol);
        try {
          const quantityResult = calculateQuantityFromUsd(Number(amountToUse), price, filters);
          sizeToUse = quantityResult.quantity.toFixed(8);
        } catch (error) {
          if (error instanceof QuantityValidationError) {
            throw new Error(error.message);
          }
          throw new Error('Failed to calculate order quantity');
        }
      }

      if (!sizeToUse) {
        throw new Error('Unable to determine position size');
      }

      const positionData = {
        userId,
        symbol: data.symbol,
        side: data.side,
        size: sizeToUse,
        amountUsd: amountToUse,
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
        queryClient.invalidateQueries({ queryKey: ['/api/positions/open'] });
        queryClient.invalidateQueries({ queryKey: ['/api/stats/summary'] });
      }
      form.reset({
        symbol: tradingPairs?.[0]?.symbol ?? '',
        side: 'LONG',
        mode: 'QTY',
        size: '0.01',
        amountUsd: '100',
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
  const mode = form.watch('mode');

  useEffect(() => {
    if (mode === 'USDT') {
      form.setValue('size', '');
      const currentAmount = form.getValues('amountUsd');
      if (!currentAmount) {
        form.setValue('amountUsd', '100');
      }
    } else {
      form.setValue('amountUsd', '');
      const currentSize = form.getValues('size');
      if (!currentSize) {
        form.setValue('size', '0.01');
      }
    }
  }, [mode, form]);

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

            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order Mode</FormLabel>
                  <ToggleGroup
                    type="single"
                    value={field.value}
                    onValueChange={(value) => field.onChange(value || 'QTY')}
                    className="grid grid-cols-2 gap-2"
                  >
                    <ToggleGroupItem value="QTY" aria-label="Quantity mode">
                      Qty
                    </ToggleGroupItem>
                    <ToggleGroupItem value="USDT" aria-label="USDT mode">
                      USDT
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FormItem>
              )}
            />

            {mode === 'QTY' ? (
              <FormField
                key="qty-field"
                control={form.control}
                name="size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0.01"
                        type="number"
                        step="0.00000001"
                        inputMode="decimal"
                        {...field}
                        data-testid="input-size"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                key="amount-field"
                control={form.control}
                name="amountUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (USDT)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="100"
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        {...field}
                        data-testid="input-amount-usd"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
