import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart2, Search, Bot, Brain, BarChart3, Wallet, Trophy, CheckCircle2, XCircle, Loader2, Award, Zap, Gift, Globe, TrendingUp, Medal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUserStream } from "@/lib/userStream";
import { useAccountStatus } from "@/lib/useAccountStatus";
import { AdminUnlock } from "@/components/admin-unlock";
import { NotificationSettings } from "@/components/notification-settings";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  useUserStream();
  const [search, setSearch] = useState("");
  const status = useAccountStatus();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = search.trim();
    if (trimmed.startsWith("0x") && trimmed.length > 10) {
      setLocation(`/wallet/${trimmed}`);
    }
  };

  const navLink = (href: string, icon: React.ReactNode, label: string) => (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md font-mono text-sm transition-colors ${
        location === href
          ? "bg-primary/10 text-primary border border-primary/20"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  const deriving = status?.derivation?.state === "running";
  const clobReady = status?.clobReady ?? false;
  const relayerReady = status?.relayerReady ?? false;
  const proxyReady = status?.proxyReady ?? false;
  const builderCode = status?.builderCode?.value;
  const builderSet = status?.builderCode?.set ?? false;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground dark">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-mono font-bold text-xl tracking-tight">POLYWATCH</span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navLink("/", <Activity className="h-4 w-4" />, "WHALE FEED")}
          {navLink("/markets", <BarChart2 className="h-4 w-4" />, "MARKETS")}
          {navLink("/events", <Globe className="h-4 w-4" />, "EVENTS")}
          <Link
            href="/perps"
            className={`flex items-center justify-between px-3 py-2 rounded-md font-mono text-sm transition-colors ${
              location === "/perps"
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4" />
              PERPS
            </div>
            <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded border border-primary/30">NEW</span>
          </Link>
          {navLink("/trading", <BarChart3 className="h-4 w-4" />, "ORDER BOOKS")}
          {navLink("/bot", <Bot className="h-4 w-4" />, "COPY BOT")}
          {navLink("/signals", <Brain className="h-4 w-4" />, "AI SIGNALS")}
          {navLink("/portfolio", <Wallet className="h-4 w-4" />, "PORTFOLIO")}
          {navLink("/trader-leaderboard", <Medal className="h-4 w-4" />, "TRADERS")}
          {navLink("/leaderboard", <Trophy className="h-4 w-4" />, "BUILDERS")}
          {navLink("/rewards", <Gift className="h-4 w-4" />, "REWARDS")}
        </nav>

        {/* Account status footer */}
        <div className="px-4 py-3 border-t border-border text-[11px] font-mono space-y-1.5">
          {/* CLOB status */}
          <div className="flex items-center gap-2">
            {status === null ? (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
            ) : deriving ? (
              <Loader2 className="h-3 w-3 text-amber-400 animate-spin shrink-0" />
            ) : clobReady ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
            )}
            <span className={cn(
              deriving ? "text-amber-400" :
              clobReady ? "text-emerald-400" :
              "text-rose-400"
            )}>
              {deriving ? "DERIVING KEYS…" : clobReady ? "CLOB: READY" : "CLOB: NO KEYS"}
            </span>
          </div>

          {/* Builder attribution */}
          <div className="flex items-center gap-2">
            <Award className={cn("h-3 w-3 shrink-0", builderSet ? "text-primary" : "text-muted-foreground/40")} />
            {builderSet ? (
              <span className="text-primary truncate max-w-[170px]" title={builderCode ?? ""}>
                {builderCode && builderCode.startsWith("0x")
                  ? builderCode.slice(0, 6) + "…" + builderCode.slice(-4)
                  : (builderCode ?? "SET")}
              </span>
            ) : (
              <Link
                href="/leaderboard"
                className="text-muted-foreground/50 hover:text-primary transition-colors"
              >
                BUILDER: NOT SET
              </Link>
            )}
          </div>

          {/* Relayer status */}
          <div className="flex items-center gap-2">
            {status === null ? (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
            ) : relayerReady ? (
              <Zap className="h-3 w-3 text-emerald-400 shrink-0" />
            ) : (
              <Zap className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            )}
            <span className={cn(relayerReady ? "text-emerald-400" : "text-muted-foreground/40")}>
              {relayerReady ? "RELAYER: READY" : "RELAYER: NO KEY"}
            </span>
          </div>

          {/* Proxy status — only shown once configured */}
          {proxyReady && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
              <span className="text-emerald-400">PROXY: ACTIVE</span>
            </div>
          )}

          <div className="text-muted-foreground/40 pt-0.5">WS: CONNECTED</div>

          {/* Admin token unlock (required for bot config / order cancellation) */}
          <div className="pt-1.5 mt-1.5 border-t border-border/60">
            <AdminUnlock />
          </div>

          {/* Email notification settings */}
          <NotificationSettings />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 border-b border-border bg-card flex items-center px-6 justify-between shrink-0">
          <div className="md:hidden flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <span className="font-mono font-bold">POLYWATCH</span>
          </div>

          <div className="flex-1" />

          <form onSubmit={handleSearch} className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search wallet 0x..."
              className="pl-9 bg-background border-border font-mono text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto bg-background p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
