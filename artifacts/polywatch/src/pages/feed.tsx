import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { 
  useGetWhaleTrades, 
  getGetWhaleTradesQueryKey,
  useGetWhaleStats,
  getGetWhaleStatsQueryKey,
  useGetBotConfig,
  getGetBotConfigQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { formatCurrency, formatTimeAgo, truncateAddress, getRiskColorClass, getAgeColorClass, cn } from "@/lib/utils";
import { Activity, ShieldAlert, Wallet, Repeat2, Zap, Bell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StreamTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  usdcSize: number;
  timestamp: number;
  title: string;
  outcome: string;
  transactionHash: string;
  name?: string | null;
  pseudonym?: string | null;
  profileImage?: string | null;
  riskScore?: number | null;
  walletAgeDays?: number | null;
  conditionId?: string | null;
  slug?: string | null;
  icon?: string | null;
  size: number;
  price: number;
}

export default function Feed() {
  const qc = useQueryClient();
  const [streamActive, setStreamActive] = useState(false);
  const [newTradeCount, setNewTradeCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const { data: botConfig } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey() },
  });

  // SSE connection for real-time trades
  useEffect(() => {
    const es = new EventSource(`${BASE_URL}/api/stream`);
    esRef.current = es;

    es.onopen = () => setStreamActive(true);
    es.onerror = () => setStreamActive(false);

    es.onmessage = (event) => {
      try {
        const newTrades: StreamTrade[] = JSON.parse(event.data);
        if (!Array.isArray(newTrades) || newTrades.length === 0) return;

        const whales = newTrades.filter((t) => t.usdcSize >= 1000);

        // Invalidate query so the feed refreshes
        if (whales.length > 0) {
          qc.invalidateQueries({ queryKey: getGetWhaleTradesQueryKey({ limit: 50 }) });
          qc.invalidateQueries({ queryKey: getGetWhaleStatsQueryKey() });
          setNewTradeCount((c) => c + whales.length);
        }

        // Show toast for every new whale trade
        for (const t of whales.slice(0, 3)) {
          const name = t.name || t.pseudonym || truncateAddress(t.proxyWallet);
          toast(
            `${t.side === "BUY" ? "🟢" : "🔴"} ${name} — ${formatCurrency(t.usdcSize)}`,
            {
              description: `${t.side} ${t.outcome} · ${t.title}`,
              duration: 5000,
            }
          );
        }

        // Bot alert: check if any of the new trades match the watched wallet
        if (botConfig?.enabled && botConfig.targetWallet) {
          const matching = newTrades.filter(
            (t) => t.proxyWallet.toLowerCase() === botConfig.targetWallet.toLowerCase() &&
              t.usdcSize >= botConfig.minTradeSize &&
              t.usdcSize <= botConfig.maxTradeSize
          );
          for (const t of matching) {
            toast.warning(`🤖 BOT SIGNAL — ${t.side} ${t.outcome}`, {
              description: `${formatCurrency(t.usdcSize)} · ${t.title}`,
              duration: 8000,
            });
          }
        }
      } catch { /* ignore parse errors */ }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [qc, botConfig?.enabled, botConfig?.targetWallet, botConfig?.minTradeSize, botConfig?.maxTradeSize]);

  const { data: trades, isLoading: tradesLoading } = useGetWhaleTrades(
    { limit: 50 }, 
    { query: { queryKey: getGetWhaleTradesQueryKey({ limit: 50 }), refetchInterval: 30000 } }
  );
  
  const { data: stats, isLoading: statsLoading } = useGetWhaleStats(
    { query: { queryKey: getGetWhaleStatsQueryKey(), refetchInterval: 30000 } }
  );

  const walletTradeCount = new Map<string, number>();
  for (const t of trades ?? []) {
    walletTradeCount.set(t.proxyWallet, (walletTradeCount.get(t.proxyWallet) ?? 0) + 1);
  }
  const repeatBettorCount = [...walletTradeCount.values()].filter((c) => c >= 2).length;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            title="24H VOLUME" 
            value={statsLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(stats?.totalVolumeUsdc || 0)} 
          />
          <StatCard 
            title="WHALE TRADES" 
            value={statsLoading ? <Skeleton className="h-8 w-16" /> : stats?.tradeCount || 0} 
          />
          <StatCard 
            title="UNIQUE WALLETS" 
            value={statsLoading ? <Skeleton className="h-8 w-16" /> : stats?.uniqueWallets || 0} 
          />
          <StatCard 
            title="REPEAT BETTORS"
            value={tradesLoading ? <Skeleton className="h-8 w-16" /> : repeatBettorCount}
            alert={repeatBettorCount > 0}
            hint="Wallets betting on 2+ markets in this feed"
          />
        </div>

        <div>
          <div className="flex justify-between items-end mb-4 flex-wrap gap-2">
            <h2 className="text-xl font-mono font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              LIVE FEED
            </h2>
            <div className="flex items-center gap-3">
              {newTradeCount > 0 && (
                <button
                  onClick={() => setNewTradeCount(0)}
                  className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-primary"
                >
                  <Zap className="h-2.5 w-2.5" />
                  +{newTradeCount} new
                </button>
              )}
              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", streamActive ? "bg-primary" : "bg-yellow-500")}></span>
                  <span className={cn("relative inline-flex rounded-full h-2 w-2", streamActive ? "bg-primary" : "bg-yellow-500")}></span>
                </span>
                {streamActive ? "SSE LIVE" : "CONNECTING..."}
              </div>
              {botConfig?.enabled && (
                <div className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary">
                  <Bell className="h-2.5 w-2.5" />
                  BOT ON
                </div>
              )}
            </div>
          </div>

          {tradesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {trades?.map((trade, i) => {
                const isRepeat = (walletTradeCount.get(trade.proxyWallet) ?? 0) >= 2;
                return (
                  <div 
                    key={trade.transactionHash} 
                    className={cn(
                      "flex flex-col md:flex-row md:items-center justify-between p-4 rounded-md border bg-card transition-all hover:border-primary/50 animate-in fade-in slide-in-from-bottom-2",
                      trade.side === "BUY" ? "border-l-4 border-l-primary" : "border-l-4 border-l-secondary",
                      isRepeat && "ring-1 ring-yellow-500/30"
                    )}
                    style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={cn(
                          "text-xs font-mono font-bold px-2 py-0.5 rounded",
                          trade.side === "BUY" ? "bg-primary/20 text-primary" : "bg-secondary/20 text-secondary"
                        )}>
                          {trade.side} {trade.outcome}
                        </span>
                        {isRepeat && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-yellow-500/50 bg-yellow-500/10 text-yellow-400 flex items-center gap-1">
                            <Repeat2 className="h-2.5 w-2.5" />
                            REPEAT BETTOR
                          </span>
                        )}
                        <span className="text-sm font-mono text-muted-foreground truncate" title={trade.title}>
                          {trade.title}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <Link href={`/wallet/${trade.proxyWallet}`} className="text-sm font-mono hover:text-primary transition-colors flex items-center gap-1.5">
                          {trade.profileImage ? (
                            <img src={trade.profileImage} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                          ) : (
                            <Wallet className="h-3 w-3" />
                          )}
                          {trade.name || trade.pseudonym || truncateAddress(trade.proxyWallet)}
                        </Link>
                        
                        {trade.walletAgeDays !== undefined && trade.walletAgeDays !== null && (
                          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", getAgeColorClass(trade.walletAgeDays))}>
                            {trade.walletAgeDays}d old
                          </span>
                        )}
                        
                        {trade.riskScore !== undefined && trade.riskScore !== null && (
                          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1", getRiskColorClass(trade.riskScore), trade.riskScore >= 80 ? "risk-critical-pulse" : "")}>
                            <ShieldAlert className="h-2 w-2" />
                            RISK: {trade.riskScore}
                          </span>
                        )}

                        {walletTradeCount.get(trade.proxyWallet) !== undefined && walletTradeCount.get(trade.proxyWallet)! >= 2 && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {walletTradeCount.get(trade.proxyWallet)} bets in feed
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-3 md:mt-0 flex md:flex-col items-center md:items-end justify-between md:justify-center shrink-0">
                      <div className={cn(
                        "font-mono text-lg font-bold",
                        trade.side === "BUY" ? "text-primary" : "text-secondary"
                      )}>
                        {formatCurrency(trade.usdcSize)}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {formatTimeAgo(trade.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {(!trades || trades.length === 0) && (
                <div className="p-8 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">
                  No whale trades detected recently.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ title, value, alert = false, hint }: { title: string; value: React.ReactNode; alert?: boolean; hint?: string }) {
  return (
    <div className={cn("bg-card border border-border p-4 rounded-lg flex flex-col justify-center", alert && "border-yellow-500/40 bg-yellow-500/5")} title={hint}>
      <div className={cn("text-xs font-mono mb-2", alert ? "text-yellow-400" : "text-muted-foreground")}>{title}</div>
      <div className={cn("text-2xl font-mono font-bold", alert ? "text-yellow-400" : "text-foreground")}>{value}</div>
    </div>
  );
}
