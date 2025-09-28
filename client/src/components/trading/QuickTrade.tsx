import React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
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
import { http } from "@/lib/http";
import type { InputMode, OrderType, QuickTradeResponse, Side } from "@shared/types/trade";
import { buildQuickTrade } from "../../../../frontend/lib/buildQuickTrade";

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
  const [pending, setPending] = useState(false);
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

  React.useEffect(() => {
    console.log("[QuickTrade] mounted");
  }, []);

  useEffect(() => {
    http
      .get<Record<string, unknown>>("/healthz")
      .then(() => {
        console.log("[QuickTrade] /healthz ok");
      })
      .catch((error) => {
        console.warn("[QuickTrade] /healthz failed", error);
      });
  }, []);

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

  const notify = React.useMemo(
    () => ({
      success: (message: string) =>
        toast({
          title: "Success",
          description: message,
        }),
      error: (message: string) =>
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        }),
    }),
    [toast],
  );

  const mode = (form.watch('mode') as InputMode) ?? 'QTY';
  const quantity = form.watch('size');
  const usdtAmount = form.watch('amountUsd');
  const symbolValue = form.watch('symbol');
  const sideSelection = form.watch('side');
  const orderSide: Side = sideSelection === 'SHORT' ? 'SELL' : 'BUY';
  const orderType: OrderType = 'MARKET';
  const symbol = symbolValue?.trim()?.toUpperCase() ?? '';
  const lastPrice = symbol ? getLastPrice(symbol) : null;

  const lotStep = React.useMemo(() => {
    if (!symbol) {
      return null;
    }
    const pair = tradingPairs?.find((item) => item?.symbol?.toUpperCase() === symbol);
    if (!pair) {
      return null;
    }
    const step = typeof pair.stepSize === 'string' ? Number(pair.stepSize) : null;
    if (step && Number.isFinite(step) && step > 0) {
      return step;
    }
    const minQty = typeof pair.minQty === 'string' ? Number(pair.minQty) : null;
    if (minQty && Number.isFinite(minQty) && minQty > 0) {
      return minQty;
    }
    return null;
  }, [tradingPairs, symbol]);

  const availablePairs = tradingPairs ?? [];
  const tradingDisabled = availablePairs.length === 0 || !userId;
  const isFormDisabled = tradingDisabled || pending;

  const onQuickTradeSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    console.log("[QuickTrade] submit clicked");

    if (pending) {
      return;
    }

    if (!userId) {
      toast({ title: "Missing user", description: "User session is not ready yet.", variant: "destructive" });
      return;
    }

    if (!symbol) {
      toast({ title: "Select symbol", description: "Choose a trading pair before placing an order.", variant: "destructive" });
      return;
    }

    const now = Date.now();
    if (now - lastSubmitRef.current < 1000) {
      return;
    }
    lastSubmitRef.current = now;

    if (mode === 'QTY') {
      if (!String(quantity ?? '').trim()) {
        toast({ title: "Invalid size", description: "Enter a valid position size.", variant: "destructive" });
        lastSubmitRef.current = 0;
        return;
      }
    } else {
      if (!String(usdtAmount ?? '').trim()) {
        toast({ title: "Invalid amount", description: "Enter a valid USDT amount.", variant: "destructive" });
        lastSubmitRef.current = 0;
        return;
      }
      if (!lastPrice || lastPrice <= 0) {
        toast({ title: "No price", description: "Live price is unavailable for the selected symbol", variant: "destructive" });
        lastSubmitRef.current = 0;
        return;
      }
    }

    const payload = buildQuickTrade({
      symbol,
      side: orderSide,
      type: orderType,
      mode,
      qtyInput: quantity,
      usdtInput: usdtAmount,
      price: null,
      lastPrice,
      qtyStep: lotStep || 1e-8,
    });

    if (!payload.quantity || payload.quantity <= 0) {
      toast({ title: "Invalid quantity", description: "Unable to determine order quantity.", variant: "destructive" });
      lastSubmitRef.current = 0;
      return;
    }

    const usedPrice = payload.price ?? lastPrice ?? null;
    const derivedQuote = payload.quoteAmount ?? (usedPrice && payload.quantity ? payload.quantity * usedPrice : null);
    const requiredUsd = typeof derivedQuote === 'number' && Number.isFinite(derivedQuote) ? derivedQuote : null;
    const equity = Number(statsSummary?.equity ?? 0);
    if (requiredUsd && Number.isFinite(requiredUsd) && Number.isFinite(equity) && requiredUsd > equity) {
      setHasEquityError(true);
      toast({
        title: "Nincs elegendő egyenleg",
        description: "A szükséges fedezet meghaladja a rendelkezésre álló equity-t.",
        variant: "destructive",
      });
      lastSubmitRef.current = 0;
      return;
    }

    setHasEquityError(false);
    setPending(true);
    setPendingSide(form.getValues('side'));

    console.log("[QuickTrade] payload", payload);

    try {
      const resp = await fetch("/api/quick-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as QuickTradeResponse;
      console.log("[QuickTrade] response", resp.status, data);

      if (resp.ok && data?.ok) {
        notify?.success?.(`Order placed (${data.requestId})`) ?? console.log("Order placed");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['/api/positions/open'] }),
          queryClient.invalidateQueries({ queryKey: ['/api/stats/summary'] }),
        ]);
      } else {
        const messageRaw = data?.message ?? "Order failed";
        const messageText = typeof messageRaw === 'string' ? messageRaw : String(messageRaw);
        if (messageText.toLowerCase().includes("insufficient equity")) {
          setHasEquityError(true);
          toast({
            title: 'Nincs elegendő egyenleg',
            description: 'A szükséges fedezet meghaladja a rendelkezésre álló equity-t.',
            variant: 'destructive',
          });
          console.error("Order failed - insufficient equity");
        } else {
          notify?.error?.(messageText) ?? console.error("Order failed");
        }
      }
    } catch (err: any) {
      notify?.error?.(err?.message ?? "Network error") ?? console.error(err);
    } finally {
      setPending(false);
      setPendingSide(null);
      lastSubmitRef.current = 0;
    }
  };

  const handleSideClick = (side: 'LONG' | 'SHORT') => {
    form.setValue('side', side);
    void onQuickTradeSubmit();
  };

  const submitDisabled =
    !symbolValue?.toString().trim() || (!String(quantity ?? '').trim() && !String(usdtAmount ?? '').trim()) || pending === true;

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
  }, [mode, quantity, usdtAmount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form noValidate onSubmit={onQuickTradeSubmit} className="space-y-4">
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
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
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
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
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
                {pendingSide === 'LONG' && pending ? 'Submitting…' : 'Long'}
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
                {pendingSide === 'SHORT' && pending ? 'Submitting…' : 'Short'}
              </Button>
            </div>

            <Button
              id="qt-place-order"
              data-qa="quick-trade-submit"
              type="submit"
              className="w-full"
              disabled={submitDisabled}
              onClick={onQuickTradeSubmit}
              data-testid="button-place-order"
            >
              {pending ? 'Placing Order...' : 'Place Order'}
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
