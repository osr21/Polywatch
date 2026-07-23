import { useState, useEffect } from "react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SettingsStatus {
  clobReady: boolean;
  relayerReady: boolean;
  proxyReady: boolean;
  builderCode: { set: boolean; value: string | null };
  privateKey: { set: boolean };
  derivation: { state: "idle" | "running" | "done" | "failed"; error: string | null };
}

export function useAccountStatus() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${BASE_URL}/api/settings/status`)
        .then((r) => r.json())
        .then((d: SettingsStatus) => { if (!cancelled) setStatus(d); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return status;
}
