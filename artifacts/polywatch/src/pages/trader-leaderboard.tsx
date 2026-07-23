import { useState } from "react";
import { Link } from "wouter";
import { useGetTraderLeaderboard, getGetTraderLeaderboardQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, truncateAddress, cn } from "@/lib/utils";
import { Trophy, Medal, BadgeCheck, Filter, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const PERIODS = ["DAY", "WEEK", "MONTH", "ALL"] as const;
type Period = typeof PERIODS[number];

const CATEGORIES = [
  "All", "Politics", "Sports", "Crypto", "Science", "Pop Culture", "Business"
] as const;

export default function TraderLeaderboardPage() {
  const [period, setPeriod] = useState<Period>("WEEK");
  const [category, setCategory] = useState<string>("All");

  const { data: leaderboard, isLoading } = useGetTraderLeaderboard(
    { timePeriod: period, category: category !== "All" ? category : undefined },
    { query: { queryKey: getGetTraderLeaderboardQueryKey({ timePeriod: period, category: category !== "All" ? category : undefined }), staleTime: 60000 } }
  );

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-8 pb-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            TRADER P&L RANKINGS
          </h2>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Category Dropdown */}
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="bg-transparent border-none outline-none font-mono text-xs text-foreground cursor-pointer"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            
            {/* Period Selector */}
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
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-8">
            <div className="flex justify-center items-end gap-4 h-48">
              <Skeleton className="w-32 h-32 rounded-t-xl" />
              <Skeleton className="w-40 h-40 rounded-t-xl" />
              <Skeleton className="w-32 h-28 rounded-t-xl" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          </div>
        ) : !leaderboard || leaderboard.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
            No traders found for this period/category.
          </div>
        ) : (
          <>
            {/* Podium */}
            {leaderboard.length >= 3 && (
              <div className="flex justify-center items-end gap-2 md:gap-6 pt-8 pb-4">
                <PodiumCard entry={leaderboard[1]} position={2} />
                <PodiumCard entry={leaderboard[0]} position={1} />
                <PodiumCard entry={leaderboard[2]} position={3} />
              </div>
            )}

            {/* Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm font-mono text-left whitespace-nowrap">
                <thead className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="p-4 font-normal text-center w-16">RANK</th>
                    <th className="p-4 font-normal">TRADER</th>
                    <th className="p-4 font-normal text-right">P&L</th>
                    <th className="p-4 font-normal text-right">ROI</th>
                    <th className="p-4 font-normal text-right">VOLUME</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leaderboard.slice(3).map((entry, idx) => {
                    const rank = entry.rank ?? (idx + 4);
                    const pnl = entry.pnl ?? 0;
                    return (
                      <tr key={entry.address} className="hover:bg-muted/20 transition-colors group">
                        <td className="p-4 text-center text-muted-foreground font-bold">{rank}</td>
                        <td className="p-4">
                          <Link href={`/wallet/${entry.address}`} className="flex items-center gap-3">
                            {entry.profileImage ? (
                              <img src={entry.profileImage} alt="" className="w-8 h-8 rounded-full border border-border object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary border border-primary/30 flex items-center justify-center font-bold text-xs">
                                {(entry.pseudonym || entry.name || entry.address).slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 group-hover:text-primary transition-colors">
                                <span className="font-bold">{entry.pseudonym || entry.name || truncateAddress(entry.address)}</span>
                                {entry.verifiedBadge && <BadgeCheck className="h-3.5 w-3.5 text-primary" />}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                                {truncateAddress(entry.address)}
                                {entry.xUsername && (
                                  <a href={`https://x.com/${entry.xUsername}`} target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:text-primary" onClick={e => e.stopPropagation()}>
                                    @{entry.xUsername}
                                  </a>
                                )}
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className="p-4 text-right">
                          <span className={cn("font-bold", pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {entry.roi != null ? (
                            <span className={cn(entry.roi >= 0 ? "text-emerald-400" : "text-rose-400")}>
                              {entry.roi >= 0 ? "+" : ""}{(entry.roi * 100).toFixed(2)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="p-4 text-right text-muted-foreground">
                          {entry.volume != null ? formatCurrency(entry.volume) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function PodiumCard({ entry, position }: { entry: any; position: number }) {
  const isFirst = position === 1;
  const pnl = entry.pnl ?? 0;
  
  return (
    <div className={cn(
      "flex flex-col items-center relative",
      isFirst ? "order-2 z-10 -mt-8" : position === 2 ? "order-1" : "order-3"
    )}>
      {isFirst && <div className="absolute -top-10 text-yellow-400"><Trophy className="h-8 w-8 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" /></div>}
      {position === 2 && <div className="absolute -top-8 text-gray-300"><Medal className="h-6 w-6" /></div>}
      {position === 3 && <div className="absolute -top-8 text-orange-400"><Medal className="h-6 w-6" /></div>}
      
      <Link href={`/wallet/${entry.address}`}>
        <div className={cn(
          "bg-card border border-border rounded-t-2xl flex flex-col items-center p-4 hover:border-primary/50 transition-colors cursor-pointer text-center",
          isFirst ? "w-40 h-48 border-t-primary/50 bg-gradient-to-b from-primary/10 to-transparent" : "w-32 h-40"
        )}>
          {entry.profileImage ? (
            <img src={entry.profileImage} alt="" className={cn(
              "rounded-full border object-cover mb-3",
              isFirst ? "w-16 h-16 border-primary/50" : "w-12 h-12 border-border"
            )} />
          ) : (
            <div className={cn(
              "rounded-full bg-primary/20 text-primary border border-primary/30 flex items-center justify-center font-bold mb-3",
              isFirst ? "w-16 h-16 text-xl" : "w-12 h-12 text-sm"
            )}>
              {(entry.pseudonym || entry.name || entry.address).slice(0, 2).toUpperCase()}
            </div>
          )}
          
          <div className="font-mono font-bold text-sm truncate w-full flex items-center justify-center gap-1">
            <span className="truncate">{entry.pseudonym || entry.name || truncateAddress(entry.address)}</span>
            {entry.verifiedBadge && <BadgeCheck className="h-3 w-3 text-primary shrink-0" />}
          </div>
          
          <div className={cn("mt-auto font-mono font-bold", pnl >= 0 ? "text-emerald-400" : "text-rose-400", isFirst ? "text-lg" : "text-sm")}>
            {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1">
            {entry.roi != null && `${(entry.roi * 100).toFixed(1)}% ROI`}
          </div>
        </div>
      </Link>
    </div>
  );
}