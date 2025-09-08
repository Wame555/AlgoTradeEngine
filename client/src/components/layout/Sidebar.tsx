import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  BarChart3, 
  Wallet, 
  Signal, 
  Microscope, 
  Settings, 
  MessageCircle,
  Bot
} from "lucide-react";

type TabType = 'dashboard' | 'positions' | 'signals' | 'analysis' | 'settings' | 'telegram';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  isConnected: boolean;
}

export function Sidebar({ activeTab, onTabChange, isConnected }: SidebarProps) {
  const navItems = [
    { key: 'dashboard' as TabType, icon: BarChart3, label: 'Dashboard' },
    { key: 'positions' as TabType, icon: Wallet, label: 'Positions' },
    { key: 'signals' as TabType, icon: Signal, label: 'Signals' },
    { key: 'analysis' as TabType, icon: Microscope, label: 'Analysis' },
    { key: 'settings' as TabType, icon: Settings, label: 'Settings' },
    { key: 'telegram' as TabType, icon: MessageCircle, label: 'Telegram' },
  ];

  return (
    <div className="w-16 bg-card border-r border-border flex flex-col items-center py-4 space-y-4">
      {/* Logo */}
      <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center" data-testid="logo">
        <Bot className="text-primary-foreground text-lg" />
      </div>
      
      {/* Navigation */}
      <nav className="flex flex-col space-y-2">
        {navItems.map((item) => (
          <Tooltip key={item.key}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`w-10 h-10 rounded-lg ${
                  activeTab === item.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                onClick={() => onTabChange(item.key)}
                data-testid={`nav-${item.key}`}
              >
                <item.icon className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Connection Status */}
      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`} 
              data-testid="connection-status"
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            {isConnected ? 'Connected' : 'Disconnected'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
