import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { MoreVertical } from "lucide-react";
import { useClosedPositions, usePositions } from "@/hooks/useTradingData";
import { Position, PriceUpdate } from "@/types/trading";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPct, formatUsd, trendClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface PositionsProps {
  priceData: Map<string, PriceUpdate>;
}

export default function Positions({ priceData }: PositionsProps) {
  const { data: positions, isLoading } = usePositions();
  const { data: closedPositions, isLoading: isLoadingClosed } = useClosedPositions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRiskDialogOpen, setIsRiskDialogOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      await apiRequest("POST", `/api/trades/close`, { positionId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Position closed successfully",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/positions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions/closed"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to close position";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateRiskMutation = useMutation({
    mutationFn: async ({ id, tpPrice, slPrice }: { id: string; tpPrice: number | null; slPrice: number | null }) => {
      await apiRequest("PATCH", `/api/positions/${id}/risk`, { tpPrice, slPrice });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Risk targets updated",
        variant: "default",
      });
      setIsRiskDialogOpen(false);
      setEditingPosition(null);
      setTpInput("");
      setSlInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/positions/open"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update risk targets";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleClosePosition = (positionId: string) => {
    if (window.confirm("Are you sure you want to close this position?")) {
      closePositionMutation.mutate(positionId);
    }
  };

  const openRiskDialog = (position: Position) => {
    setEditingPosition(position);
    setTpInput(position.tpPrice != null ? String(position.tpPrice) : "");
    setSlInput(position.slPrice != null ? String(position.slPrice) : "");
    setIsRiskDialogOpen(true);
  };

  const closeRiskDialog = () => {
    setIsRiskDialogOpen(false);
    setEditingPosition(null);
    setTpInput("");
    setSlInput("");
  };

  const handleRiskSave = () => {
    if (!editingPosition) {
      return;
    }
    const parseField = (value: string): number | null | undefined => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) {
        toast({
          title: "Error",
          description: "Enter a valid numeric price",
          variant: "destructive",
        });
        return undefined;
      }
      return numeric;
    };

    const tpValue = parseField(tpInput);
    if (tpValue === undefined) {
      return;
    }
    const slValue = parseField(slInput);
    if (slValue === undefined) {
      return;
    }

    updateRiskMutation.mutate({
      id: editingPosition.id,
      tpPrice: tpValue,
      slPrice: slValue,
    });
  };

  const calculatePnL = (position: Position, currentPrice?: string) => {
    const entryPrice = Number(position.entryPrice ?? 0);
    const price = Number(currentPrice ?? position.currentPrice ?? 0);
    let qty = Number(position.qty ?? 0);

    if (!Number.isFinite(qty) || qty <= 0) {
      const sizeUsd = Number(position.amountUsd ?? position.sizeUsd ?? 0);
      if (Number.isFinite(sizeUsd) && sizeUsd > 0 && Number.isFinite(entryPrice) && entryPrice > 0) {
        qty = sizeUsd / entryPrice;
      }
    }

    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(price) || qty <= 0) {
      return 0;
    }

    if (position.side === "LONG") {
      return (price - entryPrice) * qty;
    }
    return (entryPrice - price) * qty;
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

  const formatQty = (value: string | number | undefined) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return '0.00000000';
    return numeric.toFixed(8);
  };

  const formatPrice = (value: string | number | null | undefined, digits: number = 4) => {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const numeric = Number(value);
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
                      <TableHead>Amount (USD)</TableHead>
                      <TableHead>Amount (qty)</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Current Price</TableHead>
                      <TableHead>P&amp;L (USD)</TableHead>
                      <TableHead>TP/SL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => {
                      const priceInfo = priceData.get(position.symbol);
                      const currentPrice = priceInfo?.price ?? position.currentPrice ?? position.entryPrice;
                      const entryPriceValue = Number(position.entryPrice ?? 0);
                      let amountUsdValue = Number(position.amountUsd ?? position.sizeUsd ?? 0);
                      const qtyValue = Number(position.qty ?? 0);
                      if (!Number.isFinite(amountUsdValue) || amountUsdValue <= 0) {
                        if (Number.isFinite(qtyValue) && qtyValue > 0 && Number.isFinite(entryPriceValue) && entryPriceValue > 0) {
                          amountUsdValue = qtyValue * entryPriceValue;
                        }
                      }
                      const pnl = calculatePnL(position, priceInfo?.price ?? currentPrice);
                      const pnlColor = trendClass(pnl);
                      const tpDisplay = formatPrice(position.tpPrice, 2);
                      const slDisplay = formatPrice(position.slPrice, 2);
                      const hasTp = tpDisplay !== '—';
                      const hasSl = slDisplay !== '—';

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
                          <TableCell className="font-mono">{formatCurrency(amountUsdValue)}</TableCell>
                          <TableCell className="font-mono">{formatQty(position.qty)}</TableCell>
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
                          <TableCell>
                            {hasTp || hasSl ? (
                              <div className="flex flex-col gap-1">
                                {hasTp && <Badge variant="outline">TP: {tpDisplay}</Badge>}
                                {hasSl && <Badge variant="outline">SL: {slDisplay}</Badge>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openRiskDialog(position)}>
                                  Edit TP/SL
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleClosePosition(position.id)}
                                  disabled={closePositionMutation.isPending}
                                  className="text-destructive"
                                >
                                  Close position
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
      <Dialog
        open={isRiskDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeRiskDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit TP/SL</DialogTitle>
            {editingPosition ? (
              <p className="text-sm text-muted-foreground">
                {editingPosition.symbol} · {editingPosition.side}
              </p>
            ) : null}
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Update take profit and stop loss prices. Leave a field empty to remove the target.
            </p>
            <div className="grid gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">TP Price</label>
                <Input
                  value={tpInput}
                  onChange={(event) => setTpInput(event.target.value)}
                  placeholder="e.g. 2500"
                  disabled={updateRiskMutation.isPending}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">SL Price</label>
                <Input
                  value={slInput}
                  onChange={(event) => setSlInput(event.target.value)}
                  placeholder="e.g. 2200"
                  disabled={updateRiskMutation.isPending}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRiskDialog} disabled={updateRiskMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleRiskSave} disabled={updateRiskMutation.isPending || !editingPosition}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
