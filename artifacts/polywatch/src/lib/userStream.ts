import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface UserStreamEvent {
  type: "trade" | "order" | string;
  status?: string;
  market?: string;
  asset?: string;
  side?: string;
  size?: number;
  price?: number;
  outcome?: string;
  id?: string;
}

export function useUserStream(onEvent?: (evt: UserStreamEvent) => void) {
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BASE_URL}/api/user-stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as UserStreamEvent | UserStreamEvent[];
        const events = Array.isArray(data) ? data : [data];
        for (const evt of events) {
          if (!evt || typeof evt !== "object") continue;

          if (evt.type === "trade" && evt.status === "CONFIRMED") {
            const side = evt.side ?? "";
            const outcome = evt.outcome ?? "";
            const market = evt.market ?? evt.asset ?? "market";
            toast.success(`Trade confirmed: ${side} ${outcome} on ${market.slice(0, 40)}`, {
              duration: 6000,
            });
          } else if (evt.type === "order") {
            // Silently handled — portfolio refetch covers it
          }

          onEventRef.current?.(evt);
        }
      } catch { /* ignore malformed */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); esRef.current = null; };
  }, [connect]);
}
