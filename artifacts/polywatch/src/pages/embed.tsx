import { useEffect, useState } from "react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface WhaleTrade {
  transactionHash: string;
  title: string;
  outcome: string;
  side: "BUY" | "SELL";
  usdcSize: number;
  timestamp: number;
  proxyWallet: string;
  pseudonym?: string | null;
  profileImage?: string | null;
}

function formatUsdc(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function truncAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function EmbedPage() {
  const params = new URLSearchParams(window.location.search);
  const minSize = Number(params.get("minSize") ?? 5000);
  const limit = Math.min(Number(params.get("limit") ?? 20), 50);
  const title = params.get("title") ?? "POLYWATCH WHALE FEED";

  const [trades, setTrades] = useState<WhaleTrade[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const load = () => {
      fetch(`${BASE_URL}/api/whales?minSize=${minSize}&limit=${limit}`)
        .then((r) => r.json())
        .then((d: WhaleTrade[]) => setTrades(d))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [minSize, limit]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  void tick;

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Mono', monospace" }}
      className="bg-[#0a0a0f] text-[#e2e8f0] min-h-screen text-xs">

      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b] bg-[#0d1117] sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#00d4aa] animate-pulse" />
          <span className="font-bold text-[#00d4aa] tracking-widest text-[10px]">{title}</span>
        </div>
        <div className="text-[9px] text-[#475569]">
          ${(minSize / 1000).toFixed(0)}K+ · LIVE
        </div>
      </div>

      {/* Trade list */}
      <div className="divide-y divide-[#0f172a]">
        {trades.length === 0 ? (
          <div className="p-8 text-center text-[#475569] text-[10px]">Loading whale activity…</div>
        ) : (
          trades.map((t) => (
            <div key={t.transactionHash}
              className="flex items-center gap-2 px-3 py-2.5 hover:bg-[#0d1117] transition-colors">

              {/* Side badge */}
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                t.side === "BUY"
                  ? "bg-[#00d4aa]/10 border-[#00d4aa]/40 text-[#00d4aa]"
                  : "bg-[#f43f5e]/10 border-[#f43f5e]/40 text-[#f43f5e]"
              }`}>
                {t.side}
              </span>

              {/* Market + outcome */}
              <div className="flex-1 min-w-0">
                <div className="text-[#e2e8f0] truncate text-[10px] font-medium leading-tight">
                  {t.title}
                </div>
                <div className="text-[#64748b] text-[9px] leading-tight mt-0.5">
                  {t.outcome} · {t.pseudonym ?? truncAddr(t.proxyWallet)}
                </div>
              </div>

              {/* Size + time */}
              <div className="text-right shrink-0">
                <div className={`font-bold text-[11px] ${
                  t.side === "BUY" ? "text-[#00d4aa]" : "text-[#f43f5e]"
                }`}>
                  {formatUsdc(t.usdcSize)}
                </div>
                <div className="text-[9px] text-[#475569] mt-0.5">
                  {timeAgo(t.timestamp)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 text-[9px] text-[#334155] text-center border-t border-[#0f172a]">
        <a href="https://polywatch.app" target="_blank" rel="noopener noreferrer"
          className="hover:text-[#00d4aa] transition-colors">
          powered by polywatch
        </a>
      </div>
    </div>
  );
}
