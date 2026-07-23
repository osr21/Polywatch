import { useState } from "react";
import { useGetPerpsInstruments, getGetPerpsInstrumentsQueryKey, useGetPerpsTrades, getGetPerpsTradesQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, formatTimeAgo, cn } from "@/lib/utils";
import { TrendingUp, RefreshCw, Activity, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PerpsPage() {
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string | null>(null);

  const { data: instruments, isLoading: isLoadingInstruments, refetch: refetchInstruments, isFetching: isFetchingInstruments } = useGetPerpsInstruments(
    { query: { queryKey: getGetPerpsInstrumentsQueryKey(), refetchInterval: 30000 } }
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6 pb-8 flex flex-col h-[calc(100vh-8rem)]">
        
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-mono font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              PERPETUALS TRACKER
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/20 text-primary border border-primary/30">
              EARLY ACCESS
            </span>
          </div>
          <button
            onClick={() => refetchInstruments()}
            disabled={isFetchingInstruments}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetchingInstruments && "animate-spin")} />
            REFRESH
          </button>
        </div>

        {/* Instruments Panel */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shrink-0 flex flex-col max-h-[40vh]">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-sm font-bold">INSTRUMENTS</h3>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm font-mono text-left whitespace-nowrap">
              <thead className="bg-muted/20 border-b border-border text-xs text-muted-foreground sticky top-0 backdrop-blur-md">
                <tr>
                  <th className="p-3 font-normal">SYMBOL</th>
                  <th className="p-3 font-normal text-right">MARK PRICE</th>
                  <th className="p-3 font-normal text-right">INDEX PRICE</th>
                  <th className="p-3 font-normal text-right">FUNDING RATE</th>
                  <th className="p-3 font-normal text-right">24H VOL</th>
                  <th className="p-3 font-normal text-right">24H CHANGE</th>
                  <th className="p-3 font-normal text-right">OI</th>
                  <th className="p-3 font-normal text-right">MAX LEV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoadingInstruments ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="p-3"><Skeleton className="h-6 w-full" /></td>
                    </tr>
                  ))
                ) : !instruments || instruments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground font-mono">
                      No instruments available right now.
                    </td>
                  </tr>
                ) : (
                  instruments.map((inst) => {
                    const isSelected = selectedInstrumentId === inst.id;
                    const change24 = parseFloat(String(inst.change24h || "0"));
                    const fundingRate = parseFloat(String(inst.fundingRate || "0"));
                    
                    return (
                      <tr 
                        key={inst.id}
                        onClick={() => setSelectedInstrumentId(inst.id ?? null)}
                        className={cn(
                          "cursor-pointer transition-colors",
                          isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/30"
                        )}
                      >
                        <td className="p-3 font-bold text-foreground flex items-center gap-2">
                          {isSelected && <div className="w-1 h-4 bg-primary rounded-full" />}
                          {inst.symbol}
                        </td>
                        <td className="p-3 text-right">{inst.markPrice}</td>
                        <td className="p-3 text-right text-muted-foreground">{inst.indexPrice}</td>
                        <td className={cn(
                          "p-3 text-right",
                          fundingRate > 0 ? "text-emerald-400" : fundingRate < 0 ? "text-rose-400" : "text-muted-foreground"
                        )}>
                          {(fundingRate * 100).toFixed(4)}%
                        </td>
                        <td className="p-3 text-right">{formatCurrency(parseFloat(String(inst.volume24h || "0")))}</td>
                        <td className={cn(
                          "p-3 text-right",
                          change24 > 0 ? "text-emerald-400" : change24 < 0 ? "text-rose-400" : "text-muted-foreground"
                        )}>
                          {change24 > 0 ? "+" : ""}{change24.toFixed(2)}%
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{formatCurrency(parseFloat(String(inst.openInterest || "0")))}</td>
                        <td className="p-3 text-right text-xs text-primary">{inst.maxLeverage}x</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trades Panel */}
        <div className="bg-card border border-border rounded-xl flex flex-col flex-1 overflow-hidden min-h-[30vh]">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold flex items-center gap-2">
              <ListIcon className="h-4 w-4 text-primary" />
              RECENT TRADES
            </h3>
            {selectedInstrumentId && (
              <span className="text-xs font-mono text-muted-foreground">
                Filtering by {instruments?.find(i => i.id === selectedInstrumentId)?.symbol}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <TradesList instrumentId={selectedInstrumentId} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ListIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="8" y1="6" x2="21" y2="6"></line>
      <line x1="8" y1="12" x2="21" y2="12"></line>
      <line x1="8" y1="18" x2="21" y2="18"></line>
      <line x1="3" y1="6" x2="3.01" y2="6"></line>
      <line x1="3" y1="12" x2="3.01" y2="12"></line>
      <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>
  );
}

function TradesList({ instrumentId }: { instrumentId: string | null }) {
  const { data: trades, isLoading } = useGetPerpsTrades(
    { instrumentId, limit: 50 },
    { query: { queryKey: getGetPerpsTradesQueryKey({ instrumentId, limit: 50 }), refetchInterval: 10000 } }
  );

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (!trades || trades.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-muted-foreground font-mono border border-dashed border-border m-4 rounded-xl">
        No recent trades found for this instrument.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm font-mono text-left whitespace-nowrap">
        <thead className="bg-muted/10 border-b border-border text-xs text-muted-foreground sticky top-0 backdrop-blur-md">
          <tr>
            <th className="p-3 font-normal">TIME</th>
            <th className="p-3 font-normal">SYMBOL</th>
            <th className="p-3 font-normal">SIDE</th>
            <th className="p-3 font-normal text-right">SIZE</th>
            <th className="p-3 font-normal text-right">PRICE</th>
            <th className="p-3 font-normal text-right">WALLET</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {trades.map((t) => (
            <tr key={t.id} className="hover:bg-muted/20 transition-colors">
              <td className="p-3 text-muted-foreground text-xs">{formatTimeAgo(t.timestamp)}</td>
              <td className="p-3">{t.instrumentSymbol}</td>
              <td className="p-3">
                <span className={cn(
                  "text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 w-max",
                  t.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                )}>
                  {t.side === "BUY" ? <ArrowUpCircle className="h-3 w-3" /> : <ArrowDownCircle className="h-3 w-3" />}
                  {t.side}
                </span>
              </td>
              <td className="p-3 text-right font-bold">{t.size}</td>
              <td className="p-3 text-right text-muted-foreground">{t.price}</td>
              <td className="p-3 text-right text-xs text-primary/70">{t.traderAddress ? t.traderAddress.slice(0, 6) : ""}...{t.traderAddress ? t.traderAddress.slice(-4) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}