import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "sonner";
import NotFound from "@/pages/not-found";
import Feed from "@/pages/feed";
import Markets from "@/pages/markets";
import WalletProfile from "@/pages/wallet";
import BotPage from "@/pages/bot";
import SignalsPage from "@/pages/signals";
import TradingPage from "@/pages/trading";
import PortfolioPage from "@/pages/portfolio";
import LeaderboardPage from "@/pages/leaderboard";
import RewardsPage from "@/pages/rewards";
import EmbedPage from "@/pages/embed";
import EventsPage from "@/pages/events";
import PerpsPage from "@/pages/perps";
import TraderLeaderboardPage from "@/pages/trader-leaderboard";
import { getAdminToken } from "@/lib/adminAuth";

const queryClient = new QueryClient();

// Fund-risk endpoints (bot config, order cancellation, etc.) require this
// admin token — attach it to every generated API call automatically so
// individual pages don't each need to remember to send it.
setAuthTokenGetter(() => getAdminToken());

function Router() {
  return (
    <Switch>
      <Route path="/" component={Feed} />
      <Route path="/markets" component={Markets} />
      <Route path="/events" component={EventsPage} />
      <Route path="/perps" component={PerpsPage} />
      <Route path="/wallet/:address" component={WalletProfile} />
      <Route path="/bot" component={BotPage} />
      <Route path="/signals" component={SignalsPage} />
      <Route path="/trading" component={TradingPage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route path="/leaderboard" component={LeaderboardPage} />
      <Route path="/trader-leaderboard" component={TraderLeaderboardPage} />
      <Route path="/rewards" component={RewardsPage} />
      <Route path="/embed" component={EmbedPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <Sonner richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
