import { useState, useEffect } from "react";
import { Bell, BellOff, Mail, Send, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAdminToken } from "@/lib/adminAuth";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NotifyStatus {
  email: string;
  whaleEnabled: boolean;
  signalsEnabled: boolean;
  whaleThreshold: number;
  resendConfigured: boolean;
}

interface NotifyPatch { email?: string; whaleEnabled?: boolean; signalsEnabled?: boolean; whaleThreshold?: number; }

export function NotificationSettings() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/notifications`)
      .then((r) => r.json())
      .then((d: NotifyStatus) => {
        setStatus(d);
        setEmailInput(d.email || "");
        setThresholdInput(String(d.whaleThreshold ?? 1000));
      })
      .catch(() => {});
  }, []);

  const authHeaders = (): Record<string, string> => {
    const t = getAdminToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (t) headers["Authorization"] = `Bearer ${t}`;
    return headers;
  };

  const save = async (patch: NotifyPatch) => {
    setSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/settings/notifications`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      if (r.status === 401) { toast.error("Unlock trading in the sidebar first"); return; }
      if (!r.ok) { const d = await r.json() as { error?: string }; toast.error(d.error ?? "Save failed"); return; }
      const d = await r.json() as NotifyStatus;
      setStatus(d);
      setEmailInput(d.email || "");
      setThresholdInput(String(d.whaleThreshold ?? 1000));
      toast.success("Notification settings saved");
    } catch {
      toast.error("Failed to save notification settings");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await fetch(`${BASE_URL}/api/settings/notifications/test`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (r.status === 401) { toast.error("Unlock trading in the sidebar first"); return; }
      const d = await r.json() as { ok: boolean; sentTo?: string; error?: string };
      if (d.ok) toast.success(`Test email sent to ${d.sentTo}`);
      else toast.error(d.error ?? "Test failed");
    } catch {
      toast.error("Test failed — check server logs");
    } finally {
      setTesting(false);
    }
  };

  const saveThreshold = () => {
    const v = parseFloat(thresholdInput);
    if (!Number.isFinite(v) || v < 100) { toast.error("Minimum threshold is $100"); return; }
    save({ whaleThreshold: v });
  };

  const isActive = status?.resendConfigured && status?.email && (status.whaleEnabled || status.signalsEnabled);

  return (
    <div className="border-t border-border/60 pt-1.5 mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-[11px] font-mono text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        {isActive ? (
          <Bell className="h-3 w-3 shrink-0 text-emerald-400" />
        ) : (
          <BellOff className="h-3 w-3 shrink-0" />
        )}
        <span className={cn("flex-1 text-left", isActive && "text-emerald-400")}>
          {isActive ? "ALERTS: ON" : "ALERTS: OFF"}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2.5 bg-background/60 border border-border/60 rounded-lg p-3">
          {/* Resend indicator */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            {status?.resendConfigured ? (
              <><CheckCircle2 className="h-3 w-3 text-emerald-400" /><span className="text-emerald-400">Resend API ready</span></>
            ) : (
              <><XCircle className="h-3 w-3 text-rose-400" /><span className="text-rose-400">RESEND_API_KEY not set</span></>
            )}
          </div>

          {/* Email input */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground">SEND TO</label>
            <div className="flex gap-1">
              <Input
                type="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="font-mono text-[11px] h-7 bg-background border-border px-2"
              />
              <button
                onClick={() => save({ email: emailInput })}
                disabled={saving || !emailInput.trim()}
                className="px-2 h-7 rounded border border-border bg-muted hover:bg-muted/80 text-[10px] font-mono font-bold text-foreground transition-colors disabled:opacity-50 shrink-0"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "SET"}
              </button>
            </div>
          </div>

          {/* Toggle rows */}
          <div className="space-y-1.5">
            <ToggleRow
              label={`Whale BUY alerts ≥ $${Number(status?.whaleThreshold ?? 1000).toLocaleString()}`}
              enabled={status?.whaleEnabled ?? true}
              onToggle={(v) => save({ whaleEnabled: v })}
              saving={saving}
            />
            <ToggleRow
              label="AI signals digest"
              enabled={status?.signalsEnabled ?? true}
              onToggle={(v) => save({ signalsEnabled: v })}
              saving={saving}
            />
          </div>

          {/* Threshold input */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground">MIN TRADE SIZE (USDC)</label>
            <div className="flex gap-1">
              <Input
                type="number"
                min={100}
                step={500}
                placeholder="1000"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="font-mono text-[11px] h-7 bg-background border-border px-2"
              />
              <button
                onClick={saveThreshold}
                disabled={saving}
                className="px-2 h-7 rounded border border-border bg-muted hover:bg-muted/80 text-[10px] font-mono font-bold text-foreground transition-colors disabled:opacity-50 shrink-0"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "SET"}
              </button>
            </div>
            <div className="flex gap-1 mt-0.5">
              {[1000, 5000, 10000].map((v) => (
                <button
                  key={v}
                  onClick={() => save({ whaleThreshold: v })}
                  disabled={saving}
                  className={cn(
                    "px-1.5 h-5 rounded text-[9px] font-mono border transition-colors disabled:opacity-50",
                    status?.whaleThreshold === v
                      ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-400"
                      : "bg-muted border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  ${v >= 1000 ? `${v / 1000}K` : v}
                </button>
              ))}
            </div>
          </div>

          {/* Test button */}
          <button
            onClick={sendTest}
            disabled={testing || !status?.resendConfigured || !status?.email}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded border border-border bg-muted hover:bg-muted/80 text-[10px] font-mono font-bold text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {testing ? "SENDING…" : "SEND TEST EMAIL"}
          </button>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, enabled, onToggle, saving }: {
  label: string; enabled: boolean; onToggle: (v: boolean) => void; saving: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-mono text-muted-foreground truncate">{label}</span>
      <button
        onClick={() => onToggle(!enabled)}
        disabled={saving}
        className={cn(
          "relative shrink-0 h-4 w-7 rounded-full transition-colors border",
          enabled ? "bg-emerald-500/30 border-emerald-500/50" : "bg-muted border-border"
        )}
      >
        <span className={cn(
          "absolute top-0.5 h-3 w-3 rounded-full transition-all",
          enabled ? "left-3.5 bg-emerald-400" : "left-0.5 bg-muted-foreground/50"
        )} />
      </button>
    </div>
  );
}
