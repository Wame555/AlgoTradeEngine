import { Button } from "@/components/ui/button";
import { StopCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface HeaderProps {
  isConnected: boolean;
}

const MOCK_USER_ID = 'mock-user-123';

export function Header({ isConnected }: HeaderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const closeAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', `/api/positions/${MOCK_USER_ID}/close-all`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "All positions have been closed",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close all positions",
        variant: "destructive",
      });
    },
  });

  const handleCloseAll = () => {
    if (window.confirm('Are you sure you want to close all positions?')) {
      closeAllMutation.mutate();
    }
  };

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
      <div className="flex items-center space-x-4">
        <h1 className="text-xl font-semibold" data-testid="header-title">Crypto Modular Bot</h1>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <span className="flex items-center" data-testid="connection-indicator">
            <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span>•</span>
          <span data-testid="active-pairs">15 Pairs Active</span>
          <span>•</span>
          <span data-testid="current-time">
            {currentTime.toLocaleTimeString('en-US', { 
              timeZone: 'UTC', 
              hour12: false 
            })} UTC
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total Balance</div>
          <div className="text-lg font-semibold font-mono" data-testid="total-balance">
            $12,450.67
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">24h P&L</div>
          <div className="text-lg font-semibold font-mono text-green-500" data-testid="daily-pnl">
            +$234.12
          </div>
        </div>
        <Button
          variant="destructive"
          onClick={handleCloseAll}
          disabled={closeAllMutation.isPending}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          data-testid="button-close-all"
        >
          <StopCircle className="w-4 h-4 mr-2" />
          {closeAllMutation.isPending ? 'Closing...' : 'Close All'}
        </Button>
      </div>
    </header>
  );
}
