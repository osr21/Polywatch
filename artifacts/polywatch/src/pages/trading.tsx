import { useState, useEffect } from "react";
import { useGetMarkets, getGetMarketsQueryKey, useGetMarketOrderbook, getGetMarketOrderbookQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle, ExternalLink, RefreshCw,
  BarChart3, BookOpen, ChevronRight
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

const POLYMARKET_BASE = "https://polymarket.com/event/";

export default function TradingPage() {
  const [search, setSearch] = useState("");
  const [selectedMarket, setSelectedMarket] = useState<{ conditionId: string; question: string; slug: string } | null>(null);

  const { data: markets, isLoading: marketsLoading } = useGetMarkets(
    { limit: 100 },
    { query: { queryKey: getGetMarketsQueryKey({ limit: 100 }), staleTime: 60000 } }
  );

  const filtered = (markets ?? []).filter((m) =>
    !search.trim() || m.question.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 30);

  const topMarkets = (markets ?? []).filter((m) => m.whaleCount > 0).slice(0, 6);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto pb-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            ORDER BOOKS
          </h2>
          <a
            href="https://polymarket.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors border border-border hover:border-primary/40 px-3 py-1.5 rounded-md"
          >
            Trade on Polymarket
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Trading disclaimer */}
        <div className="flex items-start gap-2 p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-muted-foreground">
            PolyWatch is a read-only analytics tool. To place trades, click any market to view its real-time order book and open it directly on Polymarket. Direct on-platform trading via CLOB API requires Polymarket account credentials.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: market selector */}
          <div className="lg:col-span-1 space-y-3">
            <div className="relative">
              <Input
                placeholder="Search markets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="font-mono text-xs bg-card border-border"
              />
            </div>

            {/* Top whale markets */}
            {!search && topMarkets.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground px-1">TOP WHALE MARKETS</p>
                {topMarkets.map((m) => (
                  <button
                    key={m.conditionId}
                    onClick={() => setSelectedMarket({ conditionId: m.conditionId, question: m.question, slug: m.slug })}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg border transition-colors",
                      selectedMarket?.conditionId === m.conditionId
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-card border-border hover:border-primary/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {m.icon && <img src={m.icon} alt="" className="w-5 h-5 rounded-full shrink-0" />}
                      <p className="text-xs font-mono line-clamp-2 flex-1 min-w-0">{m.question}</p>
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
                      <span className="text-primary">{m.whaleCount}🐋</span>
                      <span>{formatCurrency(m.whaleVolume)} whale vol</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Search results */}
            {search && (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {marketsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
                ) : filtered.length === 0 ? (
                  <p className="text-xs font-mono text-muted-foreground p-3">No markets found</p>
                ) : filtered.map((m) => (
                  <button
                    key={m.conditionId}
                    onClick={() => setSelectedMarket({ conditionId: m.conditionId, question: m.question, slug: m.slug })}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg border transition-colors",
                      selectedMarket?.conditionId === m.conditionId
                        ? "bg-primary/10 border-primary/40"
                        : "bg-card border-border hover:border-primary/30"
                    )}
                  >
                    <p className="text-xs font-mono line-clamp-2">{m.question}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: order book */}
          <div className="lg:col-span-2">
            {selectedMarket ? (
              <OrderBookView conditionId={selectedMarket.conditionId} question={selectedMarket.question} slug={selectedMarket.slug} />
            ) : (
              <div className="h-full min-h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-xl text-muted-foreground font-mono text-sm p-12 text-center space-y-3">
                <BookOpen className="h-8 w-8 opacity-30" />
                <p>Select a market to view its live order book</p>
                <p className="text-xs opacity-60">Shows real-time bid/ask depth from Polymarket&apos;s CLOB</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function OrderBookView({ conditionId, question, slug }: { conditionId: string; question: string; slug: string }) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: book, isLoading, refetch, dataUpdatedAt } = useGetMarketOrderbook(
    conditionId,
    {
      query: {
        queryKey: getGetMarketOrderbookQueryKey(conditionId),
        refetchInterval: autoRefresh ? 8000 : false,
      },
    }
  );

  const [lastUpdate, setLastUpdate] = useState(Date.now());
  useEffect(() => { if (dataUpdatedAt) setLastUpdate(dataUpdatedAt); }, [dataUpdatedAt]);

  const bids = (book?.bids ?? []).slice(0, 15).sort((a, b) => b.price - a.price);
  const asks = (book?.asks ?? []).slice(0, 15).sort((a, b) => a.price - b.price);
  const maxBidSize = Math.max(...bids.map((b) => b.size), 1);
  const maxAskSize = Math.max(...asks.map((a) => a.size), 1);

  const depthData = [
    ...bids.slice(0, 8).reverse().map((b) => ({ price: b.price.toFixed(3), bid: b.size, ask: 0 })),
    ...asks.slice(0, 8).map((a) => ({ price: a.price.toFixed(3), bid: 0, ask: a.size })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-sm font-bold line-clamp-2 flex-1">{question}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
              autoRefresh ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground"
            )}
          >
            {autoRefresh ? "AUTO" : "PAUSED"}
          </button>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <a
            href={`${POLYMARKET_BASE}${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors border border-border hover:border-primary/40 px-2 py-1 rounded"
          >
            TRADE
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>

      {/* Last price + stats */}
      {book && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-[10px] font-mono text-muted-foreground mb-1">LAST PRICE</div>
            <div className="text-lg font-mono font-bold text-primary">
              {book.lastPrice != null ? `${(book.lastPrice * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-[10px] font-mono text-muted-foreground mb-1">BEST BID</div>
            <div className="text-lg font-mono font-bold text-emerald-400">
              {bids[0] ? `${(bids[0].price * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-[10px] font-mono text-muted-foreground mb-1">BEST ASK</div>
            <div className="text-lg font-mono font-bold text-rose-400">
              {asks[0] ? `${(asks[0].price * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Depth chart */}
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : depthData.length > 0 ? (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[10px] font-mono text-muted-foreground mb-3">DEPTH CHART (Yes outcome)</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={depthData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="price" tick={{ fontSize: 9, fontFamily: "monospace" }} />
              <YAxis tick={{ fontSize: 9, fontFamily: "monospace" }} />
              <Tooltip
                formatter={(v: number, n: string) => [v.toLocaleString(), n === "bid" ? "Bid Size" : "Ask Size"]}
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "monospace", fontSize: 11 }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Bar dataKey="bid" name="bid" fill="rgba(34,197,94,0.6)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="ask" name="ask" fill="rgba(239,68,68,0.6)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Order book table */}
      <div className="grid grid-cols-2 gap-3">
        {/* Bids */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-emerald-500/5">
            <TrendingUp className="h-3 w-3 text-emerald-400" />
            <span className="text-[10px] font-mono font-bold text-emerald-400">BIDS</span>
          </div>
          <div className="divide-y divide-border/50">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 m-2 rounded" />)
            ) : bids.length === 0 ? (
              <div className="p-4 text-[10px] font-mono text-muted-foreground text-center">No bids</div>
            ) : bids.map((b, i) => (
              <div key={i} className="relative flex justify-between items-center px-3 py-1.5 text-xs font-mono">
                <div
                  className="absolute inset-0 bg-emerald-500/8"
                  style={{ width: `${(b.size / maxBidSize) * 100}%` }}
                />
                <span className="relative text-emerald-400 font-bold">{(b.price * 100).toFixed(2)}%</span>
                <span className="relative text-muted-foreground">{b.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Asks */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-rose-500/5">
            <TrendingDown className="h-3 w-3 text-rose-400" />
            <span className="text-[10px] font-mono font-bold text-rose-400">ASKS</span>
          </div>
          <div className="divide-y divide-border/50">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 m-2 rounded" />)
            ) : asks.length === 0 ? (
              <div className="p-4 text-[10px] font-mono text-muted-foreground text-center">No asks</div>
            ) : asks.map((a, i) => (
              <div key={i} className="relative flex justify-between items-center px-3 py-1.5 text-xs font-mono">
                <div
                  className="absolute inset-0 bg-rose-500/8 right-0 left-auto"
                  style={{ width: `${(a.size / maxAskSize) * 100}%` }}
                />
                <span className="relative text-rose-400 font-bold">{(a.price * 100).toFixed(2)}%</span>
                <span className="relative text-muted-foreground">{a.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground text-center">
        Last updated: {new Date(lastUpdate).toLocaleTimeString()} · {autoRefresh ? "auto-refreshing every 8s" : "paused"}
      </p>

      <a
        href={`${POLYMARKET_BASE}${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-mono text-sm font-bold bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
      >
        <Wallet className="h-4 w-4" />
        OPEN ON POLYMARKET TO TRADE
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
