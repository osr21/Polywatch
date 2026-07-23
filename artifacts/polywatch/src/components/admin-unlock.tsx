import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAdminToken, setAdminToken, clearAdminToken } from "@/lib/adminAuth";
import { toast } from "sonner";

export function AdminUnlock() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [unlocked, setUnlocked] = useState(() => !!getAdminToken());

  const handleSave = () => {
    if (!value.trim()) return;
    setAdminToken(value.trim());
    setUnlocked(true);
    setValue("");
    setOpen(false);
    toast.success("Trading unlocked for this browser");
  };

  const handleClear = () => {
    clearAdminToken();
    setUnlocked(false);
    setOpen(false);
    toast.info("Trading locked");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-2 w-full ${unlocked ? "text-emerald-400" : "text-muted-foreground/50 hover:text-foreground"} transition-colors`}
          title={unlocked ? "Trading unlocked — click to relock" : "Enter admin token to enable trading actions"}
        >
          {unlocked ? <Unlock className="h-3 w-3 shrink-0" /> : <Lock className="h-3 w-3 shrink-0" />}
          <span>{unlocked ? "TRADING: UNLOCKED" : "TRADING: LOCKED"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 space-y-2">
        <p className="text-xs text-muted-foreground font-mono leading-relaxed">
          Bot config, order cancellation, and key re-derivation require the admin
          token configured on the server (ADMIN_TOKEN).
        </p>
        <Input
          type="password"
          placeholder="Admin token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          className="font-mono text-sm"
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleSave} disabled={!value.trim()}>
            Unlock
          </Button>
          {unlocked && (
            <Button size="sm" variant="outline" onClick={handleClear}>
              Lock
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
