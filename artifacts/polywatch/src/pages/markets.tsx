import { useState, useMemo } from "react";
import { Link } from "wouter";
import { 
  useGetMarkets, getGetMarketsQueryKey, 
  useGetMarketWhales, getGetMarketWhalesQueryKey,
  useGetMarketHolders, getGetMarketHoldersQueryKey,
  useGetMarketPriceHistory, getGetMarketPriceHistoryQueryKey,
  useGetMarketComments, getGetMarketCommentsQueryKey
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, formatTimeAgo, truncateAddress, cn, getRiskColorClass, getAgeColorClass } from "@/lib/utils";
import { BarChart2, Search, Wallet, X, Flame, TrendingUp, Trophy, ArrowUpCircle, ArrowDownCircle, Crown, Users, List, ExternalLink, MessageCircle, LineChart as LineChartIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const CATEGORIES = [
  { label: "All", slug: null },
  {
    label: "Politics",
    slug: "politics",
    keywords: /\b(president|election|senate|congress|minister|government|vote|trump|biden|harris|democrat|republican|parliament|chancellor|prime minister|dictator|geopolit|war|ceasefire|peace|treaty|sanctions|tariff|nato|united nations|g7|g20|referendum|impeach|veto|legislation|bill|law|policy|diplomacy|political|macron|modi|sunak|scholz|zelensky|putin|xi jinping|netanyahu|erdogan|meloni|white house|kremlin|pentagon|state department|cia|fbi|iran|russia|ukraine|israel|china|taiwan|north korea|south korea|eu|european union|brexit)\b/i,
  },
  {
    label: "Sports",
    slug: "sports",
    keywords: /\b(tennis|football|soccer|nba|nfl|nhl|mlb|cricket|golf|baseball|basketball|olympic|championship|match|tournament|wimbledon|league|cup|world cup|f1|formula 1|formula one|ufc|boxing|mma|athlete|player|team|season|roster|draft|playoff|superbowl|super bowl|premier league|champions league|la liga|serie a|bundesliga|ligue 1|fifa|uefa|ioc|ncaa|pga|atp|wta|cycling|triathlon|marathon|swimming|rowing|vault|gymnastics|nascar|indycar|esports|game winner|map winner|series winner|match winner)\b/i,
  },
  {
    label: "Crypto",
    slug: "crypto",
    keywords: /\b(bitcoin|ethereum|crypto|btc|eth|token|blockchain|defi|nft|altcoin|solana|sol|xrp|ripple|bnb|binance|coinbase|doge|dogecoin|pepe|usdc|usdt|tether|tron|trx|cardano|ada|polkadot|dot|avalanche|avax|chainlink|link|uniswap|aave|compound|polygon|matic|arbitrum|optimism|base|layer 2|stablecoin|wallet|exchange|dex|cex|halving|etf|spot etf|sec crypto|bitcoin price|eth price)\b/i,
  },
  {
    label: "Science & Tech",
    slug: "science",
    keywords: /\b(ai|artificial intelligence|gpt|claude|gemini|openai|anthropic|climate|space|nasa|spacex|quantum|technology|model|llm|agi|chatgpt|deepmind|google ai|meta ai|microsoft|apple|tesla|self-driving|autonomous|robot|drone|satellite|mars|moon|launch|rocket|nuclear|energy|carbon|emissions|vaccine|drug|fda|cancer|breakthrough|discovery|patent|chip|semiconductor|nvidia|intel|amd|arm|data center|cloud)\b/i,
  },
  {
    label: "Pop Culture",
    slug: "pop-culture",
    keywords: /\b(album|grammy|oscar|celebrity|movie|film|tv|gta|rihanna|beyoncé|taylor swift|kardashian|drake|kanye|award|box office|netflix|disney|marvel|dc|superhero|music|song|singer|rapper|actor|actress|reality show|game show|streaming|youtube|tiktok|viral|trending|met gala|billboard|chart|tour|concert|trailer|premiere|season|episode|emmy|golden globe|bafta|cannes|sundance|game|video game|console|playstation|xbox|nintendo|esport)\b/i,
  },
  {
    label: "Business",
    slug: "business",
    keywords: /\b(stock|ipo|recession|gdp|inflation|fed|interest rate|s&p|nasdaq|dow|earnings|revenue|merger|acquisition|ceo|startup|funding|valuation|unicorn|hedge fund|investment|bond|yield|dollar|euro|currency|forex|commodity|oil|gold|silver|copper|energy|real estate|housing|mortgage|bank|financial|economy|trade|export|import|supply chain|layoff|hiring|unemployment|labor|wage|salary)\b/i,
  },
] as const;

type Category = typeof CATEGORIES[number];

function classifyMarket(question: string, slug: string): string {
  const text = `${question} ${slug}`.toLowerCase();
  for (const cat of CATEGORIES.slice(1)) {
    if ("keywords" in cat && cat.keywords.test(text)) return cat.label;
  }
  return "All";
}

export default function Markets() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>(CATEGORIES[0]);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [selectedMarketTitle, setSelectedMarketTitle] = useState<string>("");
  
  const { data: allMarkets, isLoading } = useGetMarkets(
    { limit: 500 }, 
    { query: { queryKey: getGetMarketsQueryKey({ limit: 500 }), staleTime: 60000 } }
  );

  const markets = useMemo(() => {
    let list = allMarkets ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.question.toLowerCase().includes(q));
    }
    if (activeCategory.slug !== null) {
      list = list.filter((m) => {
        const cat = classifyMarket(m.question, m.slug);
        return cat === activeCategory.label;
      });
    }
    return list;
  }, [allMarkets, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: allMarkets?.length ?? 0 };
    for (const m of allMarkets ?? []) {
      const cat = classifyMarket(m.question, m.slug);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allMarkets]);

  const maxWhaleVolume = Math.max(...(markets?.map((m) => m.whaleVolume ?? 0) ?? [0]), 1);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            MARKETS EXPLORER
          </h2>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search markets..." 
              className="pl-9 bg-card border-border font-mono text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap shrink-0">
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.label] ?? 0;
            const isActive = activeCategory.label === cat.label;
            return (
              <button
                key={cat.label}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "text-xs font-mono px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5",
                  isActive
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                )}
              >
                {cat.label}
                {count > 0 && (
                  <span className={cn("text-[10px] rounded px-1", isActive ? "bg-primary/20" : "bg-muted")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <div className="pb-8">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-52 w-full rounded-xl" />
              ))}
            </div>
          ) : markets.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
              No markets found{activeCategory.slug !== null ? ` in ${activeCategory.label}` : ""}.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {markets.map((market, idx) => {
                const whaleVolume = market.whaleVolume ?? 0;
                const whaleCount = market.whaleCount ?? 0;
                const vol24h = market.volume24hr ?? 0;
                const isHot = whaleVolume > 0 && idx < 3;
                const volumePct = (whaleVolume / maxWhaleVolume) * 100;

                let prices: number[] = [];
                let outcomes: string[] = [];
                try { prices = JSON.parse(market.outcomePrices ?? "[]").map(Number); } catch {}
                try { outcomes = JSON.parse(market.outcomes ?? "[]"); } catch {}

                const yesPrice = prices[0] ?? null;
                const noPrice = prices[1] ?? null;
                const yesLabel = outcomes[0] ?? "Yes";
                const noLabel = outcomes[1] ?? "No";

                return (
                  <div 
                    key={market.conditionId} 
                    className={cn(
                      "bg-card border border-border p-4 rounded-xl cursor-pointer hover:border-primary/50 transition-colors flex flex-col relative overflow-hidden",
                      isHot && "border-orange-500/40 hover:border-orange-400/60"
                    )}
                    onClick={() => {
                      setSelectedMarketId(market.conditionId);
                      setSelectedMarketTitle(market.question);
                    }}
                  >
                    {isHot && (
                      <div className="absolute top-0 right-0 px-2 py-1 bg-orange-500/20 border-b border-l border-orange-500/40 rounded-bl-lg flex items-center gap-1">
                        <Flame className="h-3 w-3 text-orange-400" />
                        <span className="text-[10px] font-mono text-orange-400 font-bold">HOT</span>
                      </div>
                    )}

                    {/* Title */}
                    <div className="flex items-start gap-3 flex-1 mb-3">
                      {market.icon ? (
                        <img src={market.icon} alt="" className="w-8 h-8 rounded-full bg-muted object-cover shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-mono text-xs border border-border shrink-0 mt-0.5">M</div>
                      )}
                      <p className="font-mono text-sm line-clamp-2 font-medium" title={market.question}>{market.question}</p>
                    </div>

                    {/* Yes / No price bar */}
                    {yesPrice !== null && noPrice !== null && (
                      <div className="mb-3">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-primary font-bold">{yesLabel} {Math.round(yesPrice * 100)}%</span>
                          <span className="text-secondary font-bold">{noLabel} {Math.round(noPrice * 100)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full overflow-hidden bg-secondary/20 flex">
                          <div className="h-full bg-primary/70 rounded-l-full transition-all" style={{ width: `${yesPrice * 100}%` }} />
                          <div className="h-full bg-secondary/70 rounded-r-full flex-1" />
                        </div>
                      </div>
                    )}

                    {/* Buy / Sell split + top outcome */}
                    {whaleVolume > 0 && (() => {
                      const buyVol = market.buyVolume ?? 0;
                      const sellVol = market.sellVolume ?? 0;
                      const total = buyVol + sellVol;
                      const buyPct = total > 0 ? (buyVol / total) * 100 : 50;
                      const topOutcome = market.topOutcome;
                      const topOcVol = market.topOutcomeBuyVolume;
                      return (
                        <div className="mb-3 space-y-1.5">
                          {/* Buy vs Sell bar */}
                          <div className="flex justify-between text-[10px] font-mono">
                            <span className="flex items-center gap-1 text-emerald-400">
                              <ArrowUpCircle className="h-3 w-3" />
                              BUY {formatCurrency(buyVol)}
                            </span>
                            <span className="flex items-center gap-1 text-rose-400">
                              SELL {formatCurrency(sellVol)}
                              <ArrowDownCircle className="h-3 w-3" />
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full overflow-hidden bg-rose-500/20 flex">
                            <div className="h-full bg-emerald-500/80 rounded-l-full transition-all" style={{ width: `${Math.max(buyPct, 2)}%` }} />
                            <div className="h-full bg-rose-500/60 rounded-r-full flex-1" />
                          </div>
                          {/* Top outcome badge */}
                          {topOutcome && topOcVol && (
                            <div className="flex items-center gap-1 text-[10px] font-mono text-amber-400">
                              <TrendingUp className="h-3 w-3 shrink-0" />
                              <span>Whales buying <span className="font-bold">{topOutcome}</span> · {formatCurrency(topOcVol)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Top whale — links to Polymarket profile */}
                    {market.topWallet && market.topWalletVolume && (
                      <div className="mb-3 rounded-md bg-amber-500/5 border border-amber-500/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          <Crown className="h-3 w-3 text-amber-400 shrink-0" />
                          <a
                            href={`https://polymarket.com/profile/${market.topWallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-mono text-amber-300 hover:text-amber-200 truncate flex-1 min-w-0 flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {market.topWalletName || truncateAddress(market.topWallet)}
                            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                          </a>
                          <span className="text-[10px] font-mono text-amber-400 font-bold shrink-0">
                            {formatCurrency(market.topWalletVolume)}
                          </span>
                        </div>
                        {(market.topWalletAgeDays != null || market.topWalletRiskScore != null) && (
                          <div className="flex items-center gap-2 px-2 pb-1.5 border-t border-amber-500/10">
                            {market.topWalletAgeDays != null && (
                              <span className={cn(
                                "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                                market.topWalletAgeDays < 7
                                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                                  : market.topWalletAgeDays < 30
                                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                                  : "bg-muted border-border text-muted-foreground"
                              )}>
                                {market.topWalletAgeDays < 1
                                  ? `${Math.round(market.topWalletAgeDays * 24)}h old`
                                  : `${Math.round(market.topWalletAgeDays)}d old`}
                              </span>
                            )}
                            {market.topWalletRiskScore != null && (
                              <span className={cn(
                                "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                                market.topWalletRiskScore >= 75
                                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                                  : market.topWalletRiskScore >= 50
                                  ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
                                  : market.topWalletRiskScore >= 25
                                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                                  : "bg-green-500/10 border-green-500/30 text-green-400"
                              )}>
                                RISK {market.topWalletRiskScore}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer stats */}
                    <div className="flex justify-between items-center pt-3 border-t border-border/50 gap-2">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-[10px] font-mono text-muted-foreground">24H VOL</div>
                          <div className="text-xs font-mono text-primary font-bold">{vol24h > 0 ? formatCurrency(vol24h) : "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-mono text-muted-foreground">LIQUIDITY</div>
                          <div className="text-xs font-mono text-foreground">{formatCurrency(parseFloat(market.liquidity || "0"))}</div>
                        </div>
                      </div>
                      {whaleCount > 0 && (
                        <div className={cn(
                          "text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0",
                          isHot 
                            ? "bg-orange-500/15 border-orange-500/40 text-orange-400" 
                            : "bg-primary/10 border-primary/30 text-primary"
                        )}>
                          {whaleCount} whale{whaleCount !== 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer */}
        <Drawer open={!!selectedMarketId} onOpenChange={(open) => !open && setSelectedMarketId(null)}>
          <DrawerContent className="h-[85vh] bg-card border-t border-border">
            <div className="max-w-4xl mx-auto w-full h-full flex flex-col">
              <DrawerHeader className="border-b border-border flex justify-between items-start shrink-0 gap-4">
                <div>
                  <DrawerTitle className="font-mono text-base">Whale Activity</DrawerTitle>
                  {selectedMarketTitle && (
                    <p className="text-xs font-mono text-muted-foreground mt-1 line-clamp-2">{selectedMarketTitle}</p>
                  )}
                </div>
                <DrawerClose className="p-2 hover:bg-muted rounded-md text-muted-foreground shrink-0">
                  <X className="h-4 w-4" />
                </DrawerClose>
              </DrawerHeader>
              <div className="p-4 flex-1 overflow-y-auto">
                {selectedMarketId && <MarketWhalesList conditionId={selectedMarketId} />}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </Layout>
  );
}

interface WalletSummary {
  address: string;
  name: string | null;
  pseudonym: string | null;
  profileImage: string | null;
  riskScore: number | null;
  walletAgeDays: number | null;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  tradeCount: number;
  outcomes: Record<string, number>;
}

function WalletAvatar({ address, profileImage, name, pseudonym, size = "sm" }: {
  address: string; profileImage?: string | null; name?: string | null; pseudonym?: string | null; size?: "sm" | "md";
}) {
  const dim = size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";
  const label = (name || pseudonym || address).slice(0, 2).toUpperCase();
  const hue = parseInt(address.slice(2, 6), 16) % 360;
  if (profileImage) {
    return <img src={profileImage} alt="" className={cn(dim, "rounded-full object-cover shrink-0 border border-border")} />;
  }
  return (
    <div
      className={cn(dim, "rounded-full shrink-0 flex items-center justify-center font-mono font-bold border border-border")}
      style={{ background: `hsl(${hue},35%,20%)`, color: `hsl(${hue},60%,65%)` }}
    >
      {label}
    </div>
  );
}

function MarketWhalesList({ conditionId }: { conditionId: string }) {
  const [tab, setTab] = useState<"wallets" | "trades" | "holders" | "chart" | "comments">("wallets");

  const { data: trades, isLoading } = useGetMarketWhales(
    conditionId,
    { query: { queryKey: getGetMarketWhalesQueryKey(conditionId), enabled: !!conditionId } }
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (!trades || trades.length === 0) {
    return (
      <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
        No whale trades recorded for this market yet.
      </div>
    );
  }

  const totalVolume = trades.reduce((s, t) => s + t.usdcSize, 0);
  const buyVolume = trades.filter((t) => t.side === "BUY").reduce((s, t) => s + t.usdcSize, 0);
  const sellVolume = totalVolume - buyVolume;
  const buyPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50;

  // Build per-wallet summaries
  const walletMap = new Map<string, WalletSummary>();
  for (const t of trades) {
    const w = walletMap.get(t.proxyWallet) ?? {
      address: t.proxyWallet,
      name: t.name ?? null,
      pseudonym: t.pseudonym ?? null,
      profileImage: t.profileImage ?? null,
      riskScore: t.riskScore ?? null,
      walletAgeDays: t.walletAgeDays ?? null,
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      tradeCount: 0,
      outcomes: {},
    };
    if (t.side === "BUY") w.buyVolume += t.usdcSize;
    else w.sellVolume += t.usdcSize;
    w.totalVolume += t.usdcSize;
    w.tradeCount += 1;
    if (t.outcome) w.outcomes[t.outcome] = (w.outcomes[t.outcome] ?? 0) + t.usdcSize;
    // prefer richest data
    if (!w.profileImage && t.profileImage) w.profileImage = t.profileImage;
    if (!w.name && t.name) w.name = t.name;
    if (w.riskScore == null && t.riskScore != null) w.riskScore = t.riskScore;
    if (w.walletAgeDays == null && t.walletAgeDays != null) w.walletAgeDays = t.walletAgeDays;
    walletMap.set(t.proxyWallet, w);
  }
  const wallets = [...walletMap.values()].sort((a, b) => b.totalVolume - a.totalVolume);

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-background border border-border p-3 rounded-lg">
          <div className="text-[10px] font-mono text-muted-foreground mb-1">TOTAL WHALE VOL</div>
          <div className="text-base font-mono font-bold text-primary">{formatCurrency(totalVolume)}</div>
        </div>
        <div className="bg-background border border-border p-3 rounded-lg">
          <div className="text-[10px] font-mono text-muted-foreground mb-1">WHALE WALLETS</div>
          <div className="text-base font-mono font-bold">{wallets.length}</div>
        </div>
        <div className="bg-background border border-border p-3 rounded-lg">
          <div className="text-[10px] font-mono text-muted-foreground mb-1 text-emerald-400">BUY VOLUME</div>
          <div className="text-base font-mono font-bold text-emerald-400">{formatCurrency(buyVolume)}</div>
        </div>
        <div className="bg-background border border-border p-3 rounded-lg">
          <div className="text-[10px] font-mono text-muted-foreground mb-1 text-rose-400">SELL VOLUME</div>
          <div className="text-base font-mono font-bold text-rose-400">{formatCurrency(sellVolume)}</div>
        </div>
      </div>

      {/* Market sentiment bar */}
      <div className="bg-background border border-border p-3 rounded-lg">
        <div className="flex justify-between text-[10px] font-mono mb-1.5">
          <span className="text-emerald-400 flex items-center gap-1"><ArrowUpCircle className="h-3 w-3" /> BUY {Math.round(buyPct)}%</span>
          <span className="text-rose-400 flex items-center gap-1">SELL {Math.round(100 - buyPct)}% <ArrowDownCircle className="h-3 w-3" /></span>
        </div>
        <div className="h-2.5 w-full rounded-full overflow-hidden bg-rose-500/20 flex">
          <div className="h-full bg-emerald-500/80 rounded-l-full transition-all" style={{ width: `${Math.max(buyPct, 2)}%` }} />
          <div className="h-full bg-rose-500/60 rounded-r-full flex-1" />
        </div>
      </div>

      {/* Top whale hero — #1 wallet by volume with direct Polymarket link */}
      {wallets[0] && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
          <div className="shrink-0">
            <Trophy className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-amber-500/70 mb-0.5">LARGEST BET</div>
            <div className="flex items-center gap-2 flex-wrap">
              <WalletAvatar
                address={wallets[0].address}
                profileImage={wallets[0].profileImage}
                name={wallets[0].name}
                pseudonym={wallets[0].pseudonym}
                size="sm"
              />
              <span className="font-mono text-sm font-bold text-amber-300 truncate">
                {wallets[0].name || wallets[0].pseudonym || truncateAddress(wallets[0].address)}
              </span>
              {wallets[0].riskScore != null && (
                <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0", getRiskColorClass(wallets[0].riskScore))}>
                  RISK {wallets[0].riskScore}
                </span>
              )}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1">
              {wallets[0].buyVolume > 0 && <span className="text-emerald-400">BUY {formatCurrency(wallets[0].buyVolume)}</span>}
              {wallets[0].buyVolume > 0 && wallets[0].sellVolume > 0 && <span className="text-muted-foreground/50"> · </span>}
              {wallets[0].sellVolume > 0 && <span className="text-rose-400">SELL {formatCurrency(wallets[0].sellVolume)}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 space-y-1.5">
            <div className="text-lg font-mono font-bold text-amber-400">{formatCurrency(wallets[0].totalVolume)}</div>
            <a
              href={`https://polymarket.com/profile/${wallets[0].address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 px-2 py-1 rounded transition-colors"
            >
              View on Polymarket
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex flex-wrap gap-1 bg-background border border-border rounded-lg p-1">
        <button
          onClick={() => setTab("wallets")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-mono text-xs font-bold transition-colors min-w-[80px]",
            tab === "wallets" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="h-3 w-3" />
          WALLETS ({wallets.length})
        </button>
        <button
          onClick={() => setTab("trades")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-mono text-xs font-bold transition-colors min-w-[80px]",
            tab === "trades" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="h-3 w-3" />
          TRADES ({trades.length})
        </button>
        <button
          onClick={() => setTab("holders")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-mono text-xs font-bold transition-colors min-w-[80px]",
            tab === "holders" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Wallet className="h-3 w-3" />
          HOLDERS
        </button>
        <button
          onClick={() => setTab("chart")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-mono text-xs font-bold transition-colors min-w-[80px]",
            tab === "chart" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LineChartIcon className="h-3 w-3" />
          CHART
        </button>
        <button
          onClick={() => setTab("comments")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-mono text-xs font-bold transition-colors min-w-[80px]",
            tab === "comments" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageCircle className="h-3 w-3" />
          COMMENTS
        </button>
      </div>

      {/* WALLETS tab */}
      {tab === "wallets" && (
        <div className="space-y-2">
          {wallets.map((w, idx) => {
            const wBuyPct = w.totalVolume > 0 ? (w.buyVolume / w.totalVolume) * 100 : 50;
            const topOutcome = Object.entries(w.outcomes).sort((a, b) => b[1] - a[1])[0];
            return (
              <div key={w.address} className="bg-background border border-border rounded-xl p-3 space-y-2.5">
                {/* Row 1: rank + avatar + identity + total volume */}
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-5 text-right shrink-0">
                    {idx === 0 ? <Trophy className="h-3.5 w-3.5 text-amber-400 inline" /> : `#${idx + 1}`}
                  </span>
                  <WalletAvatar
                    address={w.address}
                    profileImage={w.profileImage}
                    name={w.name}
                    pseudonym={w.pseudonym}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link
                        href={`/wallet/${w.address}`}
                        className="text-sm font-mono font-medium hover:text-primary transition-colors truncate"
                      >
                        {w.name || w.pseudonym || truncateAddress(w.address)}
                      </Link>
                      <a
                        href={`https://polymarket.com/profile/${w.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Polymarket"
                        className="text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {w.riskScore != null && (
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", getRiskColorClass(w.riskScore))}>
                          RISK {w.riskScore}
                        </span>
                      )}
                      {w.walletAgeDays != null && (
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", getAgeColorClass(w.walletAgeDays))}>
                          {w.walletAgeDays < 1 ? `${Math.round(w.walletAgeDays * 24)}h old` : `${Math.round(w.walletAgeDays)}d old`}
                        </span>
                      )}
                      {topOutcome && (
                        <span className="text-[10px] font-mono text-muted-foreground truncate">
                          → {topOutcome[0]}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-bold text-foreground">{formatCurrency(w.totalVolume)}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{w.tradeCount} trade{w.tradeCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>

                {/* Row 2: buy/sell breakdown */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-emerald-400">BUY {formatCurrency(w.buyVolume)}</span>
                    <span className="text-rose-400">SELL {formatCurrency(w.sellVolume)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full overflow-hidden bg-rose-500/20 flex">
                    <div className="h-full bg-emerald-500/70 rounded-l-full transition-all" style={{ width: `${Math.max(wBuyPct, 2)}%` }} />
                    <div className="h-full bg-rose-500/50 rounded-r-full flex-1" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TRADES tab */}
      {tab === "trades" && (
        <div className="space-y-2">
          {[...trades].sort((a, b) => b.timestamp - a.timestamp).map((trade) => (
            <div key={trade.transactionHash} className="flex items-center gap-3 p-3 border border-border bg-background rounded-xl">
              <WalletAvatar
                address={trade.proxyWallet}
                profileImage={trade.profileImage}
                name={trade.name}
                pseudonym={trade.pseudonym}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className={cn(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                    trade.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  )}>
                    {trade.side}
                  </span>
                  <span className="text-[10px] font-mono text-foreground/80 truncate">{trade.outcome}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatTimeAgo(trade.timestamp)}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <Link href={`/wallet/${trade.proxyWallet}`} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 truncate">
                    <Wallet className="h-3 w-3 shrink-0" />
                    <span className="truncate">{trade.name || trade.pseudonym || truncateAddress(trade.proxyWallet)}</span>
                  </Link>
                  <a
                    href={`https://polymarket.com/profile/${trade.proxyWallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on Polymarket"
                    className="text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              <div className={cn("font-mono font-bold text-sm text-right shrink-0", trade.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                {formatCurrency(trade.usdcSize)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* HOLDERS tab */}
      {tab === "holders" && <MarketHoldersTab conditionId={conditionId} />}

      {/* CHART tab */}
      {tab === "chart" && <MarketChartTab conditionId={conditionId} />}

      {/* COMMENTS tab */}
      {tab === "comments" && <MarketCommentsTab conditionId={conditionId} />}
    </div>
  );
}

function MarketHoldersTab({ conditionId }: { conditionId: string }) {
  const { data: holders, isLoading } = useGetMarketHolders(
    conditionId,
    { query: { queryKey: getGetMarketHoldersQueryKey(conditionId), enabled: !!conditionId } }
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!holders || holders.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
        No holders found for this market.
      </div>
    );
  }

  const yesHolders = holders.filter(h => h.outcomeIndex === 0).sort((a, b) => b.balance - a.balance);
  const noHolders = holders.filter(h => h.outcomeIndex === 1).sort((a, b) => b.balance - a.balance);

  const renderHoldersColumn = (title: string, list: typeof holders, colorClass: string) => (
    <div className="flex-1 min-w-0">
      <div className={cn("text-xs font-mono font-bold px-3 py-2 border-b border-border bg-muted/20", colorClass)}>
        {title} ({list.length})
      </div>
      <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
        {list.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No holders</div>
        ) : list.map((h, i) => (
          <div key={`${h.proxyWallet}-${i}`} className="p-3 flex items-center justify-between hover:bg-muted/10 transition-colors">
            <div className="flex items-center gap-2 overflow-hidden">
              <WalletAvatar
                address={h.proxyWallet}
                profileImage={h.profileImage}
                name={h.name}
                pseudonym={h.pseudonym}
              />
              <Link href={`/wallet/${h.proxyWallet}`} className="font-mono text-xs font-bold hover:text-primary truncate">
                {h.name || h.pseudonym || truncateAddress(h.proxyWallet)}
              </Link>
            </div>
            <div className="font-mono text-xs font-bold pl-2 shrink-0">{h.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} shares</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-background border border-border rounded-lg flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
      {renderHoldersColumn("YES HOLDERS", yesHolders, "text-emerald-400")}
      {renderHoldersColumn("NO HOLDERS", noHolders, "text-rose-400")}
    </div>
  );
}

function MarketChartTab({ conditionId }: { conditionId: string }) {
  const [interval, setInterval] = useState<"1h" | "6h" | "1d" | "1w" | "1m">("1m");
  
  const { data, isLoading } = useGetMarketPriceHistory(
    { conditionId, interval },
    { query: { queryKey: getGetMarketPriceHistoryQueryKey({ conditionId, interval }), enabled: !!conditionId } }
  );

  return (
    <div className="bg-background border border-border rounded-lg p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-mono text-sm font-bold text-muted-foreground">PRICE HISTORY</h3>
        <div className="flex items-center gap-1 bg-muted/20 border border-border rounded-md p-1">
          {["1h", "6h", "1d", "1w", "1m"].map(int => (
            <button
              key={int}
              onClick={() => setInterval(int as any)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                interval === int ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {int === "1m" ? "MAX" : int}
            </button>
          ))}
        </div>
      </div>
      
      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : !data || data.history.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-muted-foreground font-mono text-sm border border-dashed border-border rounded-md">
          No price data available.
        </div>
      ) : (
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="t" 
                type="number" 
                domain={['dataMin', 'dataMax']} 
                tickFormatter={(t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickMargin={10}
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                domain={[0, 1]} 
                tickFormatter={(p) => `${(p * 100).toFixed(0)}%`}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickMargin={10}
                axisLine={false}
                tickLine={false}
              />
              <RechartsTooltip 
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                labelFormatter={(t) => new Date(t as number * 1000).toLocaleString()}
                formatter={(val: number, name: string) => [`${(val * 100).toFixed(1)}%`, name]}
              />
              
              {/* Plot line for YES outcome (index 0) */}
              {data.history[0] && (
                <Line 
                  data={data.history[0]} 
                  type="stepAfter" 
                  dataKey="p" 
                  name={data.outcomes[0] || "Yes"} 
                  stroke="hsl(142, 71%, 45%)" // emerald-400
                  strokeWidth={2} 
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {/* Plot line for NO outcome (index 1) */}
              {data.history[1] && (
                <Line 
                  data={data.history[1]} 
                  type="stepAfter" 
                  dataKey="p" 
                  name={data.outcomes[1] || "No"} 
                  stroke="hsl(346, 87%, 60%)" // rose-400
                  strokeWidth={2} 
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function MarketCommentsTab({ conditionId }: { conditionId: string }) {
  const { data: comments, isLoading } = useGetMarketComments(
    conditionId,
    { query: { queryKey: getGetMarketCommentsQueryKey(conditionId), enabled: !!conditionId } }
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!comments || comments.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
        No comments yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {comments.map((c) => (
        <div key={c.id} className="bg-background border border-border p-4 rounded-xl flex gap-3">
          <WalletAvatar
            address={c.author ?? ""}
            profileImage={c.profileImage}
            pseudonym={c.pseudonym}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm font-bold text-foreground">
                {c.pseudonym || truncateAddress(c.author ?? "")}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">{formatTimeAgo(new Date(c.createdAt).getTime() / 1000)}</span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap font-sans">{c.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
