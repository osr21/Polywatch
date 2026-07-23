import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  useGetBotConfig,
  useUpdateBotConfig,
  useGetBotLog,
  useClearBotLog,
  getGetBotConfigQueryKey,
  getGetBotLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { formatCurrency, formatTimeAgo, truncateAddress, cn } from "@/lib/utils";
import { getAdminToken } from "@/lib/adminAuth";
import { Bot, Wallet, Trash2, Play, Square, Bell, Zap, ChevronRight, Info, Globe, CheckCircle2, XCircle, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ApiError } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function notifyMutationError(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 401) {
    toast.error("Admin token required — unlock trading in the sidebar");
  } else {
    toast.error(fallback);
  }
}

function useIsUnlocked() {
  const [unlocked, setUnlocked] = useState(() => !!getAdminToken());
  useEffect(() => {
    const handler = () => setUnlocked(!!getAdminToken());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return unlocked;
}

function useClobReady() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_URL}/api/settings/status`)
      .then((r) => r.json())
      .then((d: { clobReady?: boolean }) => { if (!cancelled) setReady(d.clobReady ?? false); })
      .catch(() => { if (!cancelled) setReady(false); });
    return () => { cancelled = true; };
  }, []);
  return ready;
}

interface ProxyStatus { set: boolean; lastResult: null | { ok: boolean; httpStatus?: number; note?: string; error?: string } }

function useProxyStatus() {
  const [status, setStatus] = useState<ProxyStatus>({ set: false, lastResult: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_URL}/api/settings/status`)
      .then((r) => r.json())
      .then((d: { proxyReady?: boolean }) => { if (!cancelled) setStatus((s) => ({ ...s, set: d.proxyReady ?? false })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return status;
}

function ProxySetupCard() {
  const [proxySet, setProxySet] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; httpStatus?: number; note?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/status`)
      .then((r) => r.json())
      .then((d: { proxyReady?: boolean }) => setProxySet(d.proxyReady ?? false))
      .catch(() => setProxySet(false));
  }, []);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await fetch(`${BASE_URL}/api/settings/proxy-test`);
      const d = await r.json() as { ok: boolean; httpStatus?: number; note?: string; error?: string };
      setResult(d);
      if (d.ok) toast.success("Proxy reachable — CLOB calls will route through residential IP");
      else toast.error(d.error ?? "Proxy test failed");
    } catch {
      setResult({ ok: false, error: "Network error — API server unreachable" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          RESIDENTIAL PROXY
        </h3>
        {proxySet === null ? (
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
        ) : proxySet ? (
          <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> ACTIVE
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <XCircle className="h-3 w-3" /> NOT SET
          </span>
        )}
      </div>

      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Polymarket&apos;s CLOB API blocks cloud server IPs (Cloudflare Bot Fight Mode).
        A residential proxy routes order calls through a home IP, bypassing the block.
      </p>

      {/* Setup steps */}
      {!proxySet && (
        <div className="space-y-1.5 border border-border/60 rounded-lg p-3 bg-background/50">
          <p className="text-[10px] font-mono text-primary font-bold mb-2">TO SET UP:</p>
          {[
            <>1. Get a residential proxy — <span className="text-primary">Bright Data</span> or <span className="text-primary">Oxylabs</span> work well (~$3/GB)</>,
            <>2. Open the Replit <span className="text-primary">Secrets</span> panel (padlock icon, left sidebar)</>,
            <>3. Add secret name: <span className="text-primary font-bold">CLOB_PROXY_URL</span></>,
            <>4. Value: <span className="text-primary">http://user:pass@host:port</span></>,
            <>5. Restart the <span className="text-primary">API Server</span> workflow</>,
            <>6. Come back here and click <span className="text-primary">TEST PROXY</span></>,
          ].map((step, i) => (
            <div key={i} className="text-[10px] font-mono text-muted-foreground">{step}</div>
          ))}
        </div>
      )}

      {/* Test button + result */}
      <button
        onClick={runTest}
        disabled={testing}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md font-mono text-xs font-bold border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
      >
        {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
        {testing ? "TESTING…" : "TEST PROXY"}
      </button>

      {result && (
        <div className={cn(
          "p-2.5 rounded-md text-[10px] font-mono border space-y-1",
          result.ok
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-destructive/10 border-destructive/30 text-destructive"
        )}>
          {result.ok ? (
            <>
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="h-3 w-3" /> PROXY OK — HTTP {result.httpStatus}
              </div>
              {result.note && <div className="text-emerald-300/80">{result.note}</div>}
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 font-bold">
                <XCircle className="h-3 w-3" /> PROXY FAILED
              </div>
              <div className="text-destructive/80 break-all">{result.error}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function BotPage() {
  const qc = useQueryClient();
  const isUnlocked = useIsUnlocked();
  const clobReady = useClobReady();
  const { data: config, isLoading: configLoading } = useGetBotConfig({
    query: { queryKey: getGetBotConfigQueryKey(), refetchInterval: 5000 },
  });
  const { data: log, isLoading: logLoading } = useGetBotLog({
    query: { queryKey: getGetBotLogQueryKey(), refetchInterval: 5000 },
  });

  const updateConfig = useUpdateBotConfig({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
      },
      onError: (err) => notifyMutationError(err, "Failed to update bot config"),
    },
  });
  const clearLog = useClearBotLog({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBotLogQueryKey() });
        toast.success("Bot log cleared");
      },
      onError: (err) => notifyMutationError(err, "Failed to clear bot log"),
    },
  });

  const [walletInput, setWalletInput] = useState("");
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [copyPct, setCopyPct] = useState("");

  useEffect(() => {
    if (config?.targetWallet && !walletInput) {
      setWalletInput(config.targetWallet);
    }
  }, [config?.targetWallet]);

  const handleSave = () => {
    if (!config) return;
    const updates: Parameters<typeof updateConfig.mutate>[0]["data"] = {
      ...config,
    };
    if (walletInput.trim()) updates.targetWallet = walletInput.trim();
    if (minSize) updates.minTradeSize = parseFloat(minSize);
    if (maxSize) updates.maxTradeSize = parseFloat(maxSize);
    if (copyPct) updates.copyPct = parseFloat(copyPct);
    updateConfig.mutate(
      { data: updates },
      {
        onSuccess: () => {
          toast.success("Config saved");
          setWalletInput("");
          setMinSize("");
          setMaxSize("");
          setCopyPct("");
        },
      }
    );
  };

  const toggleBot = () => {
    if (!config) return;
    updateConfig.mutate(
      { data: { ...config, enabled: !config.enabled } },
      {
        onSuccess: (data) => {
          toast.success(data.enabled ? "Bot started" : "Bot stopped");
        },
      }
    );
  };

  const toggleMode = () => {
    if (!config) return;
    updateConfig.mutate(
      { data: { ...config, notifyOnly: !config.notifyOnly } },
      { onSuccess: () => toast.success("Mode updated") }
    );
  };

  const toggleSide = (side: "BUY" | "SELL") => {
    if (!config) return;
    const current = config.allowedSides as ("BUY" | "SELL")[];
    const next = current.includes(side)
      ? current.filter((s) => s !== side)
      : [...current, side];
    if (next.length === 0) return;
    updateConfig.mutate({ data: { ...config, allowedSides: next } });
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-mono font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            COPY-TRADE BOT
          </h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-card border border-border px-3 py-1.5 rounded-md">
            <Info className="h-3 w-3" />
            Notify-only mode — no real funds used
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Config Panel */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm font-bold text-foreground">CONFIGURATION</h3>
              {configLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <button
                  onClick={isUnlocked ? toggleBot : undefined}
                  disabled={!isUnlocked}
                  title={!isUnlocked ? "Unlock trading in the sidebar first" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-xs font-bold transition-colors",
                    !isUnlocked
                      ? "bg-muted border border-border text-muted-foreground cursor-not-allowed opacity-60"
                      : config?.enabled
                      ? "bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30"
                      : "bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                  )}
                >
                  {!isUnlocked ? <Lock className="h-3 w-3" /> : config?.enabled ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {!isUnlocked ? "LOCKED" : config?.enabled ? "STOP BOT" : "START BOT"}
                </button>
              )}
            </div>

            {/* Lock notice */}
            {!isUnlocked && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-mono">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Click <strong>TRADING: LOCKED</strong> in the sidebar to enter your admin token and enable bot controls.</span>
              </div>
            )}

            {/* Status indicator */}
            {!configLoading && config && (
              <div className="space-y-1.5">
                <div className={cn(
                  "flex items-center gap-2 p-3 rounded-lg border text-xs font-mono",
                  config.enabled
                    ? "bg-primary/5 border-primary/30 text-primary"
                    : "bg-muted border-border text-muted-foreground"
                )}>
                  <span className={cn("h-2 w-2 rounded-full shrink-0", config.enabled ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
                  <span className="flex-1 min-w-0">
                    {config.enabled ? "ACTIVE — watching " + (config.targetWallet ? truncateAddress(config.targetWallet) : "no target") : "INACTIVE"}
                  </span>
                  {config.enabled && (config as { lastPolledAt?: number }).lastPolledAt ? (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      polled {formatTimeAgo((config as { lastPolledAt: number }).lastPolledAt / 1000)}
                    </span>
                  ) : config.enabled ? (
                    <span className="text-[10px] text-muted-foreground shrink-0">waiting…</span>
                  ) : null}
                </div>
                {(config as { lastError?: string | null }).lastError && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-[10px] font-mono text-destructive">
                    <span className="shrink-0">ERR</span>
                    <span className="break-all">{(config as { lastError: string }).lastError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Target wallet */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">TARGET WALLET</label>
              {configLoading ? <Skeleton className="h-9 w-full" /> : (
                <div className="flex gap-2">
                  <Input
                    placeholder={config?.targetWallet || "0x..."}
                    value={walletInput}
                    onChange={(e) => setWalletInput(e.target.value)}
                    className="font-mono text-xs bg-background border-border"
                  />
                  {config?.targetWallet && (
                    <Link
                      href={`/wallet/${config.targetWallet}`}
                      className="flex items-center gap-1 px-3 py-1 rounded-md border border-border text-xs font-mono text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors shrink-0"
                    >
                      <Wallet className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Trade size range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground">MIN SIZE ($)</label>
                {configLoading ? <Skeleton className="h-9 w-full" /> : (
                  <Input
                    type="number"
                    placeholder={String(config?.minTradeSize ?? 1000)}
                    value={minSize}
                    onChange={(e) => setMinSize(e.target.value)}
                    className="font-mono text-xs bg-background border-border"
                  />
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground">MAX SIZE ($)</label>
                {configLoading ? <Skeleton className="h-9 w-full" /> : (
                  <Input
                    type="number"
                    placeholder={String(config?.maxTradeSize ?? 10000)}
                    value={maxSize}
                    onChange={(e) => setMaxSize(e.target.value)}
                    className="font-mono text-xs bg-background border-border"
                  />
                )}
              </div>
            </div>

            {/* Copy percentage */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">COPY SIZE (%)</label>
              {configLoading ? <Skeleton className="h-9 w-full" /> : (
                <Input
                  type="number"
                  placeholder={String(config?.copyPct ?? 100)}
                  value={copyPct}
                  onChange={(e) => setCopyPct(e.target.value)}
                  className="font-mono text-xs bg-background border-border"
                />
              )}
              <p className="text-[10px] font-mono text-muted-foreground">e.g. 50 = copy at half the whale&apos;s size</p>
            </div>

            {/* Allowed sides */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">COPY SIDES</label>
              {configLoading ? <Skeleton className="h-9 w-full" /> : (
                <div className="flex gap-2">
                  {(["BUY", "SELL"] as const).map((side) => {
                    const active = (config?.allowedSides as string[] ?? []).includes(side);
                    return (
                      <button
                        key={side}
                        onClick={() => toggleSide(side)}
                        className={cn(
                          "flex-1 py-1.5 rounded-md font-mono text-xs font-bold border transition-colors",
                          active
                            ? side === "BUY"
                              ? "bg-primary/20 border-primary/50 text-primary"
                              : "bg-secondary/20 border-secondary/50 text-secondary"
                            : "bg-muted border-border text-muted-foreground"
                        )}
                      >
                        {side}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Order type */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">ORDER TYPE</label>
              {configLoading ? <Skeleton className="h-9 w-full" /> : (
                <div className="grid grid-cols-4 gap-1.5">
                  {(["GTC", "GTD", "FOK", "FAK"] as const).map((ot) => {
                    const active = (config?.orderType ?? "GTC") === ot;
                    return (
                      <button
                        key={ot}
                        onClick={() => config && updateConfig.mutate({ data: { ...config, orderType: ot } })}
                        className={cn(
                          "py-1.5 rounded-md font-mono text-xs font-bold border transition-colors",
                          active
                            ? "bg-primary/20 border-primary/50 text-primary"
                            : "bg-muted border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {ot}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] font-mono text-muted-foreground">
                GTC = Good Till Cancelled · GTD = Good Till Day · FOK = Fill or Kill · FAK = Fill and Kill
              </p>
            </div>

            {/* Mode toggle */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">EXECUTION MODE</label>
              {configLoading ? <Skeleton className="h-9 w-full" /> : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => config && !config.notifyOnly && toggleMode()}
                    className={cn(
                      "flex items-center justify-center gap-1.5 py-2 rounded-md font-mono text-xs border transition-colors",
                      config?.notifyOnly
                        ? "bg-primary/20 border-primary/50 text-primary"
                        : "bg-muted border-border text-muted-foreground"
                    )}
                  >
                    <Bell className="h-3 w-3" />
                    NOTIFY ONLY
                  </button>
                  <button
                    onClick={() => config && config.notifyOnly && toggleMode()}
                    className={cn(
                      "flex items-center justify-center gap-1.5 py-2 rounded-md font-mono text-xs border transition-colors",
                      !config?.notifyOnly
                        ? "bg-orange-500/20 border-orange-500/50 text-orange-400"
                        : "bg-muted border-border text-muted-foreground"
                    )}
                  >
                    <Zap className="h-3 w-3" />
                    AUTO TRADE
                  </button>
                </div>
              )}
              {!config?.notifyOnly && clobReady === false && (
                <p className="text-[10px] font-mono text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded p-2">
                  ⚠ Auto-trade requires CLOB API credentials. Connect your wallet on the Trading page first.
                </p>
              )}
              {!config?.notifyOnly && clobReady === true && (
                <p className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded p-2">
                  ✓ CLOB credentials ready — auto-trade is active.
                </p>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={updateConfig.isPending || !isUnlocked}
              title={!isUnlocked ? "Unlock trading in the sidebar first" : undefined}
              className="w-full py-2 rounded-md font-mono text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {!isUnlocked ? <span className="flex items-center justify-center gap-1.5"><Lock className="h-3 w-3" /> LOCKED</span> : updateConfig.isPending ? "SAVING..." : "SAVE CONFIG"}
            </button>
          </div>

          {/* Stats Panel */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">SIGNALS DETECTED</div>
                <div className="text-2xl font-mono font-bold">{logLoading ? <Skeleton className="h-8 w-12" /> : (log?.length ?? 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">TOTAL SIGNAL VOL</div>
                <div className="text-2xl font-mono font-bold text-primary">
                  {logLoading ? <Skeleton className="h-8 w-20" /> : formatCurrency(log?.reduce((s, t) => s + t.usdcSize, 0) ?? 0)}
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">BUYS DETECTED</div>
                <div className="text-2xl font-mono font-bold text-primary">
                  {logLoading ? <Skeleton className="h-8 w-12" /> : (log?.filter((t) => t.side === "BUY").length ?? 0)}
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">SELLS DETECTED</div>
                <div className="text-2xl font-mono font-bold text-secondary">
                  {logLoading ? <Skeleton className="h-8 w-12" /> : (log?.filter((t) => t.side === "SELL").length ?? 0)}
                </div>
              </div>
            </div>

            {/* Proxy setup */}
            <ProxySetupCard />

            {/* How it works */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="font-mono text-xs font-bold text-muted-foreground">HOW IT WORKS</h3>
              {[
                "Set a target whale wallet to monitor",
                "Bot checks for new trades every 6 seconds",
                "Trades within your size range trigger a signal",
                "In notify-only mode: signals are logged here",
                "In auto-trade mode: orders are placed via CLOB API (requires API keys)",
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs font-mono text-muted-foreground">
                  <span className="text-primary shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity Log */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h3 className="font-mono text-sm font-bold">SIGNAL LOG</h3>
            <button
              onClick={() => clearLog.mutate(undefined as unknown as void)}
              disabled={clearLog.isPending || !log?.length}
              className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              CLEAR
            </button>
          </div>
          <div className="divide-y divide-border">
            {logLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 m-3 rounded-md" />)
            ) : !log || log.length === 0 ? (
              <div className="p-12 text-center font-mono text-sm text-muted-foreground">
                {config?.enabled
                  ? "Watching for trades from " + (config.targetWallet ? truncateAddress(config.targetWallet) : "no target set")
                  : "Start the bot and set a target wallet to begin monitoring"}
              </div>
            ) : (
              log.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn(
                      "text-[10px] font-mono font-bold px-2 py-0.5 rounded border shrink-0",
                      t.side === "BUY"
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-secondary/15 border-secondary/40 text-secondary"
                    )}>
                      {t.side} {t.outcome}
                    </span>
                    <span className="text-xs font-mono text-foreground truncate">{t.market}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className={cn(
                      "text-[10px] font-mono px-1.5 py-0.5 rounded",
                      t.status === "executed" ? "bg-primary/10 text-primary"
                        : t.status === "logged" ? "bg-primary/10 text-primary"
                        : t.status === "error" ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {t.status === "logged" ? "DETECTED" : t.status.toUpperCase()}
                    </span>
                    <span className="font-mono text-sm font-bold text-primary">{formatCurrency(t.usdcSize)}</span>
                    <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">{formatTimeAgo(t.copiedAt)}</span>
                    <Link href={`/wallet/${t.targetWallet}`} className="text-muted-foreground hover:text-primary transition-colors">
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
