import { Button } from "@/components/ui/button";

type TabType = 'dashboard' | 'positions' | 'signals' | 'analysis' | 'settings' | 'telegram';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const tabs = [
    { key: 'dashboard' as TabType, label: 'Dashboard' },
    { key: 'positions' as TabType, label: 'Positions' },
    { key: 'signals' as TabType, label: 'Signals' },
    { key: 'analysis' as TabType, label: 'Pair Analysis' },
    { key: 'settings' as TabType, label: 'Settings' },
    { key: 'telegram' as TabType, label: 'Telegram Setup' },
  ];

  return (
    <div className="bg-card border-b border-border">
      <nav className="flex px-6">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant="ghost"
            className={`px-4 py-3 text-sm font-medium rounded-none border-b-2 ${
              activeTab === tab.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            onClick={() => onTabChange(tab.key)}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
    </div>
  );
}
