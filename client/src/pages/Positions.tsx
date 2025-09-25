import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Edit } from "lucide-react";
import { useClosedPositions, usePositions } from "@/hooks/useTradingData";
import { PriceUpdate } from "@/types/trading";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEFRAMES } from "@/constants/timeframes";
import type { Timeframe } from "@/types/trading";
import { formatPct, formatUsd, trendClass } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PositionsProps {
  priceData: Map<string, PriceUpdate>;
}

export default function Positions({ priceData }: PositionsProps) {
  const { data: positions, isLoading } = usePositions();
  const { data: closedPositions, isLoading: isLoadingClosed } = useClosedPositions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTimeframes, setSelectedTimeframes] = useState<Record<string, Timeframe>>({});
  const defaultTimeframe: Timeframe = "1d";

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      await apiRequest('POST', `/api/trades/close`, { positionId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position closed successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions/open'] });
      queryClient.invalidateQueries({ queryKey: ['/api/positions/closed'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close position",
        variant: "destructive",
      });
    },
  });

  const handleClosePosition = (positionId: string) => {
    if (window.confirm('Are you sure you want to close this position?')) {
      closePositionMutation.mutate(positionId);
    }
  };

  const handleTimeframeChange = (positionId: string, value: string) => {
    if ((TIMEFRAMES as readonly string[]).includes(value)) {
      setSelectedTimeframes((prev) => ({
        ...prev,
        [positionId]: value as Timeframe,
      }));
    }
  };

  const calculatePnL = (position: any, currentPrice?: string) => {
    if (!currentPrice) {
      const stored = Number(position.pnl ?? 0);
      return Number.isFinite(stored) ? stored : 0;
    }

    const entryPrice = parseFloat(position.entryPrice);
    const price = parseFloat(currentPrice);
    const size = parseFloat(position.size);

    if (!Number.isFinite(entryPrice) || !Number.isFinite(price) || !Number.isFinite(size)) {
      return 0;
    }

    if (position.side === 'LONG') {
      return (price - entryPrice) * size;
    }
    return (entryPrice - price) * size;
  };

  const formatPnL = (pnl: number) => {
    if (!Number.isFinite(pnl)) return '—';
    const absolute = Math.abs(pnl);
    const formatted = formatUsd(absolute);
    if (pnl > 0) return `+$${formatted}`;
    if (pnl < 0) return `-$${formatted}`;
    return `$${formatted}`;
  };

  const formatPnLPercent = (pct: number) => {
    if (!Number.isFinite(pct)) return '—';
    const formatted = formatPct(pct);
    return pct > 0 ? `+${formatted}` : formatted;
  };

  const formatCurrency = (value: string | number | undefined) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return '—';
    return `$${formatUsd(numeric)}`;
  };

  const formatPrice = (value: string | number | undefined, digits: number = 4) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return '—';
    return `$${numeric.toFixed(digits)}`;
  };

  const formatDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return '—';
    }
    const diffMs = Math.max(endDate.getTime() - startDate.getTime(), 0);
    const minutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const seconds = Math.floor((diffMs % (60 * 1000)) / 1000);

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="positions-title">Open Positions</h2>
          <p className="text-muted-foreground">
            {positions?.length || 0} active position{positions?.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <Tabs defaultValue="open" className="space-y-6">
        <TabsList>
          <TabsTrigger value="open">Open Positions</TabsTrigger>
          <TabsTrigger value="closed">Closed Positions</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-muted rounded-lg" />
              ))}
            </div>
          ) : !positions || positions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    📊
                  </div>
                  <h3 className="text-lg font-medium mb-2">No Open Positions</h3>
                  <p className="text-sm">Start trading by opening a position from the Dashboard or Analysis tabs.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Current Price</TableHead>
                      <TableHead>P&amp;L</TableHead>
                      <TableHead className="text-right">TF % / P&amp;L</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => {
                      const priceInfo = priceData.get(position.symbol);
                      const currentPrice = priceInfo?.price ?? position.currentPrice ?? position.entryPrice;
                      const pnl = calculatePnL(position, priceInfo?.price);
                      const pnlColor = trendClass(pnl);
                      const timeframe = selectedTimeframes[position.id] ?? defaultTimeframe;
                      const changeValue = Number(position.changePctByTimeframe?.[timeframe] ?? 0);
                      const pnlValue = Number(position.pnlByTimeframe?.[timeframe] ?? 0);
                      const timeframeClass = trendClass(changeValue);

                      return (
                        <TableRow key={position.id}>
                          <TableCell className="font-medium" data-testid={`position-symbol-${position.id}`}>
                            {position.symbol}
                          </TableCell>
                          <TableCell data-testid={`position-side-${position.id}`}>
                            <Badge
                              variant={position.side === 'LONG' ? 'default' : 'destructive'}
                              className={position.side === 'LONG' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}
                            >
                              {position.side}
                            </Badge>
                          </TableCell>
                          <TableCell>{position.size}</TableCell>
                          <TableCell className="font-mono">{formatPrice(position.entryPrice)}</TableCell>
                          <TableCell className="font-mono" data-testid={`position-price-${position.id}`}>
                            {formatPrice(currentPrice)}
                          </TableCell>
                          <TableCell
                            className={cn('font-mono', pnlColor)}
                            data-testid={`position-pnl-${position.id}`}
                          >
                            {formatPnL(pnl)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Select
                                value={timeframe}
                                onValueChange={(value) => handleTimeframeChange(position.id, value)}
                              >
                                <SelectTrigger className="h-8 w-[88px] text-xs">
                                  <SelectValue placeholder="TF" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIMEFRAMES.map((tf) => (
                                    <SelectItem key={tf} value={tf} className="text-xs">
                                      {tf}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <span className={cn('font-mono text-sm', timeframeClass)}>
                                {`${formatPct(changeValue)} | ${formatUsd(pnlValue)} $`}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-edit-${position.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleClosePosition(position.id)}
                                disabled={closePositionMutation.isPending}
                                data-testid={`button-close-${position.id}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="closed">
          {isLoadingClosed ? (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
          ) : !closedPositions || closedPositions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    📘
                  </div>
                  <h3 className="text-lg font-medium mb-2">No Closed Positions</h3>
                  <p className="text-sm">Closed positions will appear here once trades are completed.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Closed At</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>P&amp;L $</TableHead>
                      <TableHead>P&amp;L %</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedPositions.map((position) => {
                      const pnlUsd = Number(position.pnlUsd ?? 0);
                      const pnlPct = position.pnlPct ?? 0;
                      const pnlColor = pnlUsd >= 0 ? 'text-green-500' : 'text-red-500';
                      return (
                        <TableRow key={position.id}>
                          <TableCell>{new Date(position.closedAt).toLocaleString()}</TableCell>
                          <TableCell className="font-medium">{position.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={position.side === 'LONG' ? 'default' : 'destructive'}>
                              {position.side}
                            </Badge>
                          </TableCell>
                          <TableCell>{position.size}</TableCell>
                          <TableCell className="font-mono">{formatPrice(position.entryPrice)}</TableCell>
                          <TableCell className="font-mono">{formatPrice(position.exitPrice)}</TableCell>
                          <TableCell className={`font-mono ${pnlColor}`}>{formatPnL(pnlUsd)}</TableCell>
                          <TableCell className={`font-mono ${pnlColor}`}>{formatPnLPercent(pnlPct)}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(position.feeUsd)}</TableCell>
                          <TableCell>{formatDuration(position.openedAt, position.closedAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
