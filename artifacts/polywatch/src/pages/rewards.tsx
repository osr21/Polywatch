import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRewardMarkets,
  getGetRewardMarketsQueryKey,
  useGetRewardPercentages,
  getGetRewardPercentagesQueryKey,
  useGetRewardEarnings,
  getGetRewardEarningsQueryKey,
  useGetTakerStats,
  getGetTakerStatsQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, truncateAddress, cn } from "@/lib/utils";
import { Gift, ExternalLink, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, Percent, RefreshCw, Award, Target, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminAuthHeaders } from "@/lib/adminAuth";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function CloudflareNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiErr = error as { status?: number; data?: { credentialsExpired?: boolean } } | undefined;
  const status = apiErr?.status;
  const isConfigMissing = status === 503;
  const isExpired = status === 401 || apiErr?.data?.credentialsExpired === true;

  const title = isConfigMissing
    ? "CLOB CREDENTIALS NOT CONFIGURED"
    : isExpired
    ? "CREDENTIALS EXPIRED"
    : "UNAVAILABLE FROM THIS ENVIRONMENT";

  return (
    <div className="p-5 border border-dashed border-yellow-500/30 bg-yellow-500/5 rounded-lg text-sm font-mono space-y-2">
      <div className="flex items-center gap-2 text-yellow-400 font-bold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {isConfigMissing
          ? "Personal rewards data requires POLY_API_KEY / POLY_API_SECRET / POLY_API_PASSPHRASE / POLY_PRIVATE_KEY in Replit Secrets."
          : isExpired
          ? "Your CLOB API credentials are stale — Polymarket rotates them periodically. They can be re-derived from your private key."
          : "Polymarket's Cloudflare protection blocks authenticated CLOB calls from cloud/server IPs. The public rewards markets table above is unaffected."}
      </p>
      {isExpired && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors font-bold"
          >
            <RefreshCw className="h-3 w-3" /> Re-derive &amp; retry
          </button>
          <a href="/bot" className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
            or manage credentials on Bot page →
          </a>
        </div>
      )}
    </div>
  );
}

export default function RewardsPage() {
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: marketsResp, isLoading: marketsLoading } = useGetRewardMarkets({
    query: { queryKey: getGetRewardMarketsQueryKey(), refetchInterval: 60000 },
  });
  const { data: pctResponse, isLoading: pctLoading, error: pctError, refetch: refetchPct } = useGetRewardPercentages({
    query: { queryKey: getGetRewardPercentagesQueryKey(), retry: false },
  });
  const percentages = pctResponse ?? [];

  const { data: earnResponse, isLoading: earningsLoading, error: earningsError, refetch: refetchEarnings } = useGetRewardEarnings({
    query: { queryKey: getGetRewardEarningsQueryKey(), retry: false },
  });
  const earnings = earnResponse?.data ?? [];

  const { data: takerStats, isLoading: takerLoading, error: takerError, refetch: refetchTaker } = useGetTakerStats({
    query: { queryKey: getGetTakerStatsQueryKey(), retry: false },
  });

  const markets = marketsResp?.data ?? [];

  // Called when the user clicks "Re-derive & retry".
  // Only useful when the issue is expired (rotated) credentials, not a wrong private key.
  const handleRetry = useCallback(async () => {
    const headers = adminAuthHeaders();
    if (headers["Authorization"]) {
      await fetch(`${BASE_URL}/api/auth/derive`, { method: "POST", headers }).catch(() => null);
    }
    await queryClient.invalidateQueries({ queryKey: getGetRewardPercentagesQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetRewardEarningsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetTakerStatsQueryKey() });
    void refetchPct();
    void refetchEarnings();
    void refetchTaker();
  }, [queryClient, refetchPct, refetchEarnings, refetchTaker]);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 pb-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            LIQUIDITY REWARDS
          </h2>
          <a
            href="https://docs.polymarket.com/developers/CLOB/liquidity-rewards"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            about liquidity rewards
          </a>
        </div>

        {/* Taker Rebate Tier */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              TAKER REBATE TIER
            </h3>
          </div>
          <div className="p-5">
            {takerLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : takerError ? (
              <CloudflareNotice error={takerError} onRetry={handleRetry} />
            ) : !takerStats ? (
              <div className="text-center text-muted-foreground font-mono text-sm py-4">
                Taker stats not available.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Current Tier & Progress */}
                <div className="flex flex-col md:flex-row md:items-center gap-6">
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                      <Award className={cn(
                        "h-8 w-8",
                        takerStats.tierName === "Bronze" ? "text-amber-700" :
                        takerStats.tierName === "Silver" ? "text-gray-400" :
                        takerStats.tierName === "Gold" ? "text-yellow-400" :
                        takerStats.tierName === "Platinum" ? "text-blue-300" :
                        takerStats.tierName === "Diamond" ? "text-cyan-400" :
                        takerStats.tierName === "Elite" ? "text-purple-400" :
                        takerStats.tierName === "Obsidian" ? "text-stone-400" :
                        "text-primary"
                      )} />
                    </div>
                    <div>
                      <div className="text-xs font-mono text-muted-foreground mb-1">CURRENT TIER</div>
                      <div className="text-2xl font-mono font-bold">{takerStats.tierName}</div>
                      <div className="text-sm font-mono text-primary">{(takerStats.dailyRebatePct ?? 0) * 100}% Daily Rebate</div>
                    </div>
                  </div>
                  
                  <div className="flex-1 bg-background border border-border p-4 rounded-lg">
                    <div className="flex justify-between text-xs font-mono mb-2">
                      <span className="text-muted-foreground">30D Taker Vol (Est)</span>
                      <span className="font-bold">{formatCurrency(takerStats.estimated30dTakerVol ?? 0)}</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-2">
                      <div 
                        className="h-full bg-primary transition-all" 
                        style={{ width: `${Math.min(100, ((takerStats.estimated30dTakerVol ?? 0) / (takerStats.nextTierVolume ?? 1)) * 100)}%` }} 
                      />
                    </div>
                    {takerStats.nextTierVolume && (
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>Current</span>
                        <span>{formatCurrency(takerStats.nextTierVolume)} for Next Tier</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-background border border-border p-3 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1 text-emerald-400">7D TAKER VOL</div>
                    <div className="text-sm font-mono font-bold text-emerald-400">{formatCurrency(takerStats.takerVolume7d ?? 0)}</div>
                  </div>
                  <div className="bg-background border border-border p-3 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1 text-rose-400">7D MAKER VOL</div>
                    <div className="text-sm font-mono font-bold text-rose-400">{formatCurrency(takerStats.makerVolume7d ?? 0)}</div>
                  </div>
                  <div className="bg-background border border-border p-3 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">MAKER SHARE</div>
                    <div className="text-sm font-mono font-bold">{(takerStats.makerShare ?? 0) * 100}%</div>
                  </div>
                </div>

                {/* Tiers Table */}
                <div className="pt-2">
                  <div className="text-xs font-mono font-bold mb-3 flex items-center gap-2">
                    <Target className="h-3.5 w-3.5 text-primary" /> TIER THRESHOLDS
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono text-left whitespace-nowrap border-collapse">
                      <thead className="bg-muted/20 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="p-2 font-normal">TIER</th>
                          <th className="p-2 font-normal text-right">30D VOL REQ</th>
                          <th className="p-2 font-normal text-right">REBATE RATE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[
                          { name: "Bronze", req: 10000, rate: "0%" },
                          { name: "Silver", req: 100000, rate: "0.25%" },
                          { name: "Gold", req: 1000000, rate: "0.50%" },
                          { name: "Platinum", req: 5000000, rate: "0.75%" },
                          { name: "Diamond", req: 15000000, rate: "1.00%" },
                          { name: "Elite", req: 50000000, rate: "1.25%" },
                          { name: "Obsidian", req: 100000000, rate: "1.50%" },
                        ].map((tier) => (
                          <tr key={tier.name} className={cn(takerStats.tierName === tier.name && "bg-primary/5")}>
                            <td className="p-2 font-bold flex items-center gap-2">
                              {takerStats.tierName === tier.name && <div className="w-1 h-3 bg-primary rounded-full" />}
                              {tier.name}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">{formatCurrency(tier.req)}+</td>
                            <td className="p-2 text-right text-primary">{tier.rate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* My reward percentages */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="font-mono text-sm font-bold flex items-center gap-2">
              <Percent className="h-4 w-4 text-primary" />
              MY REWARD RATES
            </h3>
          </div>
          <div className="p-5">
            {pctLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : pctError ? (
              <CloudflareNotice error={pctError} onRetry={handleRetry} />
            ) : !percentages || percentages.length === 0 ? (
              <div className="text-center text-muted-foreground font-mono text-sm py-4">
                No active reward positions found for your account.
              </div>
            ) : (
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(percentages, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* My earnings history */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="font-mono text-sm font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              MY REWARD EARNINGS
            </h3>
          </div>
          <div className="p-5">
            {earningsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : earningsError ? (
              <CloudflareNotice error={earningsError} onRetry={handleRetry} />
            ) : earnings.length === 0 ? (
              <div className="text-center text-muted-foreground font-mono text-sm py-4">
                No reward earnings recorded yet.
              </div>
            ) : (
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(earnings, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Public reward-eligible markets */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold">ACTIVE REWARD-ELIGIBLE MARKETS</h3>
            <span className="text-xs font-mono text-muted-foreground">
              {marketsLoading ? "" : `${markets.length} markets`}
            </span>
          </div>

          {marketsLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : markets.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground font-mono text-sm">
              <Gift className="h-8 w-8 mx-auto opacity-20 mb-3" />
              No reward-eligible markets found right now
            </div>
          ) : (
            <div className="divide-y divide-border">
              {markets.map((m) => {
                const isOpen = expandedMarket === m.conditionId;
                return (
                  <div key={m.conditionId}>
                    <button
                      onClick={() => setExpandedMarket(isOpen ? null : m.conditionId)}
                      className="w-full px-5 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://polymarket.com/market/${m.conditionId}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-sm font-bold truncate hover:text-primary transition-colors"
                          >
                            {truncateAddress(m.conditionId, 10)}
                          </a>
                          <a
                            href={`https://polymarket.com/market/${m.conditionId}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                          max spread {m.rewardsMaxSpread}¢ · min size {formatCurrency(m.rewardsMinSize)}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-sm text-primary">
                          {formatCurrency(m.totalDailyRate)}/day
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          native {formatCurrency(m.nativeDailyRate)}/day
                        </div>
                      </div>

                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>

                    {isOpen && m.rewardsConfig.length > 0 && (
                      <div className="px-5 pb-4 -mt-1">
                        <div className="bg-background border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-xs font-mono text-left">
                            <thead className="bg-muted/20 text-muted-foreground">
                              <tr>
                                <th className="p-2 font-normal">ASSET</th>
                                <th className="p-2 font-normal">START</th>
                                <th className="p-2 font-normal">END</th>
                                <th className="p-2 font-normal text-right">RATE/DAY</th>
                                <th className="p-2 font-normal text-right">TOTAL</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {m.rewardsConfig.map((c, i) => (
                                <tr key={i}>
                                  <td className="p-2">{truncateAddress(c.assetAddress)}</td>
                                  <td className="p-2 text-muted-foreground">{c.startDate}</td>
                                  <td className="p-2 text-muted-foreground">{c.endDate}</td>
                                  <td className={cn("p-2 text-right font-bold")}>{formatCurrency(c.ratePerDay)}</td>
                                  <td className="p-2 text-right text-muted-foreground">{formatCurrency(c.totalRewards)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
