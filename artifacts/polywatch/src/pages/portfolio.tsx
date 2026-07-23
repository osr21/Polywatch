import { useState } from "react";
import {
  useGetPortfolio,
  useGetOpenOrders,
  useGetClosedPositions,
  getGetPortfolioQueryKey,
  getGetOpenOrdersQueryKey,
  getGetClosedPositionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { formatCurrency, cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, AlertTriangle,
  ClipboardList, History, X, Trash2, Loader2, Landmark, ExternalLink,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useUserStream } from "@/lib/userStream";
import { adminAuthHeaders } from "@/lib/adminAuth";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "positions" | "orders" | "closed";

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const pos = value >= 0;
  return (
    <span className={cn("flex items-center gap-1 font-mono font-bold text-sm", pos ? "text-emerald-400" : "text-rose-400")}>
      {pos ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {pos ? "+" : ""}{formatCurrency(value)} ({pos ? "+" : ""}{pct.toFixed(1)}%)
    </span>
  );
}

export default function PortfolioPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("positions");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useGetPortfolio({
    query: { queryKey: getGetPortfolioQueryKey(), refetchInterval: 30000 },
  });

  const { data: openOrders, isLoading: ordersLoading, refetch: refetchOrders } = useGetOpenOrders({
    query: { queryKey: getGetOpenOrdersQueryKey(), refetchInterval: 15000, enabled: tab === "orders" },
  });

  const { data: closedPositions, isLoading: closedLoading, refetch: refetchClosed } = useGetClosedPositions({
    query: { queryKey: getGetClosedPositionsQueryKey(), enabled: tab === "closed" },
  });

  const hasCredError = error && (error as { status?: number }).status === 503;

  useUserStream(() => {
    qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOpenOrdersQueryKey() });
  });

  const cancelOrder = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      const resp = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
        headers: adminAuthHeaders(),
      });
      if (resp.status === 401) throw new Error("UNAUTHORIZED");
      if (!resp.ok) throw new Error("Failed");
      toast.success("Order cancelled");
      qc.invalidateQueries({ queryKey: getGetOpenOrdersQueryKey() });
    } catch (err) {
      toast.error(err instanceof Error && err.message === "UNAUTHORIZED"
        ? "Admin token required — unlock trading in the sidebar"
        : "Failed to cancel order");
    } finally {
      setCancellingId(null);
    }
  };

  const cancelAll = async () => {
    setCancellingAll(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/orders`, {
        method: "DELETE",
        headers: adminAuthHeaders(),
      });
      if (resp.status === 401) throw new Error("UNAUTHORIZED");
      if (!resp.ok) throw new Error("Failed");
      toast.success("All orders cancelled");
      qc.invalidateQueries({ queryKey: getGetOpenOrdersQueryKey() });
    } catch (err) {
      toast.error(err instanceof Error && err.message === "UNAUTHORIZED"
        ? "Admin token required — unlock trading in the sidebar"
        : "Failed to cancel all orders");
    } finally {
      setCancellingAll(false);
    }
  };

  const refetchCurrent = () => {
    if (tab === "positions") refetch();
    else if (tab === "orders") refetchOrders();
    else refetchClosed();
  };

  const isRefetching = tab === "positions" ? isFetching : false;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 pb-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            MY PORTFOLIO
          </h2>
          <button
            onClick={refetchCurrent}
            disabled={isRefetching}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            REFRESH
          </button>
        </div>

        {/* No credentials */}
        {hasCredError && (
          <div className="flex items-start gap-3 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
            <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
            <div className="text-sm font-mono text-orange-300 space-y-1">
              <div className="font-bold">CLOB credentials not configured</div>
              <div className="text-xs text-muted-foreground">Add POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE, and POLY_ADDRESS to your Replit Secrets.</div>
            </div>
          </div>
        )}

        {/* Summary cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard title="PORTFOLIO VALUE" value={formatCurrency(data.totalValue)} />
            <SummaryCard title="USDC BALANCE" value={data.usdcBalance != null ? formatCurrency(data.usdcBalance) : "—"} />
            <SummaryCard title="TOTAL COST" value={formatCurrency(data.totalCost)} />
            <SummaryCard
              title="TOTAL P&L"
              value={<PnlBadge value={data.totalPnl} pct={data.totalPnlPct} />}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 w-fit">
          {([
            { id: "positions" as Tab, label: "OPEN POSITIONS", icon: <Wallet className="h-3.5 w-3.5" /> },
            { id: "orders" as Tab, label: "OPEN ORDERS", icon: <ClipboardList className="h-3.5 w-3.5" /> },
            { id: "closed" as Tab, label: "CLOSED P&L", icon: <History className="h-3.5 w-3.5" /> },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Open Positions */}
        {tab === "positions" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-mono text-sm font-bold">OPEN POSITIONS</h3>
              {data && (
                <span className="text-xs font-mono text-muted-foreground">
                  {data.positions.length} position{data.positions.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : !data || data.positions.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground font-mono text-sm">
                <Wallet className="h-8 w-8 mx-auto opacity-20 mb-3" />
                No open positions found
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.positions.map((pos, i) => {
                  const cost = pos.initialValue ?? (pos.size * pos.avgPrice);
                  const rawPnl = pos.cashPnl ?? (pos.currentValue - cost);
                  const pnl = Number.isFinite(rawPnl) ? rawPnl : 0;
                  const rawPct = pos.percentPnl ?? (cost > 0 ? (pnl / cost) * 100 : 0);
                  const pnlPct = Number.isFinite(rawPct) ? rawPct : 0;
                  const isPos = pnl >= 0;
                  const curPrice = pos.curPrice ?? pos.avgPrice;
                  return (
                    <div key={i} className="px-5 py-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {pos.icon && (
                              <img src={pos.icon} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            )}
                            <span className="font-mono text-sm font-medium text-foreground truncate">{pos.title}</span>
                            <span className={cn(
                              "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border",
                              pos.outcome?.toLowerCase().includes("yes")
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "bg-secondary/15 text-secondary border-secondary/30"
                            )}>
                              {pos.outcome}
                            </span>
                            {pos.redeemable && (
                              <a
                                href="https://polymarket.com/portfolio"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                                title="Redeem on Polymarket"
                              >
                                REDEEMABLE ↗
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground flex-wrap">
                            <span>{pos.size.toFixed(2)} shares</span>
                            <span>avg {(pos.avgPrice * 100).toFixed(1)}¢</span>
                            <span>now {(curPrice * 100).toFixed(1)}¢</span>
                            {pos.endDate && (
                              <span className="text-muted-foreground/60">
                                ends {new Date(pos.endDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <div className="font-mono font-bold text-sm">{formatCurrency(pos.currentValue)}</div>
                          <div className={cn("font-mono text-xs font-bold flex items-center justify-end gap-0.5", isPos ? "text-emerald-400" : "text-rose-400")}>
                            {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {isPos ? "+" : ""}{formatCurrency(pnl)} ({isPos ? "+" : ""}{pnlPct.toFixed(1)}%)
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Open Orders */}
        {tab === "orders" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-mono text-sm font-bold">OPEN ORDERS</h3>
              {openOrders && openOrders.length > 0 && (
                <button
                  onClick={cancelAll}
                  disabled={cancellingAll}
                  className="flex items-center gap-1.5 text-xs font-mono text-rose-400 hover:text-rose-300 border border-rose-500/30 bg-rose-500/10 px-3 py-1 rounded transition-colors disabled:opacity-50"
                >
                  {cancellingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  CANCEL ALL
                </button>
              )}
            </div>
            {ordersLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : !openOrders || openOrders.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground font-mono text-sm">
                <ClipboardList className="h-8 w-8 mx-auto opacity-20 mb-3" />
                No open orders
              </div>
            ) : (
              <div className="divide-y divide-border">
                {openOrders.map((order) => (
                  <div key={order.id} className="px-5 py-4 hover:bg-muted/20 transition-colors flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0",
                          order.side === "BUY"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        )}>
                          {order.side}
                        </span>
                        <span className="font-mono text-sm truncate">{order.market ?? order.asset ?? order.id.slice(0, 16)}</span>
                        {order.orderType && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground border border-border shrink-0">
                            {order.orderType}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                        <span>{order.size.toFixed(2)} shares @ {(order.price * 100).toFixed(1)}¢</span>
                        <span className="text-muted-foreground/60">{order.status}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="font-mono font-bold text-sm">{formatCurrency(order.size * order.price)}</div>
                      <button
                        onClick={() => cancelOrder(order.id)}
                        disabled={cancellingId === order.id}
                        className="flex items-center gap-1 text-[10px] font-mono text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-50 ml-auto"
                      >
                        {cancellingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        CANCEL
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Closed Positions */}
        {tab === "closed" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-mono text-sm font-bold">CLOSED POSITIONS</h3>
              {closedPositions && (
                <span className="text-xs font-mono text-muted-foreground">{closedPositions.length} closed</span>
              )}
            </div>
            {closedLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : !closedPositions || closedPositions.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground font-mono text-sm">
                <History className="h-8 w-8 mx-auto opacity-20 mb-3" />
                No closed positions found
              </div>
            ) : (
              <div className="divide-y divide-border">
                {closedPositions.map((pos, i) => {
                  const pnl = Number.isFinite(pos.cashPnl) ? pos.cashPnl : 0;
                  const pct = Number.isFinite(pos.percentPnl ?? NaN) ? pos.percentPnl : null;
                  const isPos = pnl >= 0;
                  return (
                    <div key={i} className="px-5 py-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {pos.icon && (
                              <img src={pos.icon} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            )}
                            <span className="font-mono text-sm font-medium truncate">{pos.title}</span>
                            <span className={cn(
                              "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border",
                              pos.outcome?.toLowerCase().includes("yes")
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "bg-secondary/15 text-secondary border-secondary/30"
                            )}>
                              {pos.outcome}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                            <span>{pos.size.toFixed(2)} shares @ avg {(pos.avgPrice * 100).toFixed(1)}¢</span>
                            {pos.closedAt && (
                              <span className="text-muted-foreground/60">
                                {new Date(pos.closedAt * 1000).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={cn("font-mono font-bold text-sm shrink-0", isPos ? "text-emerald-400" : "text-rose-400")}>
                          {isPos ? "+" : ""}{formatCurrency(pnl)}
                          {pct != null && (
                            <div className="text-[10px] text-right">{isPos ? "+" : ""}{pct.toFixed(1)}%</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Lending Power Calculator */}
        {tab === "positions" && !isLoading && data && data.positions.length > 0 && (() => {
          const totalCollateral = data.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
          const conservativeBorrow = totalCollateral * 0.5;
          const aggressiveBorrow   = totalCollateral * 0.7;
          return (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-bold flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" />
                  LENDING POWER
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground">hypothetical · outcome tokens as collateral</span>
              </div>

              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background border border-border rounded-lg p-3">
                  <div className="text-[10px] font-mono text-muted-foreground mb-1">COLLATERAL VALUE</div>
                  <div className="font-mono font-bold text-base">{formatCurrency(totalCollateral)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">current mark value</div>
                </div>
                <div className="bg-background border border-emerald-500/20 rounded-lg p-3">
                  <div className="text-[10px] font-mono text-muted-foreground mb-1">50% LTV (CONSERVATIVE)</div>
                  <div className="font-mono font-bold text-base text-emerald-400">{formatCurrency(conservativeBorrow)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">borrow capacity</div>
                </div>
                <div className="bg-background border border-amber-500/20 rounded-lg p-3">
                  <div className="text-[10px] font-mono text-muted-foreground mb-1">70% LTV (AGGRESSIVE)</div>
                  <div className="font-mono font-bold text-base text-amber-400">{formatCurrency(aggressiveBorrow)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">borrow capacity</div>
                </div>
              </div>

              {/* Per-position breakdown */}
              <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-muted/30 text-[10px] font-mono text-muted-foreground font-bold">
                  <span className="col-span-2">POSITION</span>
                  <span className="text-right">MARK VALUE</span>
                  <span className="text-right">50% LTV</span>
                </div>
                {data.positions.map((pos, i) => {
                  const val = pos.currentValue ?? 0;
                  return (
                    <div key={i} className="grid grid-cols-4 gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className="col-span-2 min-w-0">
                        <div className="text-[11px] font-mono truncate">{pos.title}</div>
                        <div className={cn(
                          "text-[9px] font-mono font-bold",
                          pos.outcome?.toLowerCase().includes("yes") ? "text-primary" : "text-secondary"
                        )}>{pos.outcome}</div>
                      </div>
                      <div className="text-right font-mono text-[11px] font-bold">{formatCurrency(val)}</div>
                      <div className="text-right font-mono text-[11px] text-emerald-400">{formatCurrency(val * 0.5)}</div>
                    </div>
                  );
                })}
              </div>

              {/* Protocol links */}
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-muted-foreground font-bold">COLLATERAL PROTOCOLS (EXPERIMENTAL)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { name: "Opyn", url: "https://opyn.co", desc: "Options & collateral on outcome tokens" },
                    { name: "Strips Finance", url: "https://strips.finance", desc: "Interest rate & structured products" },
                    { name: "Polymarket Docs", url: "https://docs.polymarket.com", desc: "Protocol & conditional token standard" },
                  ].map((p) => (
                    <a
                      key={p.name}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 p-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors group"
                    >
                      <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary mt-0.5 shrink-0 transition-colors" />
                      <div>
                        <div className="text-[11px] font-mono font-bold group-hover:text-primary transition-colors">{p.name}</div>
                        <div className="text-[9px] font-mono text-muted-foreground">{p.desc}</div>
                      </div>
                    </a>
                  ))}
                </div>
                <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
                  LTV ratios are illustrative — actual lending terms depend on the protocol and market liquidity.
                  Outcome token lending is experimental; verify protocol security before use.
                </p>
              </div>
            </div>
          );
        })()}

        {data?.address && (
          <div className="text-xs font-mono text-muted-foreground/50 text-center">
            Portfolio for {data.address}
          </div>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] font-mono text-muted-foreground mb-2">{title}</div>
      <div className="text-xl font-mono font-bold">{value}</div>
    </div>
  );
}
