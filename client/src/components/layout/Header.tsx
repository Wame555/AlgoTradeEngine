import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAccount, useTradingPairs } from "@/hooks/useTradingData";
import { useSession } from "@/hooks/useSession";

interface HeaderProps {
  isConnected: boolean;
}

export function Header({ isConnected }: HeaderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;

  const { data: account } = useAccount();
  const { data: tradingPairs } = useTradingPairs();

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const activePairs = useMemo(() => {
    return tradingPairs?.filter((pair) => pair.isActive).length ?? 0;
  }, [tradingPairs]);

  const openPnL = useMemo(() => {
    if (!account) return 0;
    return account.equity - account.balance;
  }, [account]);

  const formatCurrency = (value?: number) => {
    if (value == null || Number.isNaN(value)) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPnL = (value?: number) => {
    if (value == null || Number.isNaN(value)) return "-";
    const formatted = formatCurrency(Math.abs(value));
    const prefix = value >= 0 ? "+" : "-";
    return `${prefix}${formatted}`;
  };

  const closeAllMutation = useMutation({
    mutationFn: async () => {
      if (!userId) {
        throw new Error("Missing user context");
      }
      await apiRequest("POST", `/api/positions/${userId}/close-all`);
    },
   onSuccess: () => {
     toast({
       title: "Success",
       description: "All positions have been closed",
       variant: "default",
     });
     if (userId) {
       queryClient.invalidateQueries({ queryKey: ['/api/positions', userId] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/summary'] });
     }
      queryClient.invalidateQueries({ queryKey: ['/api/account'] });
   },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close all positions",
        variant: "destructive",
      });
    },
  });

  const handleCloseAll = () => {
    if (!userId) {
      toast({
        title: "Missing user",
        description: "User session is not ready yet.",
        variant: "destructive",
      });
      return;
    }

    if (window.confirm("Are you sure you want to close all positions?")) {
      closeAllMutation.mutate();
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center space-x-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="header-title">Crypto Modular Bot</h1>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <span className="flex items-center" data-testid="connection-indicator">
              <span className={`mr-2 h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span>•</span>
            <span data-testid="active-pairs">{activePairs} Pairs Active</span>
            <span>•</span>
            <span data-testid="current-time">
              {currentTime.toLocaleTimeString('en-US', {
                timeZone: 'UTC',
                hour12: false,
              })} UTC
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total Balance</div>
          <div className="font-mono text-lg font-semibold" data-testid="total-balance">
            {formatCurrency(account?.balance)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Equity</div>
          <div className="font-mono text-lg font-semibold" data-testid="account-equity">
            {formatCurrency(account?.equity)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Open P&amp;L</div>
          <div
            className={`font-mono text-lg font-semibold ${openPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}
            data-testid="daily-pnl"
          >
            {formatPnL(openPnL)}
          </div>
        </div>
        <Button
          variant="destructive"
          onClick={handleCloseAll}
          disabled={closeAllMutation.isPending || !userId}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          data-testid="button-close-all"
        >
          <StopCircle className="mr-2 h-4 w-4" />
          {closeAllMutation.isPending ? 'Closing...' : 'Close All'}
        </Button>
      </div>
    </header>
  );
}
