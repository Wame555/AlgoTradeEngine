import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "./lib/queryClient";
import { SessionProvider } from "@/hooks/useSession";
import { useWebSocket } from "@/hooks/useWebSocket";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { TabNavigation } from "@/components/layout/TabNavigation";

import Dashboard from "@/pages/Dashboard";
import Positions from "@/pages/Positions";
import Signals from "@/pages/Signals";
import PairAnalysis from "@/pages/PairAnalysis";
import Settings from "@/pages/Settings";
import TelegramSetup from "@/pages/TelegramSetup";

type TabType = "dashboard" | "positions" | "signals" | "analysis" | "settings" | "telegram";

function Router() {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const { isConnected, priceData } = useWebSocket();

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <Dashboard priceData={priceData} />;
      case "positions":
        return <Positions priceData={priceData} />;
      case "signals":
        return <Signals />;
      case "analysis":
        return <PairAnalysis priceData={priceData} />;
      case "settings":
        return <Settings />;
      case "telegram":
        return <TelegramSetup />;
      default:
        return <Dashboard priceData={priceData} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} isConnected={isConnected} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header isConnected={isConnected} />
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="flex-1 overflow-auto">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider>
          <Router />
          <Toaster />
        </SessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
