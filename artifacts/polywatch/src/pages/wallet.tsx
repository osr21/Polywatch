import { useMemo } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetWalletProfile, getGetWalletProfileQueryKey,
  useGetWalletPositions, getGetWalletPositionsQueryKey,
  useGetWalletTrades, getGetWalletTradesQueryKey
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, formatTimeAgo, truncateAddress, getRiskColorClass, cn } from "@/lib/utils";
import { Activity, ShieldAlert, Wallet, ExternalLink, ArrowRightLeft, Briefcase, Clock, BarChart2, Calendar, TrendingUp, Hash, Star, BadgeCheck, Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function WalletProfile() {
  const { address } = useParams<{ address: string }>();

  const { data: profile, isLoading: profileLoading, error: profileError } = useGetWalletProfile(
    address || "",
    { query: { queryKey: getGetWalletProfileQueryKey(address || ""), enabled: !!address, retry: false } }
  );

  if (!address) return <Layout><div className="p-8 text-center font-mono">Invalid Address</div></Layout>;

  if (profileError) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto mt-20 p-8 border border-destructive/50 bg-destructive/10 rounded-xl text-center">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-mono text-destructive mb-2">Wallet Not Found or Error</h2>
          <p className="text-muted-foreground font-mono text-sm">Could not fetch profile for {address}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 pb-12">

        {/* Profile Header */}
        <div className="bg-card border border-border p-6 rounded-xl">
          {profileLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            </div>
          ) : profile ? (
            <>
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    {profile.profileImage ? (
                      <img src={profile.profileImage} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-border" />
                    ) : (
                      <Wallet className="h-6 w-6 text-primary shrink-0" />
                    )}
                    <h1 className="text-2xl font-mono font-bold truncate">
                      {profile.name || profile.pseudonym || truncateAddress(profile.address, 6)}
                    </h1>
                    {profile.verifiedBadge && (
                      <BadgeCheck className="h-5 w-5 text-primary shrink-0" aria-label="Verified" />
                    )}
                    {profile.name && profile.pseudonym && (
                      <span className="text-xs font-mono text-muted-foreground">({profile.pseudonym})</span>
                    )}
                    <a href={`https://polymarket.com/profile/${profile.address}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1 rounded inline-block break-all">
                    {profile.address}
                  </div>

                  {/* Age + dates row */}
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Age badge */}
                      <span className={cn(
                        "text-sm font-mono font-bold px-2 py-0.5 rounded border",
                        profile.walletAgeDays < 7
                          ? "border-red-500/50 bg-red-500/10 text-red-400"
                          : profile.walletAgeDays < 30
                          ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400"
                          : "border-green-500/50 bg-green-500/10 text-green-400"
                      )}>
                        {profile.walletAgeDays < 1
                          ? `${Math.round(profile.walletAgeDays * 24)}h old`
                          : `${Math.round(profile.walletAgeDays)}d old`}
                      </span>
                      {profile.walletAgeDays < 7 && (
                        <span className="text-[10px] font-mono text-red-400 border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 rounded">NEW WALLET</span>
                      )}
                      {/* Exact first bet date */}
                      {profile.firstTradeAt && (
                        <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          First bet: <span className="text-foreground">{formatDate(profile.firstTradeAt)}</span>
                        </span>
                      )}
                      {/* Last bet date */}
                      {profile.lastTradeAt && (
                        <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                          · Last bet: <span className="text-foreground">{formatDate(profile.lastTradeAt)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Risk Gauge */}
                <div className="shrink-0 bg-background border border-border rounded-lg p-4 w-full md:w-64">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      INSIDER RISK
                    </div>
                    <div className={cn("text-xs font-mono font-bold px-2 py-0.5 rounded", getRiskColorClass(profile.riskScore))}>
                      {profile.riskLabel}
                    </div>
                  </div>
                  <Progress
                    value={profile.riskScore}
                    className="h-2 mb-2"
                    indicatorClassName={cn(
                      profile.riskScore >= 80 ? "bg-destructive" :
                      profile.riskScore >= 50 ? "bg-orange-500" :
                      profile.riskScore >= 25 ? "bg-yellow-500" : "bg-green-500"
                    )}
                  />
                  <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                    <span>LOW</span>
                    <span className="font-bold">{profile.riskScore}/100</span>
                    <span>CRITICAL</span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <StatCard label="TOTAL VOLUME" value={formatCurrency(profile.totalVolumeUsdc)} highlight icon={<TrendingUp className="h-3 w-3" />} />
                <StatCard label="TOTAL BETS" value={profile.tradeCount.toString()} icon={<Hash className="h-3 w-3" />} />
                <StatCard
                  label="AVG BET SIZE"
                  value={profile.avgTradeSize != null && profile.avgTradeSize > 0 ? formatCurrency(profile.avgTradeSize) : "—"}
                  icon={<BarChart2 className="h-3 w-3" />}
                />
                <StatCard
                  label="WIN RATE"
                  value={profile.winRate !== undefined && profile.winRate !== null ? `${profile.winRate.toFixed(1)}%` : "N/A"}
                  icon={<Star className="h-3 w-3" />}
                />
              </div>

              {/* Risk Factors */}
              {profile.riskFactors && profile.riskFactors.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border/50">
                  <div className="text-xs font-mono text-muted-foreground mb-3 flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3" /> RISK FACTORS DETECTED
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profile.riskFactors.map((factor, i) => (
                      <span key={i} className="text-xs font-mono bg-destructive/10 text-destructive border border-destructive/20 px-2 py-1 rounded">
                        {factor}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="history" className="w-full">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="history" className="font-mono text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <ArrowRightLeft className="h-4 w-4 mr-2" /> BET HISTORY
            </TabsTrigger>
            <TabsTrigger value="activity" className="font-mono text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Activity className="h-4 w-4 mr-2" /> ACTIVITY
            </TabsTrigger>
            <TabsTrigger value="bymarket" className="font-mono text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <BarChart2 className="h-4 w-4 mr-2" /> BY MARKET
            </TabsTrigger>
            <TabsTrigger value="positions" className="font-mono text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Briefcase className="h-4 w-4 mr-2" /> OPEN POSITIONS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="mt-4">
            <WalletHistory address={address} />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <ActivityChart address={address} />
          </TabsContent>

          <TabsContent value="bymarket" className="mt-4">
            <WalletByMarket address={address} />
          </TabsContent>

          <TabsContent value="positions" className="mt-4 space-y-4">
            <RedeemableSummary address={address} />
            <WalletPositions address={address} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, highlight = false, icon }: { label: string; value: string; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="bg-background border border-border p-3 rounded-lg">
      <div className="text-[10px] font-mono text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-lg font-mono font-bold", highlight ? "text-primary" : "text-foreground")}>{value}</div>
    </div>
  );
}

function ActivityChart({ address }: { address: string }) {
  const { data: trades, isLoading } = useGetWalletTrades(
    address,
    { query: { queryKey: getGetWalletTradesQueryKey(address), enabled: !!address } }
  );

  const { dailyBars, topMarket, buyTotal, sellTotal, bySide } = useMemo(() => {
    if (!trades || trades.length === 0) return { dailyBars: [], topMarket: null, buyTotal: 0, sellTotal: 0, bySide: {} };

    // Build 30-day daily volume
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const dayMap = new Map<number, { buy: number; sell: number; count: number }>();
    for (let i = 29; i >= 0; i--) {
      const key = Math.floor((now - i * DAY) / DAY);
      dayMap.set(key, { buy: 0, sell: 0, count: 0 });
    }
    let buy = 0, sell = 0;
    const marketVol = new Map<string, { title: string; volume: number; count: number }>();

    for (const t of trades) {
      const dayKey = Math.floor(t.timestamp / DAY);
      const entry = dayMap.get(dayKey);
      if (entry) {
        if (t.side === "BUY") entry.buy += t.usdcSize;
        else entry.sell += t.usdcSize;
        entry.count++;
      }
      if (t.side === "BUY") buy += t.usdcSize; else sell += t.usdcSize;

      const mk = marketVol.get(t.conditionId ?? t.title) ?? { title: t.title, volume: 0, count: 0 };
      mk.volume += t.usdcSize;
      mk.count++;
      marketVol.set(t.conditionId ?? t.title, mk);
    }

    const bars = [...dayMap.entries()].map(([dayKey, v]) => ({
      label: new Date(dayKey * DAY * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      total: v.buy + v.sell,
      buy: v.buy,
      sell: v.sell,
      count: v.count,
    }));

    const maxVol = Math.max(...[...marketVol.values()].map((m) => m.volume), 1);
    const top = [...marketVol.values()].sort((a, b) => b.volume - a.volume)[0] ?? null;

    // Side breakdown  
    const sideMap: Record<string, number> = {};
    for (const t of trades) {
      const outcome = `${t.side} ${t.outcome}`;
      sideMap[outcome] = (sideMap[outcome] ?? 0) + t.usdcSize;
    }

    return { dailyBars: bars, topMarket: top, buyTotal: buy, sellTotal: sell, bySide: sideMap };
  }, [trades]);

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!trades || trades.length === 0) return <div className="p-8 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">No trade history found.</div>;

  const maxBar = Math.max(...dailyBars.map((b) => b.total), 1);
  const total = buyTotal + sellTotal;
  const buyPct = total > 0 ? (buyTotal / total) * 100 : 50;

  return (
    <div className="space-y-4">
      {/* Buy/Sell totals */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-mono text-muted-foreground mb-3">ALL-TIME BUY vs SELL</div>
        <div className="flex justify-between text-sm font-mono mb-2">
          <span className="text-emerald-400 font-bold">{formatCurrency(buyTotal)} BUY</span>
          <span className="text-rose-400 font-bold">SELL {formatCurrency(sellTotal)}</span>
        </div>
        <div className="h-3 w-full rounded-full overflow-hidden bg-rose-500/20 flex">
          <div className="h-full bg-emerald-500/70 rounded-l-full" style={{ width: `${Math.max(buyPct, 2)}%` }} />
          <div className="h-full bg-rose-500/50 rounded-r-full flex-1" />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
          <span>{buyPct.toFixed(0)}% buys</span>
          <span>{(100 - buyPct).toFixed(0)}% sells</span>
        </div>
      </div>

      {/* Most bet market */}
      {topMarket && (
        <div className="bg-card border border-primary/20 rounded-xl p-4 flex items-center gap-3">
          <Star className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-muted-foreground mb-0.5">MOST ACTIVE MARKET</div>
            <div className="text-sm font-mono font-bold line-clamp-1">{topMarket.title}</div>
            <div className="text-[10px] font-mono text-muted-foreground">{topMarket.count} bets</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-mono font-bold text-primary">{formatCurrency(topMarket.volume)}</div>
          </div>
        </div>
      )}

      {/* 30-day volume chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-mono text-muted-foreground mb-4 flex items-center gap-1">
          <Activity className="h-3 w-3" /> DAILY BETTING VOLUME — LAST 30 DAYS
        </div>
        <div className="flex items-end gap-px h-28 w-full">
          {dailyBars.map((bar, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end gap-px group relative" title={`${bar.label}: ${bar.count} bets — ${formatCurrency(bar.total)}`}>
              {bar.total > 0 ? (
                <>
                  <div
                    className="bg-emerald-500/70 rounded-t-sm w-full transition-all group-hover:bg-emerald-400"
                    style={{ height: `${(bar.buy / maxBar) * 100}%` }}
                  />
                  {bar.sell > 0 && (
                    <div
                      className="bg-rose-500/50 w-full transition-all group-hover:bg-rose-400"
                      style={{ height: `${(bar.sell / maxBar) * 100}%` }}
                    />
                  )}
                </>
              ) : (
                <div className="w-full h-px bg-border/30" />
              )}
            </div>
          ))}
        </div>
        {/* X-axis labels — show every 7th */}
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-2">
          {dailyBars.filter((_, i) => i % 7 === 0 || i === dailyBars.length - 1).map((b, i) => (
            <span key={i}>{b.label}</span>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-emerald-500/70 rounded-sm" /> Buy</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-rose-500/50 rounded-sm" /> Sell</span>
        </div>
      </div>
    </div>
  );
}

function WalletHistory({ address }: { address: string }) {
  const { data: trades, isLoading } = useGetWalletTrades(
    address,
    { query: { queryKey: getGetWalletTradesQueryKey(address), enabled: !!address } }
  );

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!trades || trades.length === 0) return <div className="p-8 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">No trade history found.</div>;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-background/50 flex justify-between items-center">
        <span className="text-xs font-mono text-muted-foreground">{trades.length} bets found</span>
        <div className="flex gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="text-emerald-400">{trades.filter((t) => t.side === "BUY").length} buys</span>
          <span className="text-rose-400">{trades.filter((t) => t.side === "SELL").length} sells</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono text-left">
          <thead className="bg-background border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-normal">TIME</th>
              <th className="p-3 font-normal">MARKET</th>
              <th className="p-3 font-normal">SIDE</th>
              <th className="p-3 font-normal">OUTCOME</th>
              <th className="p-3 font-normal text-right">PRICE</th>
              <th className="p-3 font-normal text-right">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {trades.map((trade) => (
              <tr key={trade.transactionHash} className="hover:bg-muted/20 transition-colors">
                <td className="p-3 whitespace-nowrap text-muted-foreground text-xs">
                  <div>{formatTimeAgo(trade.timestamp)}</div>
                  <div className="text-[10px] text-muted-foreground/60">{formatDate(trade.timestamp)}</div>
                </td>
                <td className="p-3 max-w-[240px]">
                  <div className="truncate text-sm" title={trade.title}>{trade.title}</div>
                </td>
                <td className="p-3">
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded",
                    trade.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  )}>
                    {trade.side}
                  </span>
                </td>
                <td className="p-3 text-xs">{trade.outcome}</td>
                <td className="p-3 text-right text-xs">${trade.price.toFixed(3)}</td>
                <td className={cn(
                  "p-3 text-right font-bold text-sm",
                  trade.side === "BUY" ? "text-emerald-400" : "text-rose-400"
                )}>
                  {formatCurrency(trade.usdcSize)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WalletByMarket({ address }: { address: string }) {
  const { data: trades, isLoading } = useGetWalletTrades(
    address,
    { query: { queryKey: getGetWalletTradesQueryKey(address), enabled: !!address } }
  );

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!trades || trades.length === 0) return <div className="p-8 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">No trade history found.</div>;

  type MarketGroup = {
    title: string;
    conditionId: string | null;
    slug: string | null;
    icon: string | null;
    trades: typeof trades;
    totalUsdc: number;
    buyUsdc: number;
    sellUsdc: number;
    firstTradeAt: number;
    lastTradeAt: number;
  };

  const marketMap = new Map<string, MarketGroup>();
  for (const t of trades) {
    const key = t.conditionId ?? t.title;
    const grp = marketMap.get(key) ?? {
      title: t.title,
      conditionId: t.conditionId ?? null,
      slug: t.slug ?? null,
      icon: t.icon ?? null,
      trades: [],
      totalUsdc: 0,
      buyUsdc: 0,
      sellUsdc: 0,
      firstTradeAt: t.timestamp,
      lastTradeAt: t.timestamp,
    };
    grp.trades.push(t);
    grp.totalUsdc += t.usdcSize;
    if (t.side === "BUY") grp.buyUsdc += t.usdcSize;
    else grp.sellUsdc += t.usdcSize;
    if (t.timestamp < grp.firstTradeAt) grp.firstTradeAt = t.timestamp;
    if (t.timestamp > grp.lastTradeAt) grp.lastTradeAt = t.timestamp;
    marketMap.set(key, grp);
  }

  const groups = [...marketMap.values()].sort((a, b) => b.totalUsdc - a.totalUsdc);

  return (
    <div className="space-y-3">
      {groups.map((grp) => {
        const buyPct = grp.totalUsdc > 0 ? (grp.buyUsdc / grp.totalUsdc) * 100 : 50;
        return (
          <div key={grp.conditionId ?? grp.title} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              {grp.icon ? (
                <img src={grp.icon} alt="" className="w-8 h-8 rounded-full bg-muted object-cover shrink-0 mt-0.5" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-mono text-xs border border-border shrink-0 mt-0.5">M</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-bold line-clamp-2" title={grp.title}>{grp.title}</div>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="text-[10px] font-mono text-muted-foreground">{grp.trades.length} bet{grp.trades.length !== 1 ? "s" : ""}</span>
                  <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(grp.firstTradeAt)}
                    {grp.firstTradeAt !== grp.lastTradeAt && ` → ${formatDate(grp.lastTradeAt)}`}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-mono font-bold text-primary">{formatCurrency(grp.totalUsdc)}</div>
                <div className="text-[10px] font-mono text-muted-foreground">total</div>
              </div>
            </div>

            {/* Buy/sell bar */}
            <div className="px-4 pb-3">
              <div className="flex justify-between text-[10px] font-mono mb-1">
                <span className="text-emerald-400">BUY {formatCurrency(grp.buyUsdc)}</span>
                <span className="text-rose-400">SELL {formatCurrency(grp.sellUsdc)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full overflow-hidden bg-rose-500/20 flex">
                <div className="h-full bg-emerald-500/70 rounded-l-full" style={{ width: `${Math.max(buyPct, 2)}%` }} />
                <div className="h-full bg-rose-500/50 rounded-r-full flex-1" />
              </div>
            </div>

            {/* Outcomes traded */}
            <div className="px-4 pb-3 flex flex-wrap gap-1">
              {[...new Set(grp.trades.map((t) => t.outcome))].map((outcome) => (
                <span key={outcome} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border border-border">{outcome}</span>
              ))}
            </div>

            {/* Individual trades */}
            <div className="border-t border-border/50 divide-y divide-border/50">
              {grp.trades.slice(0, 5).map((t) => (
                <div key={t.transactionHash} className="flex items-center justify-between px-4 py-2 text-xs font-mono">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-3 w-3 shrink-0" />
                    <span>{formatTimeAgo(t.timestamp)}</span>
                    <span className="text-muted-foreground/50 text-[10px]">{formatDate(t.timestamp)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold",
                      t.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                    )}>
                      {t.side} {t.outcome}
                    </span>
                    <span className="text-muted-foreground">@{t.price.toFixed(2)}</span>
                    <span className={cn("font-bold", t.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                      {formatCurrency(t.usdcSize)}
                    </span>
                  </div>
                </div>
              ))}
              {grp.trades.length > 5 && (
                <div className="px-4 py-2 text-[10px] font-mono text-muted-foreground">
                  +{grp.trades.length - 5} more bet{grp.trades.length - 5 !== 1 ? "s" : ""} in this market
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RedeemableSummary({ address }: { address: string }) {
  const { data: positions, isLoading } = useGetWalletPositions(
    address,
    { query: { queryKey: getGetWalletPositionsQueryKey(address), enabled: !!address } }
  );

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  const redeemable = (positions ?? []).filter((p) => p.redeemable === true && p.currentValue > 0);
  if (redeemable.length === 0) return null;

  const totalValue = redeemable.reduce((s, p) => s + p.currentValue, 0);

  return (
    <div className="bg-primary/5 border border-primary/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <Coins className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-mono font-bold text-primary">REDEEMABLE WINNINGS</div>
          <div className="text-xs font-mono text-muted-foreground mt-1 leading-relaxed max-w-md">
            {redeemable.length} resolved position{redeemable.length === 1 ? "" : "s"} can be redeemed for collateral.
            PolyWatch shows read-only data — redeem your winnings directly on Polymarket.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <div className="text-[10px] font-mono text-muted-foreground">TOTAL VALUE</div>
          <div className="text-xl font-mono font-bold text-primary">{formatCurrency(totalValue)}</div>
        </div>
        <a
          href="https://polymarket.com/portfolio"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary/15 border border-primary/30 text-primary text-xs font-mono font-bold hover:bg-primary/25 transition-colors whitespace-nowrap"
        >
          REDEEM ON POLYMARKET
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function WalletPositions({ address }: { address: string }) {
  const { data: positions, isLoading } = useGetWalletPositions(
    address,
    { query: { queryKey: getGetWalletPositionsQueryKey(address), enabled: !!address } }
  );

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (!positions || positions.length === 0) return <div className="p-8 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">No open positions found.</div>;

  return (
    <div className="space-y-3">
      {positions.map((pos, i) => (
        <div key={i} className="bg-card border border-border p-4 rounded-lg flex flex-col md:flex-row justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded border border-border">{pos.outcome}</span>
              {pos.redeemable && pos.currentValue > 0 && (
                <span className="text-[10px] font-mono font-bold text-primary bg-primary/15 border border-primary/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Coins className="h-3 w-3" /> REDEEMABLE
                </span>
              )}
            </div>
            <div className="text-sm font-mono font-bold line-clamp-2" title={pos.title}>{pos.title}</div>
          </div>
          <div className="flex items-center gap-6 shrink-0 bg-background border border-border p-3 rounded-md">
            <div>
              <div className="text-[10px] font-mono text-muted-foreground">SIZE</div>
              <div className="text-sm font-mono">{pos.size.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-muted-foreground">AVG BUY</div>
              <div className="text-sm font-mono text-primary">${pos.avgPrice.toFixed(3)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono text-muted-foreground">VALUE</div>
              <div className="text-sm font-mono font-bold">{formatCurrency(pos.currentValue)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
