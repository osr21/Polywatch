import { useState, useEffect, useRef } from "react";
import { useGetWhaleTrades, useGetMarketMomentum, getGetWhaleTradesQueryKey, getGetMarketMomentumQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, cn } from "@/lib/utils";
import { Link } from "wouter";
import {
  Brain, TrendingUp, TrendingDown, Minus, AlertTriangle,
  ChevronDown, ChevronUp, Loader2, KeyRound, Target, Eye,
  ArrowUpRight, ArrowDownRight, ShieldAlert, BarChart2,
  RefreshCw, ChevronsDown, ChevronsUp, Clock, Wallet,
  Bitcoin, ExternalLink, Zap, ArrowUp, ArrowDown,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getStoredApiKey, setStoredApiKey } from "@/lib/secrets";

// ─── Crypto signals types ────────────────────────────────────────────────────
interface CoinData {
  symbol: string;
  name: string;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  upProb: number | null;
  downProb: number | null;
  marketTitle: string | null;
  marketSlug: string | null;
  marketCloses: string | null;
}

interface CryptoSignal {
  symbol: string;
  direction: "UP" | "DOWN";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  edge: string;
  outcome: "UP" | "DOWN";
}

interface CryptoAnalysis {
  summary?: string;
  signals?: CryptoSignal[];
}

interface CryptoSignalsResponse {
  coins: CoinData[];
  analysis: CryptoAnalysis;
  fearGreed: { value: number; label: string } | null;
  generatedAt: number;
}

// ─── Whale signals types ─────────────────────────────────────────────────────
interface AiSignal {
  title: string;
  insight: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: "low" | "medium" | "high";
  markets?: string[];
  action?: string;
}

interface AnalysisMeta {
  trades: number;
  totalVolume: number;
  buyPct: number;
  uniqueWallets: number;
}

interface AiResponse {
  insights: AiSignal[];
  meta?: AnalysisMeta;
  titleToSlug?: Record<string, string>;
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const SIZE_OPTIONS = [
  { label: "$1K+",  value: 1000 },
  { label: "$5K+",  value: 5000 },
  { label: "$10K+", value: 10000 },
  { label: "$25K+", value: 25000 },
  { label: "$50K+", value: 50000 },
];

const ACTION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  consider_long:  { label: "CONSIDER LONG",  color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: <ArrowUpRight className="h-3 w-3" /> },
  consider_short: { label: "CONSIDER SHORT", color: "text-rose-400 bg-rose-500/10 border-rose-500/30",         icon: <ArrowDownRight className="h-3 w-3" /> },
  watch:          { label: "WATCH",           color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",   icon: <Eye className="h-3 w-3" /> },
  avoid:          { label: "AVOID",           color: "text-rose-400 bg-rose-500/10 border-rose-500/30",         icon: <ShieldAlert className="h-3 w-3" /> },
  monitor_wallet: { label: "MONITOR WALLET",  color: "text-primary bg-primary/10 border-primary/30",            icon: <Eye className="h-3 w-3" /> },
};

function riskColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-rose-400";
  if (score >= 50) return "text-orange-400";
  if (score >= 25) return "text-yellow-400";
  return "text-emerald-400";
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const COIN_EMOJI: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", XRP: "✕", DOGE: "Ð", BNB: "B",
};

type CryptoTab = "1h" | "4h" | "1d";
const CRYPTO_TABS: { key: CryptoTab; label: string; gammaLabel: string }[] = [
  { key: "1h", label: "1H CRYPTO",    gammaLabel: "1-hour"  },
  { key: "4h", label: "4H CRYPTO",    gammaLabel: "4-hour"  },
  { key: "1d", label: "DAILY CRYPTO", gammaLabel: "daily"   },
];

type PageTab = "whale" | "momentum" | CryptoTab;

export default function SignalsPage() {
  const [tab, setTab] = useState<PageTab>("whale");

  // ── Crypto signals state (per timeframe) ──────────────────────────────────
  const [cryptoData, setCryptoData]     = useState<Partial<Record<CryptoTab, CryptoSignalsResponse>>>({});
  const [cryptoLoading, setCryptoLoading] = useState<CryptoTab | null>(null);
  const [cryptoAt, setCryptoAt]         = useState<Partial<Record<CryptoTab, number>>>({});

  const analyzeCrypto = async (tf: CryptoTab) => {
    const key = getStoredApiKey();
    setCryptoLoading(tf);
    try {
      const resp = await fetch(`${BASE_URL}/api/ai/crypto-signals?timeframe=${tf}`, {
        headers: key ? { "X-OpenAI-Key": key } : {},
      });
      if (resp.status === 429) { toast.error("Rate limited — please wait 30 seconds between analyses."); setCryptoLoading(null); return; }
      if (resp.status === 503) { toast.error("OpenAI API key required — add it in Whale Analysis tab"); setCryptoLoading(null); return; }
      if (!resp.ok) { toast.error("Crypto analysis failed"); setCryptoLoading(null); return; }
      const data = await resp.json() as CryptoSignalsResponse;
      setCryptoData((prev) => ({ ...prev, [tf]: data }));
      setCryptoAt((prev) => ({ ...prev, [tf]: Date.now() }));
    } catch { toast.error("Network error"); }
    finally { setCryptoLoading(null); }
  };

  const [minSize, setMinSize] = useState(1000);

  const { data: trades, isLoading: tradesLoading } = useGetWhaleTrades(
    { limit: 100, minSize },
    { query: { queryKey: getGetWhaleTradesQueryKey({ limit: 100, minSize }), refetchInterval: 30000 } }
  );

  const [signals, setSignals]       = useState<AiSignal[]>([]);
  const [meta, setMeta]             = useState<AnalysisMeta | null>(null);
  const [titleToSlug, setTitleToSlug] = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(false);
  const [inlineKey, setInlineKey]   = useState("");
  const [needsKey, setNeedsKey]     = useState(false);
  const [expanded, setExpanded]     = useState<number | null>(null);
  const [expandAll, setExpandAll]   = useState(false);
  const [analyzedAt, setAnalyzedAt] = useState<number | null>(null);
  const [analyzedTradeCount, setAnalyzedTradeCount] = useState<number>(0);
  const [tick, setTick]             = useState(0);

  // Track "new trades since last analysis" banner
  const prevTradeCountRef = useRef<number>(0);
  const [newTradesAvailable, setNewTradesAvailable] = useState(false);

  // Tick timestamp every 30s so timeAgo updates
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Detect new trades arriving after an analysis was done
  useEffect(() => {
    const current = trades?.length ?? 0;
    if (analyzedAt && current > analyzedTradeCount && prevTradeCountRef.current === analyzedTradeCount) {
      setNewTradesAvailable(true);
    }
    prevTradeCountRef.current = current;
  }, [trades?.length, analyzedAt, analyzedTradeCount]);

  const analyze = async (overrideKey?: string) => {
    if (!trades || trades.length === 0) return;
    const key = overrideKey ?? getStoredApiKey();
    setLoading(true);
    setNeedsKey(false);
    setNewTradesAvailable(false);
    try {
      const resp = await fetch(`${BASE_URL}/api/ai/signals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "X-OpenAI-Key": key } : {}),
        },
        body: JSON.stringify({ trades: trades.slice(0, 50), minSize }),
      });
      if (resp.status === 429) { toast.error("Rate limited — please wait 30 seconds between analyses.", { duration: 6000 }); setLoading(false); return; }
      if (resp.status === 503) { setNeedsKey(true); setLoading(false); return; }
      if (!resp.ok) {
        let message = "AI analysis failed";
        try {
          const body = await resp.json() as { code?: string; error?: string };
          if (body.code === "insufficient_quota" || resp.status === 402)
            message = "OpenAI quota exceeded — top up at platform.openai.com/settings/billing.";
          else if (body.code === "invalid_api_key")
            message = "Invalid OpenAI API key.";
          else if (body.error) message = body.error;
        } catch { /* ignore */ }
        toast.error(message, { duration: 8000 });
        setLoading(false);
        return;
      }
      const data = await resp.json() as AiResponse;
      setSignals(data.insights ?? []);
      setMeta(data.meta ?? null);
      setTitleToSlug(data.titleToSlug ?? {});
      setAnalyzedAt(Date.now());
      setAnalyzedTradeCount(trades.length);
      setExpanded(null);
      setExpandAll(false);
      if (data.insights?.length === 0) toast.info("No significant signals detected");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleInlineRetry = () => {
    const trimmed = inlineKey.trim();
    if (trimmed) { setStoredApiKey(trimmed); toast.success("API key saved to browser"); }
    void analyze(trimmed || undefined);
  };

  const signalColor = (s: AiSignal["signal"]) => ({
    bullish: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    bearish: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    neutral: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  }[s]);

  const confidenceColor = (c: AiSignal["confidence"]) => ({
    high:   "text-primary bg-primary/10 border-primary/30",
    medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    low:    "text-muted-foreground bg-muted border-border",
  }[c]);

  const SignalIcon = ({ signal }: { signal: AiSignal["signal"] }) => {
    if (signal === "bullish") return <TrendingUp className="h-4 w-4 text-emerald-400" />;
    if (signal === "bearish") return <TrendingDown className="h-4 w-4 text-rose-400" />;
    return <Minus className="h-4 w-4 text-yellow-400" />;
  };

  const tradeList  = trades ?? [];
  const buyCount   = tradeList.filter(t => t.side === "BUY").length;
  const sellCount  = tradeList.filter(t => t.side === "SELL").length;
  const totalVol   = tradeList.reduce((s, t) => s + (t.usdcSize ?? 0), 0);
  const buyVol     = tradeList.filter(t => t.side === "BUY").reduce((s, t) => s + (t.usdcSize ?? 0), 0);
  const buyPct     = totalVol > 0 ? Math.round(buyVol / totalVol * 100) : 50;
  const tooFew     = tradeList.length > 0 && tradeList.length < 5;

  const effectiveExpanded = (i: number) => expandAll || expanded === i;

  // unused tick to force re-render for timeAgo
  void tick;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-5 pb-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI SIGNALS
          </h2>
          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
            {tab === "whale" && analyzedAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(analyzedAt)}
              </span>
            )}
            {tab !== "whale" && cryptoAt[tab as CryptoTab] && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(cryptoAt[tab as CryptoTab]!)}
              </span>
            )}
            <span>Powered by GPT-4.1</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit flex-wrap">
          <button
            onClick={() => setTab("whale")}
            className={cn(
              "px-4 py-1.5 rounded text-xs font-mono font-bold transition-colors flex items-center gap-1.5",
              tab === "whale"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <BarChart2 className="h-3 w-3" /> WHALE ANALYSIS
          </button>
          <button
            onClick={() => setTab("momentum")}
            className={cn(
              "px-4 py-1.5 rounded text-xs font-mono font-bold transition-colors flex items-center gap-1.5",
              tab === "momentum"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3 w-3" /> MOMENTUM
          </button>
          {CRYPTO_TABS.map((ct) => (
            <button
              key={ct.key}
              onClick={() => setTab(ct.key)}
              className={cn(
                "px-4 py-1.5 rounded text-xs font-mono font-bold transition-colors flex items-center gap-1.5",
                tab === ct.key
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Bitcoin className="h-3 w-3" /> {ct.label}
            </button>
          ))}
        </div>

        {/* ── CRYPTO MARKETS TAB ─────────────────────────────────────────── */}
        {tab !== "whale" && tab !== "momentum" && (() => {
          const tf = tab as CryptoTab;
          const ct = CRYPTO_TABS.find((c) => c.key === tf)!;
          const data = cryptoData[tf] ?? null;
          const isLoading = cryptoLoading === tf;
          const at = cryptoAt[tf] ?? null;
          void at;
          return (
          <div className="space-y-5">
            {/* Analyze button */}
            <button
              onClick={() => void analyzeCrypto(tf)}
              disabled={isLoading}
              className="w-full py-3 rounded-xl font-mono text-sm font-bold bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" />FETCHING PRICES + ANALYZING…</>
              ) : (
                <><Bitcoin className="h-4 w-4" />{data ? `RE-ANALYZE ${ct.label} MARKETS` : `ANALYZE ${ct.label} MARKETS`}</>
              )}
            </button>

            {/* Loading skeleton */}
            {isLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
              </div>
            )}

            {/* Summary + Fear & Greed */}
            {!isLoading && (data?.analysis?.summary || data?.fearGreed) && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                {data?.fearGreed && (
                  <div className="flex items-center gap-3">
                    <div className="text-[10px] font-mono text-muted-foreground font-bold">FEAR & GREED</div>
                    <div className={cn(
                      "font-mono text-xs font-bold px-2 py-0.5 rounded border",
                      data.fearGreed.value >= 75 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" :
                      data.fearGreed.value >= 55 ? "text-green-400 bg-green-500/10 border-green-500/30" :
                      data.fearGreed.value >= 45 ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" :
                      data.fearGreed.value >= 25 ? "text-orange-400 bg-orange-500/10 border-orange-500/30" :
                      "text-rose-400 bg-rose-500/10 border-rose-500/30"
                    )}>
                      {data.fearGreed.value}/100 — {data.fearGreed.label}
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all",
                          data.fearGreed.value >= 75 ? "bg-emerald-500" :
                          data.fearGreed.value >= 55 ? "bg-green-500" :
                          data.fearGreed.value >= 45 ? "bg-yellow-500" :
                          data.fearGreed.value >= 25 ? "bg-orange-500" : "bg-rose-500"
                        )}
                        style={{ width: `${data.fearGreed.value}%` }}
                      />
                    </div>
                  </div>
                )}
                {data?.analysis?.summary && (
                  <>
                    <div className="text-[10px] font-mono text-muted-foreground font-bold">MARKET SUMMARY</div>
                    <p className="text-sm font-mono text-foreground/80 leading-relaxed">{data.analysis.summary}</p>
                  </>
                )}
              </div>
            )}

            {/* Coin cards grid */}
            {!isLoading && data && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.coins.map((coin) => {
                  const sig = data.analysis.signals?.find((s) => s.symbol === coin.symbol);
                  const isUp = sig?.direction === "UP";
                  const confColor = sig?.confidence === "high"
                    ? "text-primary bg-primary/10 border-primary/30"
                    : sig?.confidence === "medium"
                    ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                    : "text-muted-foreground bg-muted border-border";
                  return (
                    <div key={coin.symbol} className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary/30 transition-colors">
                      {/* Coin header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-mono font-bold text-primary w-8 text-center">
                            {COIN_EMOJI[coin.symbol] ?? (coin.symbol.length > 0 ? coin.symbol[0] : "?")}
                          </span>
                          <div>
                            <div className="font-mono text-sm font-bold">{coin.symbol}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{coin.name}</div>
                          </div>
                        </div>
                        {sig && (
                          <div className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md border font-mono text-xs font-bold",
                            isUp ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" : "text-rose-400 bg-rose-500/10 border-rose-500/30"
                          )}>
                            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {sig.direction}
                          </div>
                        )}
                      </div>

                      {/* Price row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="font-mono text-base font-bold">
                            {coin.price != null
                              ? "$" + coin.price.toLocaleString("en-US", { maximumFractionDigits: coin.price < 1 ? 5 : coin.price < 10 ? 4 : 2 })
                              : "—"}
                          </div>
                          {/* 1h change — primary signal */}
                          {coin.change1h != null && (
                            <div className={cn("text-xs font-mono font-bold", coin.change1h >= 0 ? "text-emerald-400" : "text-rose-400")}>
                              {coin.change1h >= 0 ? "▲ +" : "▼ "}{coin.change1h.toFixed(3)}% <span className="opacity-60">1h</span>
                            </div>
                          )}
                          {/* 24h + 7d secondary */}
                          <div className="flex gap-2">
                            {coin.change24h != null && (
                              <span className={cn("text-[10px] font-mono", coin.change24h >= 0 ? "text-emerald-400/70" : "text-rose-400/70")}>
                                {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(2)}% <span className="opacity-50">24h</span>
                              </span>
                            )}
                            {coin.change7d != null && (
                              <span className={cn("text-[10px] font-mono", coin.change7d >= 0 ? "text-emerald-400/50" : "text-rose-400/50")}>
                                {coin.change7d >= 0 ? "+" : ""}{coin.change7d.toFixed(1)}% <span className="opacity-50">7d</span>
                              </span>
                            )}
                          </div>
                        </div>
                        {sig && (
                          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0", confColor)}>
                            {sig.confidence} conf.
                          </span>
                        )}
                      </div>

                      {/* Polymarket odds bar */}
                      {coin.upProb != null && coin.downProb != null ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                            <span className="text-emerald-400 font-bold">UP {(coin.upProb * 100).toFixed(1)}%</span>
                            <span className="text-[9px] text-center">
                              {coin.marketCloses && !isNaN(new Date(coin.marketCloses).getTime())
                                ? "closes " + new Date(coin.marketCloses).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : `Polymarket ${ct.gammaLabel} odds`}
                            </span>
                            <span className="text-rose-400 font-bold">DOWN {(coin.downProb * 100).toFixed(1)}%</span>
                          </div>
                          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                            <div className="bg-emerald-500/70 transition-all" style={{ width: `${coin.upProb * 100}%` }} />
                            <div className="bg-rose-500/70 flex-1" />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] font-mono text-muted-foreground/40 italic">No Polymarket market — technical signal only</div>
                      )}

                      {/* AI reasoning */}
                      {sig && (
                        <div className="space-y-1.5 border-t border-border pt-2">
                          <p className="text-[11px] font-mono text-foreground/70 leading-relaxed">{sig.reasoning}</p>
                          <p className="text-[10px] font-mono text-primary/70 italic">{sig.edge}</p>
                        </div>
                      )}

                      {/* Bet recommendation + link */}
                      {sig && coin.marketSlug && (
                        <a
                          href={`https://polymarket.com/event/${coin.marketSlug}`}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md border text-[11px] font-mono font-bold transition-colors",
                            sig.outcome === "UP"
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                          )}
                        >
                          BET {sig.outcome} ON POLYMARKET
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !data && (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Bitcoin className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
                <p className="font-mono text-sm text-muted-foreground">
                  Click analyze to fetch live prices and Polymarket odds for BTC, ETH, SOL, XRP, DOGE and BNB,
                  then get GPT-4.1 direction signals for each {ct.gammaLabel} market.
                </p>
              </div>
            )}
          </div>
          );
        })()}

        {/* ── MOMENTUM MARKETS TAB ─────────────────────────────────────── */}
        {tab === "momentum" && <MomentumTab />}

        {/* ── WHALE ANALYSIS TAB ─────────────────────────────────────────── */}
        {tab === "whale" && (<div className="space-y-5">

        {/* Controls + stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="text-[10px] font-mono text-muted-foreground font-bold uppercase">Min Trade Size</div>
            <div className="flex gap-1 flex-wrap">
              {SIZE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setMinSize(opt.value); setSignals([]); setMeta(null); setAnalyzedAt(null); setNewTradesAvailable(false); }}
                  className={cn(
                    "px-2.5 py-1 rounded font-mono text-xs font-bold border transition-colors",
                    minSize === opt.value
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="text-[10px] font-mono text-muted-foreground font-bold uppercase">Feed Stats</div>
            {tradesLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-base font-mono font-bold text-foreground">{tradeList.length}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">TRADES</div>
                </div>
                <div>
                  <div className="text-base font-mono font-bold text-primary">{formatCurrency(totalVol)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">VOLUME</div>
                </div>
                <div>
                  <div className={cn("text-base font-mono font-bold", buyPct >= 60 ? "text-emerald-400" : buyPct <= 40 ? "text-rose-400" : "text-yellow-400")}>
                    {buyPct}%
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">BUY PRESS.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Low-trade warning */}
        {tooFew && (
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs font-mono text-yellow-300">
              Only {tradeList.length} trade{tradeList.length !== 1 ? "s" : ""} at this threshold — analysis quality will be limited.
              Try a lower size filter for more data.
            </p>
          </div>
        )}

        {/* New trades banner */}
        {newTradesAvailable && (
          <button
            onClick={() => void analyze()}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-mono font-bold hover:bg-primary/20 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            NEW WHALE ACTIVITY DETECTED — CLICK TO RE-ANALYZE
          </button>
        )}

        {/* Feed preview */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-muted-foreground font-bold">
              WHALE FEED — {minSize >= 1000 ? `$${(minSize / 1000).toFixed(0)}K+` : `$${minSize}+`} TRADES ({tradeList.length})
            </h3>
            <div className="flex gap-3 text-[10px] font-mono">
              <span className="text-primary">{buyCount} BUY</span>
              <span className="text-secondary">{sellCount} SELL</span>
            </div>
          </div>
          {tradesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : tradeList.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground py-4 text-center">
              No trades found at this threshold — try a lower size filter.
            </p>
          ) : (
            <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
              {tradeList.slice(0, 20).map((t, i) => (
                <div key={t.transactionHash ?? i} className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-border/30 last:border-0 group">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0",
                      t.side === "BUY" ? "bg-primary/15 text-primary" : "bg-secondary/15 text-secondary"
                    )}>
                      {t.side}
                    </span>
                    {/* Market link — prefer Gamma event slug from titleToSlug map;
                        fall back to raw data-api slug only when no mapping exists */}
                    {t.slug ? (
                      <a
                        href={`https://polymarket.com/event/${(t.title && titleToSlug[t.title]) ? titleToSlug[t.title] : t.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground truncate hover:text-foreground transition-colors"
                        title={t.title ?? ""}
                      >
                        {t.title}
                      </a>
                    ) : (
                      <span className="text-muted-foreground truncate">{t.title}</span>
                    )}
                    {t.outcome && <span className="text-muted-foreground/50 shrink-0 hidden sm:inline">· {t.outcome}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {/* Wallet link */}
                    {t.proxyWallet && (
                      <Link
                        href={`/wallet/${t.proxyWallet}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="hidden sm:flex items-center gap-1 text-[9px] font-mono text-muted-foreground/50 hover:text-primary transition-colors"
                        title={`View wallet: ${t.proxyWallet}`}
                      >
                        <Wallet className="h-2.5 w-2.5" />
                        {t.pseudonym ? t.pseudonym.slice(0, 12) : t.proxyWallet.slice(0, 8) + "…"}
                      </Link>
                    )}
                    {t.riskScore != null && (
                      <span className={cn("text-[9px] font-mono", riskColor(t.riskScore))}>
                        R{t.riskScore}
                      </span>
                    )}
                    <span className={cn("font-bold", t.side === "BUY" ? "text-primary" : "text-secondary")}>
                      {formatCurrency(t.usdcSize)}
                    </span>
                  </div>
                </div>
              ))}
              {tradeList.length > 20 && (
                <p className="text-[10px] font-mono text-muted-foreground/50 text-center pt-1">
                  +{tradeList.length - 20} more trades included in analysis
                </p>
              )}
            </div>
          )}
        </div>

        {/* API key input if needed */}
        {needsKey && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-orange-400 text-sm font-mono font-bold">
              <KeyRound className="h-4 w-4" />
              OPENAI API KEY REQUIRED
            </div>
            <p className="text-xs font-mono text-muted-foreground">
              Enter your OpenAI key below — it will be saved to your browser and auto-used next time.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="sk-..."
                value={inlineKey}
                onChange={(e) => setInlineKey(e.target.value)}
                className="font-mono text-xs bg-background border-border flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleInlineRetry()}
              />
              <button
                onClick={handleInlineRetry}
                disabled={!inlineKey || loading}
                className="px-4 py-2 rounded-md font-mono text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                SAVE & RUN
              </button>
            </div>
          </div>
        )}

        {/* Analyze button */}
        {!needsKey && (
          <button
            onClick={() => void analyze()}
            disabled={loading || tradesLoading || tradeList.length === 0}
            className="w-full py-3 rounded-xl font-mono text-sm font-bold bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                ANALYZING {Math.min(tradeList.length, 50)} TRADES…
              </>
            ) : (
              <>
                <Brain className="h-4 w-4" />
                {signals.length > 0 ? "RE-ANALYZE" : "ANALYZE"} {Math.min(tradeList.length, 50)} TRADES WITH AI
              </>
            )}
          </button>
        )}

        {/* Analysis meta bar */}
        {meta && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {([
              { label: "TRADES ANALYZED", value: String(meta.trades) },
              { label: "TOTAL VOLUME",    value: formatCurrency(meta.totalVolume) },
              { label: "BUY PRESSURE",    value: `${meta.buyPct}%` },
              { label: "UNIQUE WALLETS",  value: String(meta.uniqueWallets) },
            ] as { label: string; value: string }[]).map(({ label, value }) => (
              <div key={label} className="bg-card border border-border rounded-lg p-2">
                <div className="text-sm font-mono font-bold text-primary">{value}</div>
                <div className="text-[9px] font-mono text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Signals */}
        {signals.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono text-muted-foreground font-bold flex items-center gap-2">
                <BarChart2 className="h-3.5 w-3.5" />
                SIGNALS ({signals.length})
              </h3>
              <button
                onClick={() => { setExpandAll(v => !v); setExpanded(null); }}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                {expandAll
                  ? <><ChevronsUp className="h-3 w-3" /> COLLAPSE ALL</>
                  : <><ChevronsDown className="h-3 w-3" /> EXPAND ALL</>}
              </button>
            </div>
            {signals.map((sig, i) => {
              const actionMeta = sig.action ? ACTION_META[sig.action] : null;
              const isOpen = effectiveExpanded(i);
              return (
                <div
                  key={i}
                  className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => { if (!expandAll) setExpanded(expanded === i ? null : i); }}
                >
                  <div className="flex items-start gap-3 p-4">
                    <SignalIcon signal={sig.signal} />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-foreground">{sig.title}</span>
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold uppercase", signalColor(sig.signal))}>
                          {sig.signal}
                        </span>
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", confidenceColor(sig.confidence))}>
                          {sig.confidence}
                        </span>
                        {actionMeta && (
                          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1", actionMeta.color)}>
                            {actionMeta.icon}
                            {actionMeta.label}
                          </span>
                        )}
                      </div>
                      {/* Markets pills */}
                      {sig.markets && sig.markets.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {sig.markets.map((m) => {
                            const slug = titleToSlug[m];
                            const url = slug ? `https://polymarket.com/event/${slug}` : null;
                            const pillClass = "flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50 transition-colors";
                            return url ? (
                              <a
                                key={m}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={cn(pillClass, "hover:border-primary/50 hover:text-foreground cursor-pointer")}
                              >
                                <Target className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate max-w-[160px]">{m}</span>
                                <ArrowUpRight className="h-2 w-2 shrink-0 opacity-60" />
                              </a>
                            ) : (
                              <span key={m} className={pillClass}>
                                <Target className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate max-w-[160px]">{m}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {isOpen
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border/50 pt-3">
                      <p className="text-sm font-mono text-muted-foreground leading-relaxed">{sig.insight}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {signals.length === 0 && !loading && (
          <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono text-sm space-y-2">
            <Brain className="h-8 w-8 mx-auto opacity-30" />
            <p>Click ANALYZE to run deep AI pattern detection</p>
            <p className="text-xs text-muted-foreground/60">
              Covers consensus, concentration, contrarian signals, insider risk, and actionable takeaways
            </p>
          </div>
        )}
        </div>)}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 p-3 bg-muted/30 border border-border rounded-lg">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-muted-foreground">
            AI signals are for informational purposes only and do not constitute financial advice.
            Prediction markets are speculative. Past whale behavior does not guarantee future outcomes.
          </p>
        </div>
      </div>
    </Layout>
  );
}

// ─── Momentum Markets Tab ──────────────────────────────────────────────────────
function MomentumTab() {
  const { data: markets, isLoading, refetch, dataUpdatedAt } = useGetMarketMomentum(
    { minSize: 1000, hours: 4 },
    { query: { queryKey: getGetMarketMomentumQueryKey({ minSize: 1000, hours: 4 }), refetchInterval: 60_000 } }
  );

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-xs font-mono text-muted-foreground">
            Markets with the fastest-growing whale trade volume in the last 4 hours
          </div>
          {updatedAt && <div className="text-[10px] font-mono text-muted-foreground/60">Updated {updatedAt}</div>}
        </div>
        <button
          onClick={() => void refetch()}
          className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}

      {!isLoading && (!markets || markets.length === 0) && (
        <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono text-sm space-y-2">
          <Zap className="h-8 w-8 mx-auto opacity-30" />
          <p>No momentum markets found</p>
          <p className="text-xs text-muted-foreground/60">Try lowering minSize or check back soon</p>
        </div>
      )}

      {markets && markets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {markets.map((m, rank) => {
            const isHot     = m.velocity >= 2;
            const isCool    = m.velocity < 0.5;
            const pctBuy    = Math.round(m.buyPressure * 100);
            const pctSell   = 100 - pctBuy;
            const velLabel  = m.volumePrev2h === 0 ? "NEW" : `${m.velocity.toFixed(1)}×`;
            const velColor  = isHot ? "text-emerald-400" : isCool ? "text-rose-400" : "text-amber-400";

            return (
              <Link key={m.conditionId} href={`/markets`}>
                <div className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary/40 transition-colors cursor-pointer h-full">
                  {/* Rank + velocity badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground/60 w-5">#{rank + 1}</span>
                      {m.icon ? (
                        <img src={m.icon} alt="" className="h-5 w-5 rounded-full object-cover shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-muted shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("font-mono text-sm font-bold tabular-nums", velColor)}>
                        {velLabel}
                      </span>
                      {isHot && <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
                      {isCool && <TrendingDown className="h-3.5 w-3.5 text-rose-400" />}
                      {!isHot && !isCool && <Minus className="h-3.5 w-3.5 text-amber-400" />}
                    </div>
                  </div>

                  {/* Title */}
                  <div className="font-mono text-xs font-medium line-clamp-2 leading-snug">
                    {m.title}
                  </div>

                  {/* Buy/sell bar */}
                  <div>
                    <div className="flex justify-between text-[9px] font-mono text-muted-foreground mb-1">
                      <span className="text-[#00d4aa]">BUY {pctBuy}%</span>
                      <span className="text-rose-400">SELL {pctSell}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-rose-500/30 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#00d4aa] transition-all"
                        style={{ width: `${pctBuy}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-muted-foreground">
                    <div>
                      <div className="text-foreground font-bold text-[10px]">
                        {m.totalVolume >= 1_000_000
                          ? `$${(m.totalVolume / 1_000_000).toFixed(2)}M`
                          : `$${(m.totalVolume / 1_000).toFixed(1)}K`}
                      </div>
                      <div>4H VOLUME</div>
                    </div>
                    <div>
                      <div className="text-foreground font-bold text-[10px]">{m.tradeCount}</div>
                      <div>TRADES</div>
                    </div>
                    <div>
                      <div className="text-foreground font-bold text-[10px]">{m.walletCount}</div>
                      <div>WALLETS</div>
                    </div>
                  </div>

                  {/* Recent vs prior */}
                  {m.volumePrev2h > 0 && (
                    <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/70">
                      <ArrowUp className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                      <span className="text-emerald-400">${(m.volume2h / 1_000).toFixed(1)}K</span>
                      <span>recent vs</span>
                      <span className="text-muted-foreground">${(m.volumePrev2h / 1_000).toFixed(1)}K</span>
                      <span>prior</span>
                    </div>
                  )}
                  {m.volumePrev2h === 0 && m.volume2h > 0 && (
                    <div className="flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                      <ArrowUp className="h-2.5 w-2.5 shrink-0" />
                      <span>New whale activity detected</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-muted-foreground/60 pt-1">
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-400" />≥ 2× velocity</span>
        <span className="flex items-center gap-1"><Minus className="h-3 w-3 text-amber-400" />0.5–2× velocity</span>
        <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3 text-rose-400" />&lt; 0.5× velocity</span>
        <span>· Refreshes every 60s</span>
      </div>
    </div>
  );
}
