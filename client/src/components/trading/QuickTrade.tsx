import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { SUPPORTED_PAIRS } from "@/types/trading";

const MOCK_USER_ID = 'mock-user-123';

const tradeFormSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  side: z.enum(['LONG', 'SHORT']),
  size: z.string().min(1, "Size is required").refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Size must be a positive number"
  }),
  leverage: z.number().min(1).max(20),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
});

type TradeForm = z.infer<typeof tradeFormSchema>;

export function QuickTrade() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<TradeForm>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: {
      symbol: SUPPORTED_PAIRS[0],
      side: 'LONG',
      size: '0.01',
      leverage: 1,
      stopLoss: '',
      takeProfit: '',
    },
  });

  const createPositionMutation = useMutation({
    mutationFn: async (data: TradeForm) => {
      const positionData = {
        userId: MOCK_USER_ID,
        symbol: data.symbol,
        side: data.side,
        size: data.size,
        entryPrice: '0', // Will be filled by the server
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
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open position",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TradeForm) => {
    createPositionMutation.mutate(data);
  };

  const handleSideClick = (side: 'LONG' | 'SHORT') => {
    form.setValue('side', side);
  };

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
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-symbol">
                        <SelectValue placeholder="Select symbol" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_PAIRS.map((symbol) => (
                        <SelectItem key={symbol} value={symbol}>
                          {symbol}
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
                <TrendingUp className="w-4 h-4 mr-2" />
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
                <TrendingDown className="w-4 h-4 mr-2" />
                Short
              </Button>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={createPositionMutation.isPending}
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
