import { useMemo, useState } from "react";
import {
  useGetLeaderboard,
  getGetLeaderboardQueryKey,
  useGetBuilderVolume,
  getGetBuilderVolumeQueryKey,
  useGetBuilderTrades,
  getGetBuilderTradesQueryKey,
  useGetBuilderFeesSummary,
  getGetBuilderFeesSummaryQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useAccountStatus } from "@/lib/useAccountStatus";
import { formatCurrency, formatTimeAgo, truncateAddress, cn } from "@/lib/utils";
import { Trophy, RefreshCw, ExternalLink, Medal, BadgeCheck, LineChart, X, ArrowRightLeft, ShieldCheck, HelpCircle, Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";

const PERIODS = ["DAY", "WEEK", "MONTH", "ALL"] as const;
type Period = (typeof PERIODS)[number];

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("WEEK");
  const [drawerBuilder, setDrawerBuilder] = useState<string | null>(null);
  const status = useAccountStatus();
  const BUILDER_CODE = status?.builderCode?.value ?? "";

  const { data, isLoading, refetch, isFetching } = useGetLeaderboard(
    { timePeriod: period },
    { query: { queryKey: [...getGetLeaderboardQueryKey({ timePeriod: period }), period], refetchInterval: 60000 } }
  );

  const myEntry = data?.find((e) => e.builderCode === BUILDER_CODE);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 pb-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            BUILDER LEADERBOARD
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-3 py-1 rounded text-xs font-mono font-bold transition-colors",
                    period === p
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              REFRESH
            </button>
          </div>
        </div>

        {/* My builder card */}
        {myEntry && (
          <div className="bg-primary/5 border border-primary/30 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono text-primary mb-1">YOUR BUILDER STATS</div>
              <div className="font-mono font-bold text-lg flex items-center gap-1.5">
                {myEntry.name ?? myEntry.builderCode.slice(0, 16) + "…"}
                {myEntry.verified && <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verified" />}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-0.5">
                {myEntry.tradeCount != null ? `${myEntry.tradeCount.toLocaleString()} trades` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono font-bold text-xl text-primary">{formatCurrency(myEntry.volumeUsdc)}</div>
              <div className="text-xs font-mono text-muted-foreground">
                {myEntry.rank != null ? `RANK #${myEntry.rank}` : ""}
              </div>
            </div>
          </div>
        )}

        {/* Info card if no builder code set */}
        {!BUILDER_CODE && (
          <div className="bg-card border border-border rounded-xl p-4 text-sm font-mono text-muted-foreground space-y-1">
            <div className="font-bold text-foreground text-xs">GET ATTRIBUTED ON THIS LEADERBOARD</div>
            <div className="text-xs leading-relaxed">
              Create a builder profile at{" "}
              <a href="https://polymarket.com/settings?tab=builder" target="_blank" rel="noreferrer" className="text-primary underline">
                polymarket.com/settings?tab=builder
              </a>{" "}
              then add your builder code as <span className="text-foreground">POLY_BUILDER_CODE</span> in Replit Secrets.
              Every order submitted through PolyWatch will be attributed to your account.
            </div>
          </div>
        )}

        {/* Builder tier status (best-effort inference — no public tier API exists) */}
        {BUILDER_CODE && <BuilderTierStatus builderCode={BUILDER_CODE} />}

        {/* My builder volume time-series */}
        {BUILDER_CODE && <BuilderVolumeChart builderCode={BUILDER_CODE} />}

        {/* My builder fee revenue */}
        {BUILDER_CODE && <BuilderFeeRevenue builderCode={BUILDER_CODE} />}

        {/* Leaderboard table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold">TOP BUILDERS — {period}</h3>
            <a
              href="https://builders.polymarket.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              builders.polymarket.com
            </a>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground font-mono text-sm">
              <Trophy className="h-8 w-8 mx-auto opacity-20 mb-3" />
              No leaderboard data available
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.map((entry, i) => {
                const rank = entry.rank ?? i + 1;
                const isMe = entry.builderCode === BUILDER_CODE;
                return (
                  <div
                    key={entry.builderCode}
                    className={cn(
                      "px-5 py-4 flex items-center gap-4 transition-colors",
                      isMe ? "bg-primary/5" : "hover:bg-muted/20"
                    )}
                  >
                    {/* Rank */}
                    <div className="w-8 shrink-0 text-center">
                      {rank === 1 ? (
                        <Medal className="h-5 w-5 text-yellow-400 mx-auto" />
                      ) : rank === 2 ? (
                        <Medal className="h-5 w-5 text-gray-300 mx-auto" />
                      ) : rank === 3 ? (
                        <Medal className="h-5 w-5 text-orange-400 mx-auto" />
                      ) : (
                        <span className="font-mono text-sm text-muted-foreground">#{rank}</span>
                      )}
                    </div>

                    {/* Logo */}
                    {entry.logo ? (
                      <img src={entry.logo} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-border" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-mono text-xs border border-border shrink-0" />
                    )}

                    {/* Builder info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <a
                          href={entry.address
                            ? `https://polymarket.com/profile/${entry.address}`
                            : `https://polymarket.com/profile/${entry.builderCode}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm font-bold truncate hover:text-primary transition-colors"
                        >
                          {entry.name ?? (entry.builderCode.slice(0, 20) + "…")}
                        </a>
                        {entry.verified && (
                          <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Verified" />
                        )}
                        {isMe && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/15 text-primary border border-primary/30 shrink-0">
                            YOU
                          </span>
                        )}
                        <a
                          href={entry.address
                            ? `https://polymarket.com/profile/${entry.address}`
                            : `https://polymarket.com/profile/${entry.builderCode}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground/60 truncate mt-0.5">
                        {entry.address ?? entry.builderCode}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-sm">{formatCurrency(entry.volumeUsdc)}</div>
                      {entry.tradeCount != null && (
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {entry.tradeCount.toLocaleString()} trades
                        </div>
                      )}
                    </div>

                    {/* Trades button */}
                    <button
                      onClick={() => setDrawerBuilder(entry.builderCode)}
                      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                      title="View recent trades"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Builder trades drawer */}
        <Drawer open={!!drawerBuilder} onOpenChange={(open) => !open && setDrawerBuilder(null)}>
          <DrawerContent className="h-[85vh] bg-card border-t border-border">
            <div className="max-w-4xl mx-auto w-full h-full flex flex-col">
              <DrawerHeader className="border-b border-border flex justify-between items-start shrink-0 gap-4">
                <div>
                  <DrawerTitle className="font-mono text-base">Builder Trades</DrawerTitle>
                  {drawerBuilder && (
                    <p className="text-xs font-mono text-muted-foreground mt-1 truncate max-w-md">{drawerBuilder}</p>
                  )}
                </div>
                <DrawerClose className="p-2 hover:bg-muted rounded-md text-muted-foreground shrink-0">
                  <X className="h-4 w-4" />
                </DrawerClose>
              </DrawerHeader>
              <div className="p-4 flex-1 overflow-y-auto">
                {drawerBuilder && <BuilderTradesList builderCode={drawerBuilder} />}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </Layout>
  );
}

function BuilderVolumeChart({ builderCode }: { builderCode: string }) {
  const { data, isLoading } = useGetBuilderVolume(
    { timePeriod: "MONTH", builderCode },
    { query: { queryKey: getGetBuilderVolumeQueryKey({ timePeriod: "MONTH", builderCode }) } }
  );

  const bars = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => ({ label: d.date, volume: d.volumeUsdc }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (bars.length === 0) return null;

  const maxVol = Math.max(...bars.map((b) => b.volume), 1);
  const total = bars.reduce((s, b) => s + b.volume, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
          <LineChart className="h-3 w-3" /> YOUR VOLUME — LAST 30 DAYS
        </div>
        <div className="text-sm font-mono font-bold text-primary">{formatCurrency(total)}</div>
      </div>
      <div className="flex items-end gap-px h-24 w-full">
        {bars.map((bar, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col justify-end group relative"
            title={`${bar.label}: ${formatCurrency(bar.volume)}`}
          >
            {bar.volume > 0 ? (
              <div
                className="bg-primary/70 rounded-t-sm w-full transition-all group-hover:bg-primary"
                style={{ height: `${(bar.volume / maxVol) * 100}%` }}
              />
            ) : (
              <div className="w-full h-px bg-border/30" />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-2">
        {bars.filter((_, i) => i % 7 === 0 || i === bars.length - 1).map((b, i) => (
          <span key={i}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}

function BuilderTierStatus({ builderCode }: { builderCode: string }) {
  // No public API exposes builder tier directly. Best-effort inference: Polymarket's
  // docs state Unverified builders have no leaderboard visibility ("—"), while
  // Verified+ builders are listed. We always check the ALL-time window (independent
  // of the page's period selector) to avoid false negatives from low recent volume.
  const { data, isLoading } = useGetLeaderboard(
    { timePeriod: "ALL" },
    { query: { queryKey: [...getGetLeaderboardQueryKey({ timePeriod: "ALL" }), "ALL", "tier-check"] } }
  );

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const found = data?.find((e) => e.builderCode === builderCode);

  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex items-start gap-3",
        found ? "bg-emerald-500/5 border-emerald-500/30" : "bg-card border-border"
      )}
    >
      {found ? (
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <HelpCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <div className={cn("text-xs font-mono font-bold", found ? "text-emerald-400" : "text-foreground")}>
          {found ? "VERIFIED+ TIER (INFERRED)" : "TIER UNCONFIRMED"}
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1 leading-relaxed">
          {found ? (
            <>Your builder code is visible on the all-time leaderboard — Unverified builders have no leaderboard visibility, so this indicates Verified or Partner tier.</>
          ) : (
            <>Your builder code doesn't appear on the all-time leaderboard yet. This usually means you're still on the Unverified tier, or haven't crossed the volume threshold. There's no public API to check the exact tier — verify at{" "}
              <a href="https://polymarket.com/settings?tab=builder" target="_blank" rel="noreferrer" className="text-primary underline">
                polymarket.com/settings?tab=builder
              </a>.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BuilderFeeRevenue({ builderCode }: { builderCode: string }) {
  const { data, isLoading } = useGetBuilderFeesSummary(
    { builderCode },
    { query: { queryKey: getGetBuilderFeesSummaryQueryKey({ builderCode }) } }
  );

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (!data || data.tradeCount === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary shrink-0" />
        <div>
          <div className="text-xs font-mono text-muted-foreground">
            BUILDER FEE REVENUE {data.truncated ? `— LAST ${data.tradeCount} TRADES` : "— ALL TRADES"}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
            {data.feeTradeCount > 0
              ? `${data.feeTradeCount} fee-bearing trade${data.feeTradeCount === 1 ? "" : "s"}`
              : "No fee data returned yet — fee rates are set at polymarket.com/settings?tab=builder"}
          </div>
        </div>
      </div>
      <div className="text-xl font-mono font-bold text-primary shrink-0">{formatCurrency(data.totalFeeUsdc)}</div>
    </div>
  );
}

function BuilderTradesList({ builderCode }: { builderCode: string }) {
  const { data, isLoading } = useGetBuilderTrades(
    { builderCode, limit: 50 },
    { query: { queryKey: getGetBuilderTradesQueryKey({ builderCode, limit: 50 }) } }
  );

  const trades = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
        No trades found for this builder code yet.
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono text-left">
          <thead className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-normal">TIME</th>
              <th className="p-3 font-normal">MARKET</th>
              <th className="p-3 font-normal">SIDE</th>
              <th className="p-3 font-normal">OUTCOME</th>
              <th className="p-3 font-normal">STATUS</th>
              <th className="p-3 font-normal text-right">PRICE</th>
              <th className="p-3 font-normal text-right">TOTAL</th>
              <th className="p-3 font-normal text-right">FEE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {trades.map((t) => (
              <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                <td className="p-3 whitespace-nowrap text-muted-foreground text-xs">
                  {t.matchTime != null ? formatTimeAgo(t.matchTime) : "—"}
                </td>
                <td className="p-3 max-w-[220px]">
                  <div className="truncate text-sm" title={t.market}>{truncateAddress(t.market, 10)}</div>
                </td>
                <td className="p-3">
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded",
                    t.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  )}>
                    {t.side}
                  </span>
                </td>
                <td className="p-3 text-xs">{t.outcome}</td>
                <td className="p-3 text-xs text-muted-foreground">{t.status}</td>
                <td className="p-3 text-right text-xs">${t.price.toFixed(3)}</td>
                <td className={cn(
                  "p-3 text-right font-bold text-sm",
                  t.side === "BUY" ? "text-emerald-400" : "text-rose-400"
                )}>
                  {formatCurrency(t.sizeUsdc)}
                </td>
                <td className="p-3 text-right text-xs text-primary">
                  {t.feeUsdc != null ? formatCurrency(t.feeUsdc) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
