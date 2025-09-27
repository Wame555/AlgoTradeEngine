import { useEffect, useRef, useState } from "react";
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
import { useTradingPairs, useUserSettings, useStatsSummary } from "@/hooks/useTradingData";
import { useSession } from "@/hooks/useSession";
import type { PriceUpdate } from "@/types/trading";

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
  const { data: statsSummary } = useStatsSummary();
  const [hasEquityError, setHasEquityError] = useState(false);
  const [pendingSide, setPendingSide] = useState<"LONG" | "SHORT" | null>(null);
  const lastSubmitRef = useRef<number>(0);

  const form = useForm<TradeForm>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      symbol: '',
      side: 'LONG',
      mode: 'QTY',
      size: '0.01',
      amountUsd: '100',
      leverage: Number(settings?.defaultLeverage ?? 1),
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
      form.setValue('leverage', Number(settings.defaultLeverage));
    }
  }, [settings, form]);

  const getLastPrice = (symbol: string): number | null => {
    const priceEntry = priceData.get(symbol);
    if (!priceEntry) {
      return null;
    }
    const price = Number(priceEntry.price);
    return Number.isFinite(price) ? price : null;
  };

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(
          (data as { message?: string } | null)?.message || response.statusText || 'Failed to open position',
        );
        (error as any).code = (data as { code?: string } | null)?.code;
        throw error;
      }
      return data;
    },
    onSuccess: async () => {
      setPendingSide(null);
      setHasEquityError(false);
      toast({
        title: "Success",
        description: "Position opened successfully",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/positions/open'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/stats/summary'] }),
      ]);
    },
    onError: (error: any) => {
      setPendingSide(null);
      const message = typeof error?.message === 'string' ? error.message : 'Failed to open position';
      const code = (error as { code?: string } | undefined)?.code;

      if (code === 'INSUFFICIENT_EQUITY' || message.toLowerCase().includes('insufficient equity')) {
        setHasEquityError(true);
        toast({
          title: 'Nincs elegendő egyenleg',
          description: 'A szükséges fedezet meghaladja a rendelkezésre álló equity-t.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Error',
        description: message || 'Failed to open position',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (data: TradeForm) => {
    const resetPending = () => {
      setPendingSide(null);
      lastSubmitRef.current = 0;
    };

    if (!userId) {
      toast({ title: "Missing user", description: "User session is not ready yet.", variant: "destructive" });
      resetPending();
      return;
    }

    const symbol = data.symbol.trim().toUpperCase();
    if (!symbol) {
      toast({ title: "Select symbol", description: "Choose a trading pair before placing an order.", variant: "destructive" });
      resetPending();
      return;
    }

    const price = getLastPrice(symbol);
    if (!price) {
      toast({ title: "No price", description: "Live price is unavailable for the selected symbol", variant: "destructive" });
      resetPending();
      return;
    }

    const side = data.side;
    const mode = data.mode;
    let qtyValue: number | null = null;
    let requiredUsd = 0;

    if (mode === 'QTY') {
      const size = Number(data.size);
      if (!Number.isFinite(size) || size <= 0) {
        toast({ title: 'Invalid size', description: 'Enter a valid position size.', variant: 'destructive' });
        resetPending();
        return;
      }
      qtyValue = size;
      requiredUsd = size * price;
    } else {
      const amountUsd = Number(data.amountUsd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        toast({ title: 'Invalid amount', description: 'Enter a valid USDT amount.', variant: 'destructive' });
        resetPending();
        return;
      }
      qtyValue = amountUsd / price;
      requiredUsd = amountUsd;
    }

    if (!qtyValue || qtyValue <= 0) {
      toast({ title: 'Invalid quantity', description: 'Unable to determine order quantity.', variant: 'destructive' });
      resetPending();
      return;
    }

    const equity = Number(statsSummary?.equity ?? 0);
    if (Number.isFinite(equity) && requiredUsd > equity) {
      setHasEquityError(true);
      toast({
        title: 'Nincs elegendő egyenleg',
        description: 'A szükséges fedezet meghaladja a rendelkezésre álló equity-t.',
        variant: 'destructive',
      });
      resetPending();
      return;
    }

    const qtyFormatted = qtyValue.toFixed(8);
    const payload: Record<string, unknown> = {
      symbol,
      side,
      qty: qtyFormatted,
      requestId: crypto.randomUUID(),
    };

    const leverageValue = Number(data.leverage);
    if (Number.isFinite(leverageValue) && leverageValue > 0) {
      payload.leverage = leverageValue;
    }

    const tpPercent = Number(data.takeProfit);
    if (Number.isFinite(tpPercent) && tpPercent > 0) {
      const tpMultiplier = tpPercent / 100;
      const tpPrice = side === 'LONG' ? price * (1 + tpMultiplier) : price * (1 - tpMultiplier);
      if (Number.isFinite(tpPrice) && tpPrice > 0) {
        payload.tpPrice = Number(tpPrice.toFixed(8));
      }
    }

    const slPercent = Number(data.stopLoss);
    if (Number.isFinite(slPercent) && slPercent > 0) {
      const slMultiplier = slPercent / 100;
      let slPrice = side === 'LONG' ? price * (1 - slMultiplier) : price * (1 + slMultiplier);
      slPrice = Math.max(slPrice, 0.00000001);
      if (Number.isFinite(slPrice) && slPrice > 0) {
        payload.slPrice = Number(slPrice.toFixed(8));
      }
    }

    setHasEquityError(false);
    mutation.mutate(payload);
  };

  const submitOrder = (sideOverride?: 'LONG' | 'SHORT') => {
    if (mutation.isPending) {
      return;
    }
    const now = Date.now();
    if (now - lastSubmitRef.current < 1000) {
      return;
    }
    lastSubmitRef.current = now;
    if (sideOverride) {
      form.setValue('side', sideOverride);
      setPendingSide(sideOverride);
    } else {
      setPendingSide(form.getValues('side'));
    }
    void form.handleSubmit(onSubmit)();
  };

  const handlePlaceOrder = () => {
    submitOrder();
  };

  const handleSideClick = (side: 'LONG' | 'SHORT') => {
    submitOrder(side);
  };

  const availablePairs = tradingPairs ?? [];
  const tradingDisabled = availablePairs.length === 0 || !userId;
  const isPending = mutation.isPending;
  const isFormDisabled = tradingDisabled || isPending;
  const mode = form.watch('mode');
  const watchedQty = form.watch('size');
  const watchedAmount = form.watch('amountUsd');

  useEffect(() => {
    if (!mutation.isPending) {
      setPendingSide(null);
    }
  }, [mutation.isPending]);

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

  useEffect(() => {
    setHasEquityError(false);
  }, [mode, watchedQty, watchedAmount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handlePlaceOrder();
            }}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="symbol"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Symbol</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isFormDisabled}>
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
                    <ToggleGroupItem value="QTY" aria-label="Quantity mode" disabled={isFormDisabled}>
                      Qty
                    </ToggleGroupItem>
                    <ToggleGroupItem value="USDT" aria-label="USDT mode" disabled={isFormDisabled}>
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
                        disabled={isFormDisabled}
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
                        disabled={isFormDisabled}
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
                    disabled={isFormDisabled}
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
                        disabled={isFormDisabled}
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
                        disabled={isFormDisabled}
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
                disabled={isFormDisabled}
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                {pendingSide === 'LONG' && isPending ? 'Submitting…' : 'Long'}
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
                disabled={isFormDisabled}
              >
                <TrendingDown className="mr-2 h-4 w-4" />
                {pendingSide === 'SHORT' && isPending ? 'Submitting…' : 'Short'}
              </Button>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={isPending || !form.getValues('symbol')}
              onClick={handlePlaceOrder}
              data-testid="button-place-order"
            >
              {isPending ? 'Placing Order...' : 'Place Order'}
            </Button>
            {hasEquityError && (
              <p className="text-sm text-red-500" role="alert">
                Nincs elegendő egyenleg a tranzakció végrehajtásához.
              </p>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
