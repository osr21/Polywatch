import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useGetPolyEvents, getGetPolyEventsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { formatCurrency, cn } from "@/lib/utils";
import { Search, Globe, ChevronDown, ChevronUp, Image as ImageIcon, Flame } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORIES = [
  "All", "Politics", "Sports", "Crypto", "Science", "Pop Culture", "Business"
] as const;

type Category = typeof CATEGORIES[number];

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);

  const searchVal = search.trim() || undefined;
  const tagVal = activeCategory !== "All" ? activeCategory.toLowerCase() : undefined;
  const params = { limit: 100, ...(searchVal !== undefined && { search: searchVal }), ...(tagVal !== undefined && { tag: tagVal }) };

  const { data: events, isLoading } = useGetPolyEvents(
    params,
    { query: { queryKey: getGetPolyEventsQueryKey(params), staleTime: 60000 } }
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            EVENTS EXPLORER
          </h2>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search events..." 
              className="pl-9 bg-card border-border font-mono text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap shrink-0">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "text-xs font-mono px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5",
                  isActive
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                )}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Events Grid */}
        <div className="pb-8">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))}
            </div>
          ) : !events || events.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-border rounded-xl text-muted-foreground font-mono">
              No events found.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((event) => {
                const isExpanded = expandedEventId === event.id;
                const vol24h = event.volume24hr ?? 0;
                const totalVol = event.volume ?? 0;
                
                return (
                  <div 
                    key={event.id}
                    className={cn(
                      "bg-card border border-border p-4 rounded-xl flex flex-col transition-colors",
                      isExpanded ? "border-primary/50" : "hover:border-primary/30"
                    )}
                  >
                    <div 
                      className="flex items-start gap-3 cursor-pointer"
                      onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                    >
                      {event.icon || event.image ? (
                        <img src={(event.icon || event.image)!} alt="" className="w-10 h-10 rounded-md object-cover bg-muted shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center border border-border shrink-0">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="font-mono text-sm font-bold line-clamp-2" title={event.title}>{event.title}</h3>
                        <div className="text-[10px] font-mono text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          {event.marketCount != null && (
                            <span className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded">
                              {event.marketCount} Markets
                            </span>
                          )}
                          {event.endDate && (
                            <span>Closes: {new Date(event.endDate).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <button className="shrink-0 p-1 hover:bg-muted rounded text-muted-foreground">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                      <div>
                        <div className="text-[10px] font-mono text-muted-foreground">TOTAL VOL</div>
                        <div className="text-xs font-mono font-bold text-foreground">{formatCurrency(totalVol)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-mono text-muted-foreground">24H VOL</div>
                        <div className="text-xs font-mono font-bold text-primary flex items-center gap-1 justify-end">
                          {vol24h > 0 && <Flame className="h-3 w-3 text-orange-400" />}
                          {formatCurrency(vol24h)}
                        </div>
                      </div>
                    </div>

                    {isExpanded && event.markets && event.markets.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border space-y-2">
                        <div className="text-[10px] font-mono font-bold text-muted-foreground">CHILD MARKETS</div>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {event.markets.map((m: any, idx) => (
                            <Link key={m.conditionId || idx} href={`/markets?search=${encodeURIComponent(m.question || "")}`}>
                              <div className="block p-2 rounded-md bg-muted/30 hover:bg-muted/50 border border-border transition-colors group">
                                <p className="font-mono text-xs line-clamp-2 group-hover:text-primary transition-colors">{m.question}</p>
                                <div className="flex justify-between items-center mt-1.5">
                                  <div className="text-[10px] font-mono text-muted-foreground">
                                    {m.volume ? formatCurrency(m.volume) : "—"}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          ))}
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