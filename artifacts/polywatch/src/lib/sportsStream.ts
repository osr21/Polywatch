import { useEffect, useRef, useState, useCallback } from "react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SportScore {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period?: string;
  status: string;
  eventId?: string | number;
  startTime?: string;
}

function parseSportEvent(raw: unknown): SportScore | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const home = String(r["home_team"] ?? r["homeTeam"] ?? r["team1"] ?? "");
  const away = String(r["away_team"] ?? r["awayTeam"] ?? r["team2"] ?? "");
  if (!home && !away) return null;
  return {
    sport: String(r["sport"] ?? ""),
    homeTeam: home,
    awayTeam: away,
    homeScore: Number(r["home_score"] ?? r["homeScore"] ?? r["score1"] ?? 0),
    awayScore: Number(r["away_score"] ?? r["awayScore"] ?? r["score2"] ?? 0),
    period: r["period"] != null ? String(r["period"]) : undefined,
    status: String(r["status"] ?? r["game_status"] ?? "live"),
    eventId: r["event_id"] != null ? String(r["event_id"]) : r["eventId"] != null ? String(r["eventId"]) : r["id"] != null ? String(r["id"]) : undefined,
    startTime: r["start_time"] != null ? String(r["start_time"]) : undefined,
  };
}

export function useSportsStream() {
  const [scores, setScores] = useState<Map<string, SportScore>>(new Map());
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BASE_URL}/api/sports-stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as unknown;
        const events = Array.isArray(data) ? data : [data];
        setScores((prev) => {
          const next = new Map(prev);
          for (const evt of events) {
            const score = parseSportEvent(evt);
            if (!score) continue;
            const key = `${score.homeTeam}|${score.awayTeam}`;
            next.set(key, score);
          }
          return next;
        });
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setTimeout(connect, 8000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); esRef.current = null; };
  }, [connect]);

  const getScoreForTitle = useCallback((title: string): SportScore | null => {
    if (!title) return null;
    const titleLower = title.toLowerCase();
    for (const score of scores.values()) {
      const homeLower = score.homeTeam.toLowerCase();
      const awayLower = score.awayTeam.toLowerCase();
      if (
        titleLower.includes(homeLower) ||
        titleLower.includes(awayLower) ||
        (homeLower && awayLower && (titleLower.includes(homeLower.split(" ")[0]) || titleLower.includes(awayLower.split(" ")[0])))
      ) {
        return score;
      }
    }
    return null;
  }, [scores]);

  return { scores, getScoreForTitle };
}
