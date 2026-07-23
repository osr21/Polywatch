import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { createHmac, createHash } from "crypto";
import { promises as fsp } from "fs";
import path from "path";
import WebSocket from "ws";
import { Wallet } from "ethers";
import { createL1Headers, Chain } from "@polymarket/clob-client";
import { ProxyAgent, fetch as proxyFetch } from "undici";
import { getPublicProfile, getPublicProfilesBatch, type PublicProfile } from "../lib/profiles";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// ─── HTML escape (used in all email templates to prevent injection) ───────────
function escHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Email notifications (Resend REST API) ────────────────────────────────────
interface NotifyConfig {
  email: string;
  whaleEnabled: boolean;
  signalsEnabled: boolean;
  whaleThreshold: number; // minimum USDC size to trigger a whale email
}

let notifyConfig: NotifyConfig = {
  email: (process.env["NOTIFY_EMAIL"] || "").trim(),
  whaleEnabled: true,
  signalsEnabled: true,
  whaleThreshold: 10_000, // default: $10K minimum
};

// Guard: don't spam — one email per unique tx / signal-batch, with a short cooldown
const notifiedTxIds = new Set<string>();

async function sendEmail(subject: string, html: string): Promise<void> {
  const apiKey = (process.env["RESEND_API_KEY"] || "").trim();
  const to     = notifyConfig.email.trim();
  if (!apiKey || !to) return;

  const body = JSON.stringify({
    from: "PolyWatch <onboarding@resend.dev>",
    to: [to],
    subject,
    html,
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    logger.warn({ status: resp.status, body: txt.slice(0, 200) }, "Resend email failed");
    throw new Error(`Resend ${resp.status}: ${txt.slice(0, 200)}`);
  }
  logger.info({ to, subject }, "Email sent via Resend");
}

function formatUsd(n: number) {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function whaleEmailHtml(trade: {
  proxyWallet: string; name?: string | null; pseudonym?: string | null;
  side: string; outcome: string; title: string; usdcSize: number;
  riskScore?: number | null; walletAgeDays?: number | null;
}) {
  const wallet = trade.name || trade.pseudonym || trade.proxyWallet;
  const sideColor = trade.side === "BUY" ? "#10b981" : "#f43f5e";
  const riskLabel = trade.riskScore == null ? "" : trade.riskScore >= 75 ? "CRITICAL" : trade.riskScore >= 50 ? "HIGH" : trade.riskScore >= 25 ? "MEDIUM" : "LOW";
  const riskColor = trade.riskScore == null ? "#6b7280" : trade.riskScore >= 75 ? "#ef4444" : trade.riskScore >= 50 ? "#f97316" : trade.riskScore >= 25 ? "#eab308" : "#22c55e";

  return `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#e5e7eb;font-family:monospace;padding:24px;margin:0">
<div style="max-width:480px;margin:0 auto;border:1px solid #27272a;border-radius:12px;overflow:hidden">
  <div style="background:#111827;padding:16px 20px;border-bottom:1px solid #27272a">
    <span style="color:#06b6d4;font-weight:bold;font-size:14px">⚡ POLYWATCH — WHALE ALERT</span>
  </div>
  <div style="padding:20px;space-y:12px">
    <div style="font-size:22px;font-weight:bold;color:${sideColor};margin-bottom:4px">${escHtml(formatUsd(trade.usdcSize))}</div>
    <div style="font-size:11px;color:#9ca3af;margin-bottom:16px">${new Date().toUTCString()}</div>

    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr><td style="color:#6b7280;padding:4px 0;width:120px">SIDE</td>
          <td style="color:${sideColor};font-weight:bold">${escHtml(trade.side)} ${escHtml(trade.outcome)}</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">MARKET</td>
          <td style="color:#e5e7eb">${escHtml(trade.title)}</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">WALLET</td>
          <td style="color:#06b6d4">${escHtml(wallet)}</td></tr>
      ${trade.riskScore != null ? `<tr><td style="color:#6b7280;padding:4px 0">RISK</td>
          <td style="color:${riskColor};font-weight:bold">${escHtml(riskLabel)} (${trade.riskScore})</td></tr>` : ""}
      ${trade.walletAgeDays != null ? `<tr><td style="color:#6b7280;padding:4px 0">WALLET AGE</td>
          <td style="color:#e5e7eb">${Math.round(trade.walletAgeDays)}d</td></tr>` : ""}
    </table>

    <div style="margin-top:20px">
      <a href="https://polymarket.com/profile/${escHtml(trade.proxyWallet)}" style="color:#06b6d4;font-size:11px">View wallet on Polymarket →</a>
    </div>
  </div>
</div>
</body></html>`;
}

function signalsEmailHtml(insights: Array<{ title: string; insight: string; signal: string; confidence: string; action?: string; markets?: string[] }>) {
  const signalColor = (s: string) => s === "bullish" ? "#10b981" : s === "bearish" ? "#f43f5e" : "#9ca3af";
  const rows = insights.map((ins) => `
    <div style="border:1px solid #27272a;border-radius:8px;padding:14px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:bold;font-size:13px;color:#e5e7eb">${escHtml(ins.title)}</span>
        <span style="font-size:10px;color:${signalColor(ins.signal)};font-weight:bold;text-transform:uppercase">${escHtml(ins.signal)} · ${escHtml(ins.confidence)}</span>
      </div>
      <div style="font-size:12px;color:#9ca3af;line-height:1.5;margin-bottom:8px">${escHtml(ins.insight)}</div>
      ${ins.markets?.length ? `<div style="font-size:10px;color:#6b7280">📍 ${ins.markets.map(escHtml).join(" · ")}</div>` : ""}
      ${ins.action ? `<div style="font-size:10px;color:#06b6d4;margin-top:4px">→ ${escHtml(ins.action.replace(/_/g," ").toUpperCase())}</div>` : ""}
    </div>`).join("");

  return `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#e5e7eb;font-family:monospace;padding:24px;margin:0">
<div style="max-width:560px;margin:0 auto;border:1px solid #27272a;border-radius:12px;overflow:hidden">
  <div style="background:#111827;padding:16px 20px;border-bottom:1px solid #27272a">
    <span style="color:#06b6d4;font-weight:bold;font-size:14px">🧠 POLYWATCH — AI SIGNALS REPORT</span>
    <div style="font-size:11px;color:#6b7280;margin-top:2px">${new Date().toUTCString()}</div>
  </div>
  <div style="padding:20px">${rows}</div>
</div>
</body></html>`;
}

// Absolute ceiling on any single order's USDC notional, enforced server-side
// regardless of client-supplied config — a last line of defense if the admin
// token is ever compromised or a config value is set too aggressively.
const HARD_MAX_TRADE_USDC = 2000;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// Polymarket condition IDs are 0x-prefixed 32-byte hex strings (66 chars total).
// Accept 40–64 hex chars to cover both condition IDs and older shorter IDs.
const CONDITION_ID_RE = /^0x[0-9a-fA-F]{40,64}$/;

const DATA_API = "https://data-api.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const RELAYER_API = "https://relayer-v2.polymarket.com";

// ─── Runtime credential store (in-memory, overrides env vars) ─────────────────
// Values are write-only from the client perspective; never returned in any response.
const runtimeCreds: {
  key?: string;
  secret?: string;
  passphrase?: string;
  address?: string;
  privateKey?: string;
  builderCode?: string;
} = {};

// Forward reference for 401 auto-re-derive (assigned once deriveAndStoreCredentials is defined below).
// Allows clobGet/clobPost to recover from stale credentials without a forward-declaration cycle.
let _autoRederive: null | (() => Promise<{ ok: boolean; error?: string }>) = null;

// ─── CLOB Auth helpers ────────────────────────────────────────────────────────
function getClobCreds() {
  const key      = (runtimeCreds.key        || process.env["POLY_API_KEY"]        || "").trim();
  const secret   = (runtimeCreds.secret     || process.env["POLY_API_SECRET"]     || "").trim();
  const passphrase = (runtimeCreds.passphrase || process.env["POLY_API_PASSPHRASE"] || "").trim();
  const address  = (runtimeCreds.address    || process.env["POLY_ADDRESS"]        || "").trim();
  return { key, secret, passphrase, address, ok: !!(key && secret && passphrase && address) };
}

function getBuilderCode(): string {
  return runtimeCreds.builderCode || process.env["POLY_BUILDER_CODE"] || "";
}

function getPrivateKey(): string {
  return runtimeCreds.privateKey || process.env["POLY_PRIVATE_KEY"] || "";
}

// ─── Relayer Auth helpers ─────────────────────────────────────────────────────
function getRelayerCreds() {
  const key     = process.env["RELAYER_API_KEY"]         || "";
  const address = process.env["RELAYER_API_KEY_ADDRESS"] || "";
  return { key, address, ok: !!(key && address) };
}

function buildRelayerHeaders(): Record<string, string> {
  const { key, address } = getRelayerCreds();
  return {
    "Accept":               "application/json",
    "Content-Type":         "application/json",
    "RELAYER_API_KEY":      key,
    "RELAYER_API_KEY_ADDRESS": address,
  };
}

async function relayerGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${RELAYER_API}${path}`, {
    headers: buildRelayerHeaders(),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Relayer ${path} → ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

function buildClobHeaders(method: string, path: string, body = ""): Record<string, string> {
  const { key, secret, passphrase } = getClobCreds();
  const ts = Math.floor(Date.now() / 1000).toString();
  const msg = ts + method.toUpperCase() + path + (body || "");
  // Normalize base64url → base64 before decoding (secrets sometimes arrive as base64url)
  const secretNorm = secret.replace(/-/g, "+").replace(/_/g, "/");
  // Output must be URL-safe base64 (per official @polymarket/clob-client hmac.js)
  const sig = createHmac("sha256", Buffer.from(secretNorm, "base64"))
    .update(msg)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return {
    "User-Agent":    "@polymarket/clob-client",
    "Accept":        "*/*",
    "Content-Type":  "application/json",
    "POLY_ADDRESS":  getClobCreds().address,
    "POLY_API_KEY":  key,
    "POLY_PASSPHRASE": passphrase,
    "POLY_TIMESTAMP": ts,
    "POLY_SIGNATURE": sig,
  };
}

// ─── Residential proxy for CLOB order calls ───────────────────────────────────
// Set CLOB_PROXY_URL to a residential HTTP/SOCKS5 proxy (e.g. Bright Data) to
// route CLOB order placement through a non-datacenter IP, bypassing Cloudflare.
// Format: http://user:pass@proxy.host:port  or  socks5://user:pass@host:port
function getClobProxyUrl(): string {
  return process.env["CLOB_PROXY_URL"] || "";
}

// Proxy passwords from Bright Data / Oxylabs often contain special chars (!@#$)
// that break URL parsing. This function re-encodes only the credential portion
// so undici's ProxyAgent can parse the URL correctly.
function sanitizeProxyUrl(raw: string): string {
  // Try parsing as-is first — if it works, return unchanged
  try { new URL(raw); return raw; } catch { /* fall through */ }

  // Manual parse: scheme://user:pass@host:port/path
  // Use the LAST @ as the credentials/host separator (password may contain @)
  const schemeEnd = raw.indexOf("://");
  if (schemeEnd === -1) return raw; // not a valid URL at all
  const scheme = raw.slice(0, schemeEnd);
  const rest = raw.slice(schemeEnd + 3); // everything after "://"
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) return raw; // no credentials — return as-is

  const credsPart = rest.slice(0, atIdx);
  const hostPart  = rest.slice(atIdx + 1);

  // Split credentials on the FIRST colon only (username may not contain colons)
  const colonIdx = credsPart.indexOf(":");
  const user = colonIdx === -1 ? credsPart : credsPart.slice(0, colonIdx);
  const pass = colonIdx === -1 ? "" : credsPart.slice(colonIdx + 1);

  const encoded = `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostPart}`;
  logger.info("sanitized proxy URL credentials (value redacted)");
  return encoded;
}

let _clobProxyAgent: ProxyAgent | null = null;
function getClobProxyAgent(): ProxyAgent | null {
  const raw = getClobProxyUrl();
  if (!raw) return null;
  if (!_clobProxyAgent) _clobProxyAgent = new ProxyAgent(sanitizeProxyUrl(raw));
  return _clobProxyAgent;
}

// Fetch through the residential proxy if configured, otherwise plain fetch.
// Only used for CLOB calls — public Polymarket API calls always use plain fetch.
// Return type uses ReturnType<typeof fetch> to avoid collision with Express.Response.
async function clobFetch(url: string, opts: RequestInit = {}): ReturnType<typeof fetch> {
  const agent = getClobProxyAgent();
  if (agent) {
    return proxyFetch(url, { ...opts, dispatcher: agent } as Parameters<typeof proxyFetch>[1]) as unknown as ReturnType<typeof fetch>;
  }
  return fetch(url, opts);
}

async function clobGet<T>(path: string): Promise<T> {
  const makeReq = () => {
    const headers = buildClobHeaders("GET", path);
    return clobFetch(`${CLOB_API}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  };
  let resp = await makeReq();
  // On 401: credentials may be stale (Polymarket rotates them). Re-derive from private key and retry once.
  if (resp.status === 401 && _autoRederive && getPrivateKey()) {
    logger.info({ path }, "CLOB GET 401 — re-deriving credentials and retrying");
    const r = await _autoRederive();
    if (r.ok) resp = await makeReq();
  }
  if (!resp.ok) throw new Error(`CLOB ${path} → ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

async function clobPost<T>(path: string, body: unknown): Promise<T> {
  const bodyStr = JSON.stringify(body);
  const makeReq = () => {
    const headers = buildClobHeaders("POST", path, bodyStr);
    return clobFetch(`${CLOB_API}${path}`, {
      method: "POST", headers, body: bodyStr, signal: AbortSignal.timeout(15000),
    });
  };
  let resp = await makeReq();
  if (resp.status === 401 && _autoRederive && getPrivateKey()) {
    logger.info({ path }, "CLOB POST 401 — re-deriving credentials and retrying");
    const r = await _autoRederive();
    if (r.ok) resp = await makeReq();
  }
  if (!resp.ok) throw new Error(`CLOB POST ${path} → ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

async function fetchPolymarket<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`Polymarket API error: ${resp.status} for ${url}`);
  }
  return resp.json() as Promise<T>;
}

interface PolyTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId?: string;
  size: number;
  price: number;
  usdcSize?: number;
  timestamp: number;
  title: string;
  slug?: string;
  icon?: string;
  outcome: string;
  // Index into the market's outcomes/clobTokenIds arrays. Reliable when trades are
  // fetched with a `user=` filter; the unfiltered global /trades feed returns a
  // sentinel value (999) here and must not be trusted for order routing.
  outcomeIndex?: number;
  name?: string;
  pseudonym?: string;
  profileImage?: string;
  transactionHash: string;
  walletAge?: number | null;
  riskScore?: number | null;
  walletAgeDays?: number | null;
}

// Resolves which CLOB token to trade for a given trade, supporting markets with
// more than two outcomes (e.g. negative-risk / multi-candidate markets).
// Preference order: 1) explicit outcomeIndex from a user-filtered trade lookup,
// 2) matching the outcome label against the market's outcomes array, 3) a
// best-effort binary Yes/No fallback (only safe when there are exactly 2 outcomes).
// Returns tokenId: null (rather than guessing) when none of these resolve cleanly.
function resolveTokenId(
  market: { outcomes?: string; clobTokenIds?: string } | null | undefined,
  outcome: string | undefined,
  outcomeIndexHint?: number | null
): { tokenId: string | null; index: number | null; matched: boolean } {
  let tokenIds: string[] = [];
  let outcomes: string[] = [];
  try { if (market?.clobTokenIds) tokenIds = JSON.parse(market.clobTokenIds); } catch { /* ignore */ }
  try { if (market?.outcomes) outcomes = JSON.parse(market.outcomes); } catch { /* ignore */ }

  if (tokenIds.length === 0) return { tokenId: null, index: null, matched: false };

  if (
    outcomeIndexHint != null &&
    Number.isInteger(outcomeIndexHint) &&
    outcomeIndexHint >= 0 &&
    outcomeIndexHint < tokenIds.length
  ) {
    return { tokenId: tokenIds[outcomeIndexHint], index: outcomeIndexHint, matched: true };
  }

  if (outcome && outcomes.length > 0) {
    const idx = outcomes.findIndex((o) => o.toLowerCase() === outcome.toLowerCase());
    if (idx !== -1 && idx < tokenIds.length) {
      return { tokenId: tokenIds[idx], index: idx, matched: true };
    }
  }

  if (tokenIds.length === 2) {
    const idx = outcome?.toLowerCase().includes("no") ? 1 : 0;
    return { tokenId: tokenIds[idx], index: idx, matched: false };
  }

  return { tokenId: null, index: null, matched: false };
}

interface PolyActivity extends PolyTrade {
  type: string;
}

interface PolyPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue?: number;
  currentValue: number;
  cashPnl?: number;
  percentPnl?: number;
  curPrice?: number;
  redeemable?: boolean;
  title: string;
  slug?: string;
  icon?: string;
  outcome: string;
  endDate?: string;
}

interface PolyMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  liquidity: string;
  startDate: string;
  endDate: string;
  image?: string;
  icon?: string;
  description?: string;
  volume?: string;
  active?: boolean;
  volume24hr?: number;
  volume1wk?: number;
  volumeNum?: number;
  outcomePrices?: string;
  outcomes?: string;
  clobTokenIds?: string;
}

function computeRisk(
  walletAgeDays: number,
  tradeCount: number,
  avgTradeSize: number
): { score: number; label: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  if (walletAgeDays < 3) {
    score += 45;
    factors.push("Wallet is less than 3 days old");
  } else if (walletAgeDays < 7) {
    score += 30;
    factors.push("Wallet is less than 7 days old");
  } else if (walletAgeDays < 30) {
    score += 15;
    factors.push("Wallet is less than 30 days old");
  }

  if (avgTradeSize > 50000) {
    score += 30;
    factors.push("Average trade size exceeds $50,000");
  } else if (avgTradeSize > 10000) {
    score += 20;
    factors.push("Average trade size exceeds $10,000");
  } else if (avgTradeSize > 5000) {
    score += 10;
    factors.push("Average trade size exceeds $5,000");
  }

  if (tradeCount < 5 && avgTradeSize > 5000) {
    score += 20;
    factors.push("Concentrated activity: few trades with large size");
  } else if (tradeCount < 10) {
    score += 5;
    factors.push("Low number of total trades");
  }

  score = Math.min(score, 100);
  const label: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" =
    score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";

  if (factors.length === 0) factors.push("No significant risk indicators detected");

  return { score, label, factors };
}

async function getActivityForWallet(address: string, limit = 100): Promise<PolyActivity[]> {
  try {
    const data = await fetchPolymarket<PolyActivity[]>(
      `${DATA_API}/activity?user=${address}&limit=${limit}`
    );
    if (!Array.isArray(data)) return [];
    return data.filter((t) => !t.type || t.type === "TRADE");
  } catch {
    try {
      const data = await fetchPolymarket<PolyTrade[]>(
        `${DATA_API}/trades?user=${address}&limit=${limit}`
      );
      if (!Array.isArray(data)) return [];
      return data.map((t) => ({ ...t, type: "TRADE", usdcSize: t.usdcSize ?? t.size * t.price }));
    } catch {
      return [];
    }
  }
}

function tradeToResponse(
  trade: PolyTrade & { usdcSize: number },
  riskScore: number | null,
  walletAgeDays: number | null,
  profile?: PublicProfile | null
) {
  return {
    proxyWallet: trade.proxyWallet,
    side: trade.side,
    size: trade.size,
    price: trade.price,
    usdcSize: trade.usdcSize,
    timestamp: trade.timestamp,
    title: trade.title,
    slug: trade.slug ?? null,
    icon: trade.icon ?? null,
    outcome: trade.outcome,
    conditionId: trade.conditionId ?? null,
    transactionHash: trade.transactionHash,
    name: trade.name ?? profile?.name ?? null,
    pseudonym: trade.pseudonym ?? profile?.pseudonym ?? null,
    profileImage: trade.profileImage ?? profile?.profileImage ?? null,
    riskScore,
    walletAgeDays,
  };
}

// ─── Portfolio endpoint ───────────────────────────────────────────────────────
router.get("/portfolio", async (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const address = creds.address;
    const [posRaw, balRaw] = await Promise.allSettled([
      fetchPolymarket<PolyPosition[]>(`${DATA_API}/positions?user=${address}&sizeThreshold=0.01&limit=100`),
      clobGet<{ balance: string }>("/balance"),
    ]);
    const positions = posRaw.status === "fulfilled" && Array.isArray(posRaw.value) ? posRaw.value : [];
    const usdcBalance = balRaw.status === "fulfilled" ? parseFloat(balRaw.value.balance ?? "0") : null;

    let totalValue = 0, totalCost = 0;
    const mapped = positions.map((p) => {
      const cost = p.initialValue ?? p.size * p.avgPrice;
      const val = p.currentValue ?? p.size * (p.curPrice ?? p.avgPrice);
      totalCost += cost;
      totalValue += val;
      return {
        proxyWallet: p.proxyWallet || address,
        asset: p.asset,
        conditionId: p.conditionId,
        size: p.size,
        avgPrice: p.avgPrice,
        initialValue: cost,
        currentValue: val,
        cashPnl: p.cashPnl ?? null,
        percentPnl: p.percentPnl ?? null,
        curPrice: p.curPrice ?? null,
        title: p.title,
        slug: p.slug ?? null,
        icon: p.icon ?? null,
        outcome: p.outcome,
        endDate: p.endDate ?? null,
        redeemable: p.redeemable ?? null,
      };
    });
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    return res.json({ address, positions: mapped, totalValue, totalCost, totalPnl, totalPnlPct, usdcBalance });
  } catch (err) {
    logger.error({ err }, "Portfolio fetch failed");
    return res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

// ─── Bot trade execution ──────────────────────────────────────────────────────
router.post("/bot/execute", requireAdmin, async (req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });

  const { tokenId, side, usdcSize, price, outcomeLabel, marketTitle } = req.body as {
    tokenId: string; side: "BUY" | "SELL"; usdcSize: number;
    price?: number | null; outcomeLabel: string; marketTitle: string;
  };

  if (!tokenId || !side || !usdcSize) {
    return res.status(400).json({ error: "tokenId, side, usdcSize required" });
  }
  if (usdcSize > HARD_MAX_TRADE_USDC) {
    return res.status(400).json({ error: `usdcSize exceeds server-enforced max of $${HARD_MAX_TRADE_USDC}` });
  }

  try {
    // Get mid price if not provided
    let entryPrice = price ?? null;
    if (!entryPrice) {
      try {
        const book = await fetchPolymarket<{ bids: { price: string }[]; asks: { price: string }[] }>(
          `${CLOB_API}/book?token_id=${tokenId}`
        );
        const bestAsk = book.asks?.[0] ? parseFloat(book.asks[0].price) : null;
        const bestBid = book.bids?.[0] ? parseFloat(book.bids[0].price) : null;
        entryPrice = side === "BUY" ? bestAsk : bestBid;
      } catch { /* use market order */ }
    }

    const validPrice = entryPrice != null && Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null;
    const size = validPrice ? usdcSize / validPrice : usdcSize;
    const builderCode = getBuilderCode();
    const orderBody = {
      order: {
        tokenID: tokenId,
        side: side === "BUY" ? "BUY" : "SELL",
        type: validPrice ? "LIMIT" : "MARKET",
        price: validPrice ? validPrice.toFixed(4) : undefined,
        size: size.toFixed(2),
        feeRateBps: "0",
        ...(builderCode ? { builderCode } : {}),
      },
      orderType: botConfig.orderType ?? "GTC",
    };

    const result = await clobPost<{ orderID?: string; status?: string; errorMsg?: string }>("/order", orderBody);

    const entry: BotTrade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      originalTx: result.orderID ?? "manual",
      targetWallet: creds.address,
      market: marketTitle,
      side,
      outcome: outcomeLabel,
      usdcSize,
      copiedAt: Date.now() / 1000,
      status: result.status === "matched" || result.orderID ? "executed" : "error",
      note: result.errorMsg ?? result.orderID ?? undefined,
    };
    botLog.unshift(entry);
    if (botLog.length > 100) botLog.splice(100);

    return res.json({
      ok: !result.errorMsg,
      orderId: result.orderID ?? null,
      status: result.status ?? "submitted",
      message: result.errorMsg ?? `Order ${result.orderID ?? "submitted"}`,
    });
  } catch (err) {
    logger.error({ err }, "Trade execution failed");
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, orderId: null, status: "error", message: msg });
  }
});

// ─── SSE client registry ────────────────────────────────────────────────────
const sseClients = new Set<Response>();

// WebSocket connection to Polymarket live trades feed
let wsClient: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeenTxHashes = new Set<string>();

function broadcastToSseClients(trades: ReturnType<typeof tradeToResponse>[]) {
  if (trades.length === 0 || sseClients.size === 0) return;
  const msg = `data: ${JSON.stringify(trades)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

function startWsFeed() {
  if (wsClient && (wsClient.readyState === WebSocket.OPEN || wsClient.readyState === WebSocket.CONNECTING)) return;
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

  try {
    const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
    wsClient = ws;

    ws.on("open", () => {
      logger.info("Polymarket WS connected");
      // Subscribe to global trade feed
      ws.send(JSON.stringify({ type: "subscribe", channel: "market" }));
    });

    ws.on("message", (raw) => {
      if (sseClients.size === 0) return;
      try {
        const msgs = JSON.parse(raw.toString()) as unknown;
        const arr: unknown[] = Array.isArray(msgs) ? msgs : [msgs];
        const MIN = 500;
        const newTrades: ReturnType<typeof tradeToResponse>[] = [];
        for (const item of arr) {
          if (typeof item !== "object" || item === null) continue;
          const m = item as Record<string, unknown>;
          // Polymarket WS trade event shape
          if (m["event_type"] !== "trade" && m["type"] !== "trade") continue;
          const tx = String(m["transaction_hash"] ?? m["id"] ?? "");
          if (!tx || lastSeenTxHashes.has(tx)) continue;
          lastSeenTxHashes.add(tx);
          const usdcSize = parseFloat(String(m["size"] ?? "0")) * parseFloat(String(m["price"] ?? "0"));
          if (usdcSize < MIN) continue;
          newTrades.push({
            proxyWallet: String(m["maker"] ?? m["taker"] ?? ""),
            side: (String(m["side"] ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
            size: parseFloat(String(m["size"] ?? "0")),
            price: parseFloat(String(m["price"] ?? "0")),
            usdcSize,
            timestamp: Math.floor(Date.now() / 1000),
            title: String(m["market"] ?? m["condition_id"] ?? ""),
            slug: null, icon: null, outcome: String(m["outcome"] ?? ""),
            conditionId: String(m["condition_id"] ?? null),
            transactionHash: tx,
            name: null, pseudonym: null, profileImage: null, riskScore: null, walletAgeDays: null,
          });
        }
        broadcastToSseClients(newTrades);
        if (lastSeenTxHashes.size > 2000) {
          const arr2 = [...lastSeenTxHashes];
          lastSeenTxHashes = new Set(arr2.slice(arr2.length - 1000));
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on("error", (err) => logger.warn({ err }, "Polymarket WS error"));
    ws.on("close", () => {
      logger.info("Polymarket WS closed — reconnecting in 5s");
      wsClient = null;
      wsReconnectTimer = setTimeout(startWsFeed, 5000);
      // Fall back to polling if no clients connected
      if (sseClients.size > 0) fallbackPoll();
    });
  } catch (err) {
    logger.warn({ err }, "WS start failed — falling back to polling");
    wsReconnectTimer = setTimeout(startWsFeed, 10000);
    fallbackPoll();
  }
}

// Polling fallback (used when WS is reconnecting)
async function fallbackPoll() {
  if (sseClients.size === 0) return;
  try {
    const raw = await fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=200`);
    if (!Array.isArray(raw)) return;
    const MIN = 500;
    const newTrades = raw
      .map((t) => ({ ...t, usdcSize: t.usdcSize ?? t.size * t.price }))
      .filter((t) => t.usdcSize >= MIN && !lastSeenTxHashes.has(t.transactionHash));
    for (const t of newTrades) lastSeenTxHashes.add(t.transactionHash);
    broadcastToSseClients(newTrades.map((t) => tradeToResponse(t, null, null)));
  } catch { /* ignore */ }
}

router.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  sseClients.add(res);

  // Start WS feed if not already running
  startWsFeed();
  // Only poll immediately if WS isn't live yet — avoids a redundant API call on every page load
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) fallbackPoll();

  // Heartbeat every 20s so proxies don't close idle connections.
  // On failure, eagerly remove the dead client so sseClients doesn't grow unboundedly.
  const hb = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      sseClients.delete(res);
      clearInterval(hb);
    }
  }, 20000);

  req.on("close", () => {
    sseClients.delete(res);
    clearInterval(hb);
  });
});

// ─── Bot state (in-memory, no persistence needed) ───────────────────────────
interface BotConfig {
  enabled: boolean;
  targetWallet: string;
  minTradeSize: number;
  maxTradeSize: number;
  copyPct: number;
  allowedSides: ("BUY" | "SELL")[];
  notifyOnly: boolean;
  orderType: "GTC" | "GTD" | "FOK" | "FAK";
}

interface BotTrade {
  id: string;
  originalTx: string;
  targetWallet: string;
  market: string;
  side: "BUY" | "SELL";
  outcome: string;
  usdcSize: number;
  copiedAt: number;
  status: "pending" | "executed" | "logged" | "skipped" | "error";
  note?: string;
}

let botConfig: BotConfig = {
  enabled: false,
  targetWallet: "",
  minTradeSize: 1000,
  maxTradeSize: 10000,
  copyPct: 100,
  allowedSides: ["BUY", "SELL"],
  notifyOnly: true,
  orderType: "GTC",
};
const botLog: BotTrade[] = [];
const botSeenTx = new Set<string>();

// ─── Bot state persistence ─────────────────────────────────────────────────
// Saves to disk so config/seen-tx survive server restarts (Replit container sleeps).
const BOT_STATE_FILE = path.join(process.cwd(), "bot-state.json");
interface PersistedBotState { config: BotConfig; seenTx: string[]; }
const botStatus = { lastPolledAt: 0, lastError: null as string | null, initialSeedDone: false };

async function loadBotState(): Promise<void> {
  try {
    const raw = await fsp.readFile(BOT_STATE_FILE, "utf8");
    const state = JSON.parse(raw) as PersistedBotState;
    if (state.config && typeof state.config === "object") {
      botConfig = { ...botConfig, ...state.config };
    }
    if (Array.isArray(state.seenTx)) {
      for (const tx of state.seenTx) botSeenTx.add(tx);
    }
    logger.info({ enabled: botConfig.enabled, wallet: botConfig.targetWallet || "none" }, "Bot state loaded from disk");
  } catch {
    // File not found or invalid — first run, use defaults
  }
}

function saveBotState(): void {
  const state: PersistedBotState = {
    config: botConfig,
    seenTx: [...botSeenTx].slice(-500),
  };
  fsp.writeFile(BOT_STATE_FILE, JSON.stringify(state, null, 2), "utf8").catch((err) => {
    logger.warn({ err }, "Failed to persist bot state");
  });
}

void loadBotState();

// Watch for target wallet trades and optionally execute copy trades
setInterval(async () => {
  if (!botConfig.enabled || !botConfig.targetWallet) return;
  try {
    botStatus.lastPolledAt = Date.now();
    botStatus.lastError = null;
    const raw = await fetchPolymarket<PolyTrade[]>(
      `${DATA_API}/trades?user=${botConfig.targetWallet}&limit=50`
    );
    if (!Array.isArray(raw)) return;

    // First poll for this wallet: seed seenTx with all existing trades so we only
    // alert on genuinely NEW trades going forward (not historical ones).
    if (!botStatus.initialSeedDone) {
      for (const t of raw) {
        const txKey = (t as unknown as Record<string, string>)["transaction_hash"]
          ?? t.transactionHash
          ?? `${(t as unknown as Record<string, string>)["proxy_wallet"] ?? t.proxyWallet}-${t.timestamp}-${t.asset}`;
        botSeenTx.add(txKey);
      }
      botStatus.initialSeedDone = true;
      logger.info({ wallet: botConfig.targetWallet, seeded: raw.length }, "Bot seeded seenTx — watching for new trades only");
      return;
    }

    for (const t of raw) {
      // Raw Polymarket API returns snake_case; transactionHash is the mapped name
      const txKey = (t as unknown as Record<string, string>)["transaction_hash"]
        ?? t.transactionHash
        ?? `${(t as unknown as Record<string, string>)["proxy_wallet"] ?? t.proxyWallet}-${t.timestamp}-${t.asset}`;
      if (botSeenTx.has(txKey)) continue;
      botSeenTx.add(txKey);
      const raw2 = t as unknown as Record<string, unknown>;
      const usdc = (typeof raw2["usdc_size"] === "number" ? raw2["usdc_size"] : null)
        ?? t.usdcSize
        ?? ((raw2["size"] as number ?? t.size) * (raw2["price"] as number ?? t.price));
      if (usdc < botConfig.minTradeSize || usdc > botConfig.maxTradeSize) continue;
      if (!botConfig.allowedSides.includes(t.side)) continue;
      const copySize = Math.min(HARD_MAX_TRADE_USDC, usdc * (botConfig.copyPct / 100));

      if (botConfig.notifyOnly) {
        const entry: BotTrade = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          originalTx: txKey,
          targetWallet: (t as unknown as Record<string, string>)["proxy_wallet"] ?? t.proxyWallet,
          market: (t as unknown as Record<string, string>)["title"] ?? t.title,
          side: t.side,
          outcome: (t as unknown as Record<string, string>)["outcome"] ?? t.outcome,
          usdcSize: copySize,
          copiedAt: Date.now() / 1000,
          status: "logged",
          note: "Notify-only mode — no trade submitted",
        };
        botLog.unshift(entry);
        if (botLog.length > 100) botLog.splice(100);
        continue;
      }

      // Auto-trade: look up tokenId from market conditionId, then submit
      const entry: BotTrade = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        originalTx: t.transactionHash,
        targetWallet: t.proxyWallet,
        market: t.title,
        side: t.side,
        outcome: t.outcome,
        usdcSize: copySize,
        copiedAt: Date.now() / 1000,
        status: "pending",
      };
      botLog.unshift(entry);
      if (botLog.length > 100) botLog.splice(100);

      // Execute async — update entry status when done
      (async () => {
        try {
          const creds = getClobCreds();
          if (!creds.ok) { entry.status = "error"; entry.note = "No CLOB credentials"; return; }

          // Get tokenId for this market
          const market = await fetchPolymarket<(PolyMarket & { clobTokenIds?: string })[]>(
            `${GAMMA_API}/markets?conditionId=${encodeURIComponent(t.conditionId ?? "")}&limit=1`
          ).then((r) => Array.isArray(r) ? r[0] : null).catch(() => null);

          const { tokenId, matched } = resolveTokenId(market, t.outcome, t.outcomeIndex ?? null);
          if (!tokenId) {
            entry.status = "error";
            entry.note = "Could not resolve outcome token (multi-outcome market with no reliable match)";
            return;
          }
          if (!matched) {
            logger.warn({ conditionId: t.conditionId, outcome: t.outcome }, "Bot fell back to binary outcome matching — verify market structure");
          }

          const book = await fetchPolymarket<{ asks: { price: string }[]; bids: { price: string }[] }>(
            `${CLOB_API}/book?token_id=${tokenId}`
          ).catch(() => null);
          const rawPrice = t.side === "BUY"
            ? (book?.asks?.[0] ? parseFloat(book.asks[0].price) : null)
            : (book?.bids?.[0] ? parseFloat(book.bids[0].price) : null);
          const entryPrice = rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;

          const size = entryPrice ? copySize / entryPrice : copySize;
          const builderCode = getBuilderCode();
          const orderBody = {
            order: {
              tokenID: tokenId, side: t.side,
              type: entryPrice ? "LIMIT" : "MARKET",
              price: entryPrice ? entryPrice.toFixed(4) : undefined,
              size: size.toFixed(2), feeRateBps: "0",
              ...(builderCode ? { builderCode } : {}),
            },
            orderType: botConfig.orderType ?? "GTC",
          };

          const result = await clobPost<{ orderID?: string; status?: string; errorMsg?: string }>("/order", orderBody);
          entry.status = result.errorMsg ? "error" : "executed";
          entry.note = result.errorMsg ?? result.orderID ?? "submitted";
        } catch (err) {
          entry.status = "error";
          entry.note = err instanceof Error ? err.message : "Unknown error";
        }
      })();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botStatus.lastError = msg;
    logger.warn({ err: msg, wallet: botConfig.targetWallet }, "Bot poll error");
  }
}, 6000);

// ─── Server-side whale notification monitor ───────────────────────────────────
// Runs every 60 s regardless of whether any browser tab is open.
// First run seeds the seen-set so we don't flood historical trades on restart.
const whaleMonitorSeenTx = new Set<string>();
let whaleMonitorSeeded = false;

setInterval(async () => {
  if (!notifyConfig.whaleEnabled) return;
  if (!(process.env["RESEND_API_KEY"] || "").trim()) return;

  try {
    const raw = await fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=500`);
    if (!Array.isArray(raw)) return;

    const trades = raw.map((t) => ({ ...t, usdcSize: t.usdcSize ?? t.size * t.price }));

    // Seed on first run — don't email trades that already existed when server started
    if (!whaleMonitorSeeded) {
      for (const t of trades) {
        const key = t.transactionHash ?? `${t.proxyWallet}-${t.timestamp}-${t.asset}`;
        whaleMonitorSeenTx.add(key);
      }
      whaleMonitorSeeded = true;
      logger.info({ seeded: trades.length }, "Whale monitor seeded");
      return;
    }

    const newWhales: Array<typeof trades[number]> = [];
    for (const t of trades) {
      const key = t.transactionHash ?? `${t.proxyWallet}-${t.timestamp}-${t.asset}`;
      if (!whaleMonitorSeenTx.has(key)) {
        whaleMonitorSeenTx.add(key);
        if (t.usdcSize >= notifyConfig.whaleThreshold && t.side === "BUY") newWhales.push(t);
      }
      if (whaleMonitorSeenTx.size > 5000) {
        const first = whaleMonitorSeenTx.values().next().value;
        if (first) whaleMonitorSeenTx.delete(first);
      }
    }

    logger.info({ newTrades: trades.filter(t => !whaleMonitorSeenTx.has(t.transactionHash ?? `${t.proxyWallet}-${t.timestamp}-${t.asset}`)).length, qualifying: newWhales.length, threshold: notifyConfig.whaleThreshold }, "Whale monitor poll");

    // Send one email per new whale trade (largest first)
    newWhales.sort((a, b) => b.usdcSize - a.usdcSize);
    for (const t of newWhales) {
      const walletLabel = t.name || t.pseudonym || t.proxyWallet.slice(0, 10) + "…";
      logger.info({ usdc: t.usdcSize, wallet: walletLabel }, "Whale monitor — sending email");
      sendEmail(
        `🐳 Whale Alert: ${formatUsd(t.usdcSize)} ${t.side} on ${(t.title ?? "").slice(0, 50)}`,
        whaleEmailHtml({ ...t, name: t.name ?? null, pseudonym: t.pseudonym ?? null }),
      ).catch((err) => logger.warn({ err }, "Whale monitor email failed"));
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Whale monitor poll error");
  }
}, 60_000);

router.get("/bot/config", (_req: Request, res: Response) => {
  return res.json({ ...botConfig, lastPolledAt: botStatus.lastPolledAt, lastError: botStatus.lastError });
});

router.post("/bot/config", requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Partial<BotConfig>;
  if (typeof body.enabled === "boolean") botConfig.enabled = body.enabled;
  if (typeof body.targetWallet === "string") {
    if (body.targetWallet !== "" && !EVM_ADDRESS_RE.test(body.targetWallet)) {
      return res.status(400).json({ error: "targetWallet must be a valid 0x... address" });
    }
    botConfig.targetWallet = body.targetWallet;
    botSeenTx.clear();
    botStatus.initialSeedDone = false;
  }
  if (typeof body.minTradeSize === "number") botConfig.minTradeSize = body.minTradeSize;
  if (typeof body.maxTradeSize === "number") botConfig.maxTradeSize = Math.min(HARD_MAX_TRADE_USDC, body.maxTradeSize);
  if (typeof body.copyPct === "number") botConfig.copyPct = Math.min(200, Math.max(1, body.copyPct));
  if (Array.isArray(body.allowedSides)) botConfig.allowedSides = body.allowedSides;
  if (typeof body.notifyOnly === "boolean") botConfig.notifyOnly = body.notifyOnly;
  if (body.orderType && ["GTC", "GTD", "FOK", "FAK"].includes(body.orderType)) botConfig.orderType = body.orderType as BotConfig["orderType"];
  saveBotState();
  return res.json({ ...botConfig, lastPolledAt: botStatus.lastPolledAt, lastError: botStatus.lastError });
});

router.get("/bot/log", (_req: Request, res: Response) => {
  return res.json(botLog);
});

router.delete("/bot/log", requireAdmin, (_req: Request, res: Response) => {
  botLog.splice(0);
  return res.json({ ok: true });
});

// ─── Orderbook ───────────────────────────────────────────────────────────────
router.get("/markets/:conditionId/orderbook", async (req: Request, res: Response) => {
  try {
    const conditionId = String(req.params.conditionId);
    if (!conditionId || !CONDITION_ID_RE.test(conditionId)) {
      return res.status(400).json({ error: "Invalid conditionId" });
    }
    const market = await fetchPolymarket<(PolyMarket & { clobTokenIds?: string })[]>(
      `${GAMMA_API}/markets?conditionId=${encodeURIComponent(String(conditionId))}&limit=1`
    ).then((r) => (Array.isArray(r) ? r[0] : null)).catch(() => null);

    let tokenIds: string[] = [];
    try {
      if (market?.clobTokenIds) tokenIds = JSON.parse(market.clobTokenIds);
    } catch { /* ignore */ }

    if (tokenIds.length === 0) {
      return res.json({ bids: [], asks: [], tokenId: null, lastPrice: null, tickSize: null });
    }

    const tokenId = tokenIds[0];
    const book = await fetchPolymarket<{
      bids: { price: string; size: string }[];
      asks: { price: string; size: string }[];
      last_trade_price: string;
      tick_size: string;
    }>(`${CLOB_API}/book?token_id=${tokenId}`);

    return res.json({
      tokenId,
      lastPrice: parseFloat(book.last_trade_price ?? "0"),
      tickSize: book.tick_size ?? null,
      bids: (book.bids ?? []).slice(0, 20).map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
      asks: (book.asks ?? []).slice(0, 20).map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch orderbook");
    return res.status(500).json({ error: "Failed to fetch orderbook" });
  }
});

// ─── AI rate limiter (in-memory, per-IP, max 1 call per 30s) ─────────────────
const aiRateLimitMap = new Map<string, number>();
function checkAiRateLimit(ip: string): boolean {
  const now = Date.now();
  const last = aiRateLimitMap.get(ip) ?? 0;
  if (now - last < 30_000) return false;
  aiRateLimitMap.set(ip, now);
  // Prune stale entries every 200 calls to avoid unbounded growth
  if (aiRateLimitMap.size > 200) {
    for (const [k, v] of aiRateLimitMap) { if (now - v > 120_000) aiRateLimitMap.delete(k); }
  }
  return true;
}

// ─── AI Signals ──────────────────────────────────────────────────────────────
// Provider selection: prefer OpenAI, fall back to Anthropic
function getAiProvider(): { provider: "anthropic" | "openai"; apiKey: string } | null {
  const openaiKey = process.env["OPENAI_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  if (openaiKey) return { provider: "openai", apiKey: openaiKey };
  if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey };
  return null;
}

async function callAi(
  provider: "anthropic" | "openai",
  apiKey: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  if (provider === "anthropic") {
    // claude-fable-5 has adaptive thinking — thinking tokens count against max_tokens,
    // so we need at least 8192 to leave room for both reasoning and the JSON response.
    const anthropicMaxTokens = Math.max(maxTokens, 8192);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-fable-5", max_tokens: anthropicMaxTokens, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      // If Anthropic returns a credit/quota error, try OpenAI fallback
      if (resp.status === 402 || errText.includes("credit balance")) {
        const openaiKey = process.env["OPENAI_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
        const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
        if (openaiKey) {
          logger.warn("Anthropic credits exhausted — falling back to OpenAI");
          return callAi("openai", openaiKey, prompt, maxTokens);
        }
      }
      throw Object.assign(new Error(errText), { httpStatus: resp.status });
    }
    const data = await resp.json() as { content: { type: string; text: string }[] };
    const raw = data.content?.find((b) => b.type === "text")?.text ?? "{}";
    // claude-fable-5 (and other Claude models with adaptive thinking) wrap JSON in
    // markdown code fences — strip them so JSON.parse doesn't silently fail
    return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  } else {
    const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4.1", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw Object.assign(new Error(errText), { httpStatus: resp.status });
    }
    const data = await resp.json() as { choices: { message: { content: string } }[] };
    return data.choices?.[0]?.message?.content ?? "{}";
  }
}

router.post("/ai/signals", requireAdmin, async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!checkAiRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limited — please wait 30 seconds between AI analyses." });
  }
  const ai = getAiProvider();
  if (!ai) {
    return res.status(503).json({ error: "No AI API key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to secrets." });
  }

  try {
    const { trades, minSize } = req.body as { trades: PolyTrade[]; minSize?: number };
    if (!Array.isArray(trades) || trades.length === 0) {
      return res.status(400).json({ error: "trades array required" });
    }

    // Build a richer per-trade summary (up to 50 trades)
    const top = trades.slice(0, 50);
    const summary = top.map((t) => ({
      wallet: t.proxyWallet?.slice(0, 10) + "…",
      side: t.side,
      outcome: t.outcome ?? "N/A",
      market: t.title,
      usdc: Math.round(t.usdcSize ?? t.size * t.price),
      age_days: t.walletAge ?? null,
      risk: t.riskScore ?? null,
    }));

    // Market-level aggregation for extra context
    const marketMap: Record<string, { buys: number; sells: number; volume: number; wallets: Set<string> }> = {};
    for (const t of top) {
      const key = t.title ?? "Unknown";
      if (!marketMap[key]) marketMap[key] = { buys: 0, sells: 0, volume: 0, wallets: new Set() };
      const usdc = t.usdcSize ?? t.size * t.price;
      if (t.side === "BUY") marketMap[key].buys++;
      else marketMap[key].sells++;
      marketMap[key].volume += usdc;
      if (t.proxyWallet) marketMap[key].wallets.add(t.proxyWallet);
    }
    const markets = Object.entries(marketMap)
      .map(([name, m]) => ({ name, buys: m.buys, sells: m.sells, volume: Math.round(m.volume), unique_wallets: m.wallets.size }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);

    const totalVolume = top.reduce((s, t) => s + (t.usdcSize ?? t.size * t.price), 0);
    const buyVolume   = top.filter(t => t.side === "BUY").reduce((s, t) => s + (t.usdcSize ?? t.size * t.price), 0);
    const uniqueWallets = new Set(top.map(t => t.proxyWallet)).size;

    const sizeLabel = minSize ? `$${(minSize / 1000).toFixed(0)}K+` : "$1K+";
    const dataNote = top.length < 5
      ? `NOTE: Only ${top.length} trades available at this threshold (${sizeLabel}). Provide the most useful insights possible from this limited data, noting the low sample size where relevant.`
      : `Filter threshold: ${sizeLabel} minimum trade size.`;

    const prompt = `You are a senior prediction market quant analyst. Analyze these recent high-value whale trades on Polymarket and deliver deep, actionable intelligence.

TRADE DATA (${top.length} trades, $${Math.round(totalVolume).toLocaleString()} total, ${Math.round(buyVolume / totalVolume * 100)}% buy pressure, ${uniqueWallets} unique wallets):
${JSON.stringify(summary, null, 2)}

MARKET AGGREGATES:
${JSON.stringify(markets, null, 2)}

${dataNote}

Provide ${top.length < 5 ? "2-4" : "6-8"} rich insights covering the most relevant of the following angles:
1. Smart money consensus — which outcomes are whales converging on?
2. Market concentration — which markets are getting the most capital and why?
3. Contrarian signals — any wallets going against the crowd?
4. New wallet activity — are fresh/low-age wallets making outsized bets (insider risk)?
5. Sector patterns — sports vs politics vs crypto vs other categories?
6. Buy/sell imbalance — is there strong directional bias anywhere?
7. Risk-adjusted reads — high-risk-score wallets vs low-risk whales, who's more credible?
8. Actionable takeaway — one concrete thing a trader should do based on this data.

For each insight, also provide:
- "markets": array of 1-3 market names most relevant to the insight (use exact titles from the trade data)
- "action": one of "watch", "consider_long", "consider_short", "avoid", "monitor_wallet"

Respond as a JSON object: { "insights": [ { "title": string, "insight": string, "signal": "bullish"|"bearish"|"neutral", "confidence": "low"|"medium"|"high", "markets": string[], "action": string } ] }`;

    let content: string;
    try {
      content = await callAi(ai.provider, ai.apiKey, prompt, 2000);
    } catch (err: unknown) {
      const e = err as Error & { httpStatus?: number };
      logger.error({ err }, "AI signals error");
      return res.status(e.httpStatus ?? 502).json({ error: "AI request failed", detail: e.message });
    }
    let parsed: { insights?: unknown[] };
    try { parsed = JSON.parse(content); } catch { parsed = { insights: [] }; }

    // Build title→slug map, enriched with Gamma event slugs (which match polymarket.com/event/ URLs)
    const uniqueMarkets = new Map<string, string>(); // title → data-api slug
    for (const t of top) {
      if (t.title && t.slug && !uniqueMarkets.has(t.title)) {
        uniqueMarkets.set(t.title, t.slug);
      }
    }

    const titleToSlug: Record<string, string> = {};
    await Promise.all(
      Array.from(uniqueMarkets.entries()).map(async ([title, dataSlug]) => {
        try {
          const gammaRes = await fetchPolymarket<Array<{ events?: Array<{ slug?: string }> }>>(
            `${GAMMA_API}/markets?slug=${encodeURIComponent(dataSlug)}&limit=1`
          );
          const eventSlug = gammaRes?.[0]?.events?.[0]?.slug;
          titleToSlug[title] = eventSlug ?? dataSlug;
        } catch {
          titleToSlug[title] = dataSlug;
        }
      })
    );

    const insights = (parsed.insights ?? []) as Array<{ title: string; insight: string; signal: string; confidence: string; action?: string; markets?: string[] }>;

    // Email notification: send signal digest if enabled
    if (notifyConfig.signalsEnabled && insights.length > 0) {
      const batchId = `signals-${Math.floor(Date.now() / 60000)}`; // one per minute
      if (!notifiedTxIds.has(batchId)) {
        notifiedTxIds.add(batchId);
        const bullish = insights.filter((i) => i.signal === "bullish").length;
        const bearish = insights.filter((i) => i.signal === "bearish").length;
        const mood = bullish > bearish ? "🟢 Bullish" : bearish > bullish ? "🔴 Bearish" : "⚪ Mixed";
        sendEmail(
          `🧠 AI Signals: ${mood} — ${insights.length} insights on Polymarket whales`,
          signalsEmailHtml(insights),
        ).catch((err) => logger.warn({ err }, "Signals email send failed"));
        logger.info({ count: insights.length }, "AI signals email queued");
      }
    }

    return res.json({ insights, meta: { trades: top.length, totalVolume: Math.round(totalVolume), buyPct: Math.round(buyVolume / totalVolume * 100), uniqueWallets }, titleToSlug });
  } catch (err) {
    logger.error({ err }, "AI signals error");
    return res.status(500).json({ error: "AI signals failed" });
  }
});

// ─── AI: 1-hour crypto market signals ────────────────────────────────────────
router.get("/ai/crypto-signals", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!checkAiRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limited — please wait 30 seconds between AI analyses." });
  }
  const ai = getAiProvider();
  if (!ai) return res.status(503).json({ error: "No AI API key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to secrets." });

  // timeframe param: strictly validated to prevent prompt injection
  const rawTf = (req.query["timeframe"] as string | undefined) ?? "1h";
  const tf: "1h" | "4h" | "1d" = rawTf === "4h" ? "4h" : rawTf === "1d" ? "1d" : "1h";
  // Duration thresholds in seconds for matching Polymarket market windows
  const TF_MIN_SEC = tf === "4h" ? 3 * 3600 : tf === "1d" ? 20 * 3600 : 15 * 60;
  const TF_MAX_SEC = tf === "4h" ? 6 * 3600 : tf === "1d" ? 28 * 3600 : 2 * 3600;
  const TF_LABEL   = tf === "4h" ? "4-hour" : tf === "1d" ? "daily" : "1-hour";

  const COINS = [
    { id: "bitcoin",      symbol: "BTC",  name: "Bitcoin",  searches: ["bitcoin+up+or+down", "btc+up+or+down"]   },
    { id: "ethereum",     symbol: "ETH",  name: "Ethereum", searches: ["ethereum+up+or+down", "eth+up+or+down"]  },
    { id: "solana",       symbol: "SOL",  name: "Solana",   searches: ["solana+up+or+down", "sol+up+or+down"]    },
    { id: "ripple",       symbol: "XRP",  name: "XRP",      searches: ["xrp+up+or+down", "ripple+up+or+down"]    },
    { id: "dogecoin",     symbol: "DOGE", name: "Dogecoin", searches: ["doge+up+or+down", "dogecoin+up+or+down"] },
    { id: "binancecoin",  symbol: "BNB",  name: "BNB",      searches: ["bnb+up+or+down", "binance+up+or+down"]   },
  ];

  // ── 1. CoinGecko /coins/markets — gives 1h + 24h + 7d price changes ────────
  const coinIds = COINS.map((c) => c.id).join(",");
  type CgMarket = {
    id: string;
    current_price: number;
    price_change_percentage_1h_in_currency: number | null;
    price_change_percentage_24h_in_currency: number | null;
    price_change_percentage_7d_in_currency: number | null;
    total_volume: number;
    market_cap: number;
  };

  // ── 2. Fear & Greed index (alternative.me — free, no auth) ─────────────────
  type FngData = { data: { value: string; value_classification: string }[] };

  // ── 3. Per-coin Polymarket search (parallel) — one request per coin ─────────
  type GammaMarket = Record<string, unknown>;

  const [cgResp, fngResp, ...gammaResults] = await Promise.allSettled([
    fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds}&price_change_percentage=1h%2C24h%2C7d&order=market_cap_desc&per_page=10&sparkline=false`,
      { signal: AbortSignal.timeout(10000) }
    ),
    fetch(
      "https://api.alternative.me/fng/?limit=1",
      { signal: AbortSignal.timeout(5000) }
    ),
    // one search per coin — match by coin name + "up or down"
    ...COINS.map((coin) =>
      fetch(
        `${GAMMA_API}/markets?active=true&closed=false&limit=20&search=${coin.searches[0]}`,
        { signal: AbortSignal.timeout(8000) }
      )
    ),
  ]);

  const cgMarkets: CgMarket[] = await (async () => {
    if (cgResp.status !== "fulfilled") return [];
    // 429 = CoinGecko rate limit — return empty rather than throw
    if (cgResp.value.status === 429) {
      logger.warn("CoinGecko rate-limited (429) — prices unavailable");
      return [];
    }
    if (!cgResp.value.ok) return [];
    try { return await cgResp.value.json() as CgMarket[]; } catch { return []; }
  })();

  const fng: { value: number; label: string } | null = await (async () => {
    try {
      if (fngResp.status !== "fulfilled" || !fngResp.value.ok) return null;
      const d = await fngResp.value.json() as FngData;
      const entry = d.data?.[0];
      if (!entry) return null;
      const value = parseInt(entry.value, 10);
      // Validate: parseInt returns NaN for non-numeric strings; clamp to [0,100]
      if (!Number.isFinite(value)) return null;
      return { value: Math.max(0, Math.min(100, value)), label: entry.value_classification };
    } catch { return null; }
  })();

  // Parse all per-coin Gamma results
  const coinGammaMarkets: GammaMarket[][] = await Promise.all(
    gammaResults.map(async (r) => {
      if (r.status !== "fulfilled" || !r.value.ok) return [];
      try { return await r.value.json() as GammaMarket[]; } catch { return []; }
    })
  );

  // Helper to extract UP/DOWN probs from a Gamma market
  function extractOdds(market: GammaMarket): { upProb: number | null; downProb: number | null } {
    try {
      const raw = market["outcomePrices"];
      const outcomes = market["outcomes"];
      // Both fields may arrive as a JSON string or a real array — handle both safely
      const opArr: string[] = Array.isArray(raw) ? raw as string[]
        : (typeof raw === "string" ? JSON.parse(raw) as string[] : []);
      const outArr: string[] = Array.isArray(outcomes) ? outcomes as string[]
        : (typeof outcomes === "string" ? JSON.parse(outcomes) as string[] : []);
      const upIdx   = outArr.findIndex((o) => String(o).toLowerCase() === "up");
      const downIdx = outArr.findIndex((o) => String(o).toLowerCase() === "down");
      const toProb = (raw: string | undefined): number | null => {
        if (!raw) return null;
        const v = parseFloat(raw);
        // Clamp to [0,1] — Polymarket uses 0-1 scale; guard against malformed data
        return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
      };
      return {
        upProb:   upIdx   >= 0 ? toProb(opArr[upIdx])   : null,
        downProb: downIdx >= 0 ? toProb(opArr[downIdx]) : null,
      };
    } catch {
      return { upProb: null, downProb: null };
    }
  }

  // Safe date-string → unix seconds (guards NaN from invalid ISO strings)
  function toUnixSec(raw: unknown): number | null {
    if (!raw) return null;
    const ms = new Date(String(raw)).getTime();
    return Number.isFinite(ms) ? ms / 1000 : null;
  }

  // Pick the best-matching Polymarket market for a coin + timeframe
  function pickMarket(markets: GammaMarket[], coin: typeof COINS[0]): GammaMarket | null {
    const now = Date.now() / 1000;
    // Filter: question must contain coin name or symbol + "up or down"
    const relevant = markets.filter((m) => {
      const q = String(m["question"] ?? "").toLowerCase();
      return (q.includes(coin.symbol.toLowerCase()) || q.includes(coin.name.toLowerCase())) &&
             q.includes("up or down");
    });

    // Among relevant, score by: (a) duration matches timeframe, (b) market closes soonest in future
    const scored = relevant
      .map((m) => {
        const endTs   = toUnixSec(m["endDateIso"]   ?? m["endDate"]);
        const startTs = toUnixSec(m["startDateIso"] ?? m["startDate"]);
        const duration = (endTs !== null && startTs !== null) ? endTs - startTs : null;
        const durationOk = duration !== null
          ? duration >= TF_MIN_SEC && duration <= TF_MAX_SEC
          : true; // unknown duration — keep it
        // Only include markets that are still open (or have no known close time)
        const closesInFuture = endTs !== null ? endTs > now : true;
        return { m, endTs, durationOk, closesInFuture };
      })
      .filter((x) => x.closesInFuture)
      .sort((a, b) => {
        // prefer duration-matched markets first
        if (a.durationOk !== b.durationOk) return a.durationOk ? -1 : 1;
        // then soonest-closing (null endTs sorts last)
        const aEnd = a.endTs ?? Infinity;
        const bEnd = b.endTs ?? Infinity;
        return aEnd - bEnd;
      });

    return scored[0]?.m ?? relevant[0] ?? null;
  }

  // Assemble per-coin data
  const coinData = COINS.map((coin, i) => {
    const cg = cgMarkets.find((m) => m.id === coin.id) ?? null;
    const gammaMarketList = coinGammaMarkets[i] ?? [];
    const market = pickMarket(gammaMarketList, coin);

    let upProb: number | null = null;
    let downProb: number | null = null;
    let marketTitle: string | null = null;
    let marketSlug: string | null = null;
    let marketCloses: string | null = null;

    if (market) {
      const odds = extractOdds(market);
      upProb       = odds.upProb;
      downProb     = odds.downProb;
      marketTitle  = String(market["question"] ?? "");
      // Use the parent *event* slug (market.events[0].slug) — that is what
      // polymarket.com/event/ URLs use.  market["slug"] is the market-level slug
      // and produces 404s on the Polymarket website.
      const eventsArr = Array.isArray(market["events"]) ? market["events"] as Array<Record<string, unknown>> : [];
      marketSlug   = String(eventsArr[0]?.["slug"] ?? market["slug"] ?? "");
      const endIso = market["endDateIso"] ?? market["endDate"];
      if (endIso) marketCloses = new Date(String(endIso)).toISOString();
    }

    return {
      symbol:      coin.symbol,
      name:        coin.name,
      price:       cg?.current_price ?? null,
      change1h:    cg?.price_change_percentage_1h_in_currency ?? null,
      change24h:   cg?.price_change_percentage_24h_in_currency ?? null,
      change7d:    cg?.price_change_percentage_7d_in_currency ?? null,
      volume24h:   cg?.total_volume ?? null,
      marketCap:   cg?.market_cap ?? null,
      upProb,
      downProb,
      marketTitle,
      marketSlug,
      marketCloses,
    };
  });

  const fngLine = fng
    ? `\nFear & Greed Index: ${fng.value}/100 (${fng.label}) — overall crypto market sentiment\n`
    : "";

  // Timeframe-specific analysis rules fed into the prompt
  const TF_PRIMARY =
    tf === "1d"
      ? "PRIMARY signal: 24h change (most representative of today's trend). SECONDARY: 7d change (broader trend). CONTEXT: 1h change (last-hour momentum confirmation or reversal)."
      : tf === "4h"
      ? "PRIMARY signal: 1h change (most recent directional momentum). SECONDARY: 24h change (intraday trend alignment). CONTEXT: 7d change (ignore unless extreme ±15%)."
      : /* 1h */
        "PRIMARY signal: 1h change (directly maps to this window). SECONDARY: 24h change (confirms or contradicts). CONTEXT: 7d change (trend backdrop only).";

  const TF_CONFIDENCE =
    tf === "1d"
      ? "\"high\": 24h and 7d both aligned, Fear & Greed non-neutral, Polymarket odds confirm mispricing. \"medium\": 24h and 7d agree but no odds or conflicting 1h. \"low\": 24h/7d conflict or flat."
      : tf === "4h"
      ? "\"high\": 1h and 24h both aligned, volume above average, Polymarket odds confirm mispricing. \"medium\": 1h and 24h agree but no odds. \"low\": 1h contradicts 24h."
      : /* 1h */
        "\"high\": 1h and 24h align, volume confirms, Polymarket odds confirm mispricing. \"medium\": 1h and 24h agree but no odds. \"low\": 1h contradicts 24h or both near 0%.";

  const TF_EDGE_EXAMPLE =
    tf === "1d"
      ? "e.g. 'BTC 24h +3.2% and 7d +8.1% bullish confluence but UP only 44% — underpriced'"
      : tf === "4h"
      ? "e.g. 'SOL 1h +0.8% accelerating into 24h +2.1% trend, UP 46% underprices 4h continuation'"
      : "e.g. 'ETH 1h -0.6% on rising volume but DOWN only 40% — mispriced vs momentum'";

  const prompt = `You are a precision crypto quant analyst specializing in Polymarket prediction market edges. Analyze these LIVE ${TF_LABEL} "Up or Down" markets.
${fngLine}
LIVE DATA — timestamp: ${new Date().toUTCString()}
${coinData.map((c) => `
${c.symbol} (${c.name}):
  Price:          $${c.price != null ? c.price.toLocaleString("en-US", { maximumFractionDigits: 5 }) : "N/A"}
  1h change:      ${c.change1h != null ? (c.change1h >= 0 ? "+" : "") + c.change1h.toFixed(3) + "%" : "N/A"}
  24h change:     ${c.change24h != null ? (c.change24h >= 0 ? "+" : "") + c.change24h.toFixed(2) + "%" : "N/A"}
  7d change:      ${c.change7d != null ? (c.change7d >= 0 ? "+" : "") + c.change7d.toFixed(2) + "%" : "N/A"}
  24h volume:     ${c.volume24h ? "$" + (c.volume24h / 1e9).toFixed(3) + "B" : "N/A"}
  Market cap:     ${c.marketCap ? "$" + (c.marketCap / 1e9).toFixed(1) + "B" : "N/A"}
  Polymarket UP:  ${c.upProb != null ? (c.upProb * 100).toFixed(1) + "% — closes " + (c.marketCloses ?? "soon") : "NO POLYMARKET MARKET FOUND"}
  Polymarket DOWN:${c.downProb != null ? (c.downProb * 100).toFixed(1) + "%" : "N/A"}`).join("\n")}

SIGNAL HIERARCHY FOR ${TF_LABEL.toUpperCase()} TIMEFRAME:
${TF_PRIMARY}

EDGE DETECTION:
- If Polymarket odds exist: compare the implied probability to what the data suggests.
  Fair value for continuation: if primary signal > +0.5%, fair UP probability ≈ 55–65%.
  A mispricing is when market odds deviate >8% from that fair value. Specify the gap.
  ${TF_EDGE_EXAMPLE}
- If NO Polymarket market: state "Technical signal only — no Polymarket odds to compare."
  Still commit to a direction based on data.

CONFIDENCE RULES:
${TF_CONFIDENCE}

MANDATORY:
- Always produce UP or DOWN. Never hedge or say "unclear."
- Use exact % figures from the data. No vague phrases like "mild decline" without a number.
- Do not copy the summary into coin reasoning.

Respond strictly as JSON (no markdown, no code block):
{
  "summary": "2-3 sentences: dominant ${TF_LABEL} trend across the 6 coins, Fear & Greed context, and overall bias",
  "signals": [
    {
      "symbol": "BTC",
      "direction": "UP" | "DOWN",
      "confidence": "low" | "medium" | "high",
      "reasoning": "2-3 sentences with specific % numbers referencing the primary and secondary signals",
      "edge": "1 sentence: Polymarket mispricing gap (with numbers) OR 'Technical signal only — no Polymarket odds'",
      "outcome": "UP" | "DOWN"
    }
  ]
}`;

  try {
    let content: string;
    try {
      content = await callAi(ai.provider, ai.apiKey, prompt, 2500);
    } catch (err: unknown) {
      const e = err as Error & { httpStatus?: number };
      logger.error({ err }, "Anthropic crypto-signals error");
      return res.status(e.httpStatus ?? 502).json({ error: "AI request failed", detail: e.message });
    }
    let analysis: { summary?: string; signals?: unknown[] } = {};
    try { analysis = JSON.parse(content); } catch { /* ignore */ }

    return res.json({ coins: coinData, analysis, fearGreed: fng, generatedAt: Date.now() });
  } catch (err) {
    logger.error({ err }, "Crypto signals error");
    return res.status(500).json({ error: "Crypto signals failed" });
  }
});

// ─── Existing routes ──────────────────────────────────────────────────────────

router.get("/whales", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
    const minSize = parseFloat(String(req.query.minSize ?? "1000"));

    // Fetch up to 1000 recent trades across two pages to surface more whale-sized entries
    const [page1, page2] = await Promise.allSettled([
      fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=500`),
      fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=500&offset=500`),
    ]);
    const combined: PolyTrade[] = [
      ...(page1.status === "fulfilled" && Array.isArray(page1.value) ? page1.value : []),
      ...(page2.status === "fulfilled" && Array.isArray(page2.value) ? page2.value : []),
    ];
    if (combined.length === 0) return res.json([]);
    const seen = new Set<string>();
    const raw = combined.filter(t => {
      const key = t.transactionHash ?? `${t.proxyWallet}-${t.timestamp}-${t.asset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const enriched = raw
      .map((t) => ({ ...t, usdcSize: t.usdcSize ?? t.size * t.price }))
      .filter((t) => t.usdcSize >= minSize)
      .sort((a, b) => b.usdcSize - a.usdcSize);

    const walletAgeCache = new Map<string, number | null>();
    const walletMetaCache = new Map<string, { count: number; totalUsdc: number }>();

    const topSlice = enriched.slice(0, 25);
    const uniqueWallets = [...new Set(topSlice.map((t) => t.proxyWallet))];
    // Data API trade payloads almost always carry name/pseudonym, but they rarely carry
    // profileImage/verifiedBadge — those only come from the gamma public-profile endpoint.
    // So look up profiles for any wallet still missing an avatar, not just fully-unnamed ones.
    const walletsNeedingProfile = uniqueWallets.filter((wallet) => {
      const t = topSlice.find((x) => x.proxyWallet === wallet);
      return !t?.profileImage || (!t?.name && !t?.pseudonym);
    });

    const [, profileMap] = await Promise.all([
      Promise.allSettled(
        uniqueWallets.map(async (wallet) => {
          try {
            const trades = await fetchPolymarket<PolyTrade[]>(
              `${DATA_API}/trades?user=${wallet}&limit=200`
            );
            if (!Array.isArray(trades) || trades.length === 0) {
              walletAgeCache.set(wallet, null);
              return;
            }
            const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
            const ageDays = (Date.now() / 1000 - sorted[0].timestamp) / 86400;
            walletAgeCache.set(wallet, Math.round(ageDays * 10) / 10);
            const totalUsdc = trades.reduce((s, t) => s + (t.usdcSize ?? t.size * t.price), 0);
            walletMetaCache.set(wallet, { count: trades.length, totalUsdc });
          } catch {
            walletAgeCache.set(wallet, null);
          }
        })
      ),
      getPublicProfilesBatch(walletsNeedingProfile),
    ]);

    const result = enriched.slice(0, limit).map((trade) => {
      const ageDays = walletAgeCache.get(trade.proxyWallet) ?? null;
      const meta = walletMetaCache.get(trade.proxyWallet);
      const avgSize = meta ? meta.totalUsdc / meta.count : trade.usdcSize;
      const count = meta?.count ?? 1;
      const { score } = computeRisk(ageDays ?? 365, count, avgSize);
      const profile = profileMap.get(trade.proxyWallet.toLowerCase()) ?? null;
      return tradeToResponse(trade, score, ageDays, profile);
    });

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch whale trades");
    return res.status(500).json({ error: "Failed to fetch whale trades" });
  }
});

router.get("/whales/stats", async (req, res) => {
  try {
    const raw = await fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=500`);
    if (!Array.isArray(raw)) {
      return res.json({
        totalVolumeUsdc: 0,
        tradeCount: 0,
        uniqueWallets: 0,
        topMarkets: [],
        topWallets: [],
      });
    }

    const MIN = 1000;
    const whales = raw
      .map((t) => ({ ...t, usdcSize: t.usdcSize ?? t.size * t.price }))
      .filter((t) => t.usdcSize >= MIN);

    const totalVolumeUsdc = whales.reduce((s, t) => s + t.usdcSize, 0);
    const uniqueWallets = new Set(whales.map((t) => t.proxyWallet)).size;

    const mktMap = new Map<string, { title: string; icon: string | null; volumeUsdc: number; tradeCount: number }>();
    const walMap = new Map<string, { name: string | null; pseudonym: string | null; profileImage: string | null; volumeUsdc: number; tradeCount: number }>();

    for (const t of whales) {
      const k = t.conditionId ?? t.title;
      const m = mktMap.get(k) ?? { title: t.title, icon: t.icon ?? null, volumeUsdc: 0, tradeCount: 0 };
      m.volumeUsdc += t.usdcSize;
      m.tradeCount += 1;
      mktMap.set(k, m);

      const w = walMap.get(t.proxyWallet) ?? { name: t.name ?? null, pseudonym: t.pseudonym ?? null, profileImage: t.profileImage ?? null, volumeUsdc: 0, tradeCount: 0 };
      w.volumeUsdc += t.usdcSize;
      w.tradeCount += 1;
      walMap.set(t.proxyWallet, w);
    }

    const topMarkets = [...mktMap.entries()]
      .sort(([, a], [, b]) => b.volumeUsdc - a.volumeUsdc)
      .slice(0, 5)
      .map(([conditionId, v]) => ({ conditionId, ...v }));

    const topWalletEntries = [...walMap.entries()]
      .sort(([, a], [, b]) => b.volumeUsdc - a.volumeUsdc)
      .slice(0, 5);

    // Top wallets list is capped at 5, so a per-wallet profile lookup here is cheap.
    // Look up profiles for wallets missing an avatar too — trade payloads rarely carry profileImage.
    const topWalletsNeedingProfile = topWalletEntries
      .filter(([, v]) => !v.profileImage || (!v.name && !v.pseudonym))
      .map(([address]) => address);
    const topWalletProfiles = await getPublicProfilesBatch(topWalletsNeedingProfile);

    const topWallets = topWalletEntries.map(([address, v]) => {
      const avg = v.tradeCount > 0 ? v.volumeUsdc / v.tradeCount : 0;
      const { score } = computeRisk(365, v.tradeCount, avg);
      const profile = topWalletProfiles.get(address.toLowerCase()) ?? null;
      return {
        address,
        name: v.name ?? profile?.name ?? null,
        pseudonym: v.pseudonym ?? profile?.pseudonym ?? null,
        profileImage: v.profileImage ?? profile?.profileImage ?? null,
        volumeUsdc: v.volumeUsdc,
        tradeCount: v.tradeCount,
        riskScore: score,
        walletAgeDays: null as number | null,
      };
    });

    return res.json({ totalVolumeUsdc, tradeCount: whales.length, uniqueWallets, topMarkets, topWallets });
  } catch (err) {
    logger.error({ err }, "Failed to fetch whale stats");
    return res.status(500).json({ error: "Failed to fetch whale stats" });
  }
});

router.get("/markets", async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search) : null;
    const tag = req.query.tag ? String(req.query.tag) : null;

    const baseMarketUrl = `${GAMMA_API}/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false`;
    const marketSuffix = (search ? `&search=${encodeURIComponent(search)}` : "") +
                         (tag ? `&tag=${encodeURIComponent(tag)}` : "");

    const MARKET_PAGES = 10;
    const TRADE_PAGES = 3;
    const marketPageFetches = Array.from({ length: MARKET_PAGES }, (_, i) =>
      fetchPolymarket<PolyMarket[]>(`${baseMarketUrl}&offset=${i * 100}${marketSuffix}`)
        .catch(() => [] as PolyMarket[])
    );
    const tradePageFetches = Array.from({ length: TRADE_PAGES }, (_, i) =>
      fetchPolymarket<PolyTrade[]>(`${DATA_API}/trades?limit=500&offset=${i * 500}`)
        .catch(() => [] as PolyTrade[])
    );

    const [marketPages, tradePages] = await Promise.all([
      Promise.all(marketPageFetches),
      Promise.all(tradePageFetches),
    ]);

    const marketMap = new Map<string, PolyMarket>();
    for (const page of marketPages) {
      if (!Array.isArray(page)) continue;
      for (const m of page) {
        if (!m.conditionId) continue;
        const existing = marketMap.get(m.conditionId);
        if (!existing || (m.volume24hr ?? 0) > (existing.volume24hr ?? 0)) {
          marketMap.set(m.conditionId, m);
        }
      }
    }
    if (marketMap.size === 0) return res.json([]);

    const sortedMarkets = [...marketMap.values()].sort(
      (a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0)
    );

    const classifyMarket = (q: string): string => {
      const s = q.toLowerCase();
      if (/presiden|election|vote|congress|senate|prime minister|chancellor|parliament|democrat|republican|trump|biden|kamala|political|governor|mayor|referendum/.test(s)) return "Politics";
      if (/bitcoin|ethereum|crypto|\bbtc\b|\beth\b|\bsol\b|\bxrp\b|\bdoge\b|coin|defi|blockchain|token|\bnft\b/.test(s)) return "Crypto";
      if (/world cup|nfl|nba|nhl|mlb|soccer|football|basketball|tennis|golf|\bf1\b|formula|ufc|fight|match|championship|league|playoff|super bowl|olympic|fifa|winner|sport|game|team|player|tournament|baseball|hockey|dota|esport/.test(s)) return "Sports";
      return "Other";
    };

    const TOP_PER_CATEGORY = 15;
    const categoryBuckets = new Map<string, PolyMarket[]>();
    for (const m of sortedMarkets) {
      const cat = classifyMarket(m.question ?? "");
      const bucket = categoryBuckets.get(cat) ?? [];
      if (bucket.length < TOP_PER_CATEGORY) bucket.push(m);
      categoryBuckets.set(cat, bucket);
    }
    const marketsToEnrich = [...new Set([...categoryBuckets.values()].flat())];

    const perMarketTrades = await Promise.all(
      marketsToEnrich.map((m) =>
        fetchPolymarket<PolyTrade[]>(
          `${DATA_API}/trades?conditionId=${encodeURIComponent(m.conditionId)}&limit=200`
        ).catch(() => [] as PolyTrade[])
      )
    );

    const seenTx = new Set<string>();
    const allTrades: Array<PolyTrade & { _marketConditionId?: string }> = [];
    const addTrades = (page: PolyTrade[], overrideConditionId?: string) => {
      if (!Array.isArray(page)) return;
      for (const t of page) {
        const key = t.transactionHash ?? `${t.proxyWallet}:${t.timestamp}:${t.asset}`;
        if (seenTx.has(key)) continue;
        seenTx.add(key);
        allTrades.push(overrideConditionId ? { ...t, _marketConditionId: overrideConditionId } : t);
      }
    };
    for (const page of tradePages) addTrades(page as PolyTrade[]);
    for (let i = 0; i < perMarketTrades.length; i++) {
      addTrades(perMarketTrades[i], marketsToEnrich[i].conditionId);
    }

    interface ActivityStats { buyVolume: number; sellVolume: number; }
    interface WhaleStats {
      whaleCount: number;
      whaleVolume: number;
      outcomeBuy: Record<string, number>;
      wallets: Map<string, { volume: number; name: string | null; pseudonym: string | null; walletAgeDays: number | null; riskScore: number | null }>;
    }

    const activityMap = new Map<string, ActivityStats>();
    const whaleMap = new Map<string, WhaleStats>();
    const MIN_ACTIVITY = 100;
    const MIN_WHALE = 1000;

    for (const t of allTrades) {
      const cid = t._marketConditionId ?? t.conditionId;
      if (!cid) continue;
      const usdc = t.usdcSize ?? t.size * t.price;

      if (usdc >= MIN_ACTIVITY) {
        const act = activityMap.get(cid) ?? { buyVolume: 0, sellVolume: 0 };
        if (t.side === "BUY") act.buyVolume += usdc; else act.sellVolume += usdc;
        activityMap.set(cid, act);
      }

      if (usdc >= MIN_WHALE) {
        const entry = whaleMap.get(cid) ?? {
          whaleCount: 0, whaleVolume: 0, outcomeBuy: {} as Record<string, number>, wallets: new Map(),
        };
        entry.whaleCount += 1;
        entry.whaleVolume += usdc;
        if (t.side === "BUY") {
          const oc = t.outcome ?? "Yes";
          entry.outcomeBuy[oc] = (entry.outcomeBuy[oc] ?? 0) + usdc;
        }
        const w = entry.wallets.get(t.proxyWallet) ?? {
          volume: 0, name: t.name ?? null, pseudonym: t.pseudonym ?? null,
          walletAgeDays: (t as PolyTrade & { walletAgeDays?: number }).walletAgeDays ?? null,
          riskScore: (t as PolyTrade & { riskScore?: number }).riskScore ?? null,
        };
        w.volume += usdc;
        entry.wallets.set(t.proxyWallet, w);
        whaleMap.set(cid, entry);
      }
    }

    const result = sortedMarkets.map((m) => {
      const whale = whaleMap.get(m.conditionId);
      const activity = activityMap.get(m.conditionId);
      let topOutcome: string | null = null;
      let topOutcomeBuyVolume: number | null = null;
      if (whale && Object.keys(whale.outcomeBuy).length > 0) {
        const sorted = Object.entries(whale.outcomeBuy).sort((a, b) => b[1] - a[1]);
        topOutcome = sorted[0][0];
        topOutcomeBuyVolume = sorted[0][1];
      }
      let topWallet: string | null = null;
      let topWalletName: string | null = null;
      let topWalletVolume: number | null = null;
      let topWalletAgeDays: number | null = null;
      let topWalletRiskScore: number | null = null;
      if (whale && whale.wallets.size > 0) {
        const sorted = [...whale.wallets.entries()].sort((a, b) => b[1].volume - a[1].volume);
        const [addr, info] = sorted[0];
        topWallet = addr;
        topWalletName = info.name ?? info.pseudonym ?? null;
        topWalletVolume = info.volume;
        topWalletAgeDays = info.walletAgeDays;
        topWalletRiskScore = info.riskScore;
      }
      return {
        ...m,
        volume24hr: m.volume24hr ?? null,
        volume1wk: m.volume1wk ?? null,
        volumeNum: m.volumeNum ?? null,
        outcomePrices: m.outcomePrices ?? null,
        outcomes: m.outcomes ?? null,
        clobTokenIds: m.clobTokenIds ?? null,
        whaleCount: whale?.whaleCount ?? 0,
        whaleVolume: whale?.whaleVolume ?? 0,
        buyVolume: activity?.buyVolume ?? 0,
        sellVolume: activity?.sellVolume ?? 0,
        topOutcome,
        topOutcomeBuyVolume,
        topWallet,
        topWalletName,
        topWalletVolume,
        topWalletAgeDays,
        topWalletRiskScore,
      };
    });

    result.sort((a, b) => b.whaleVolume - a.whaleVolume || (b.volume24hr ?? 0) - (a.volume24hr ?? 0));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch markets");
    return res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// ─── Markets: momentum (whale volume velocity) ────────────────────────────────
// Fetches the last `hours` hours of whale trades, splits them into two equal
// windows, and ranks markets by velocity (recent window / prior window volume).
// No CLOB price-history needed — derived entirely from existing trade data.
router.get("/markets/momentum", async (req: Request, res: Response) => {
  try {
    const minSize = parseFloat(String(req.query.minSize ?? "1000")) || 1000;
    const hours   = Math.min(Math.max(parseInt(String(req.query.hours  ?? "4"), 10) || 4, 2), 24);
    const now     = Math.floor(Date.now() / 1000);
    const windowStart = now - hours * 3600; // oldest trade we care about
    const midPoint    = now - (hours / 2) * 3600; // boundary between recent and prior

    // Fetch enough pages to cover the time window — each page is 500 trades.
    // The Data API returns newest-first, so we stop fetching once timestamps go older than windowStart.
    const PAGE_SIZE = 500;
    let trades: PolyTrade[] = [];
    for (let offset = 0; offset < 3000; offset += PAGE_SIZE) {
      const page = await fetchPolymarket<PolyTrade[]>(
        `${DATA_API}/trades?limit=${PAGE_SIZE}&offset=${offset}`
      ).catch(() => [] as PolyTrade[]);
      if (!Array.isArray(page) || page.length === 0) break;
      const relevant = page.filter(
        (t) => t.timestamp >= windowStart && (t.usdcSize ?? t.size * t.price) >= minSize
      );
      trades = trades.concat(relevant);
      // All remaining trades are older than our window — stop paginating
      if (page[page.length - 1].timestamp < windowStart) break;
    }

    // Group trades by conditionId
    type MktAcc = {
      conditionId: string; title: string; slug?: string; icon?: string;
      recent: PolyTrade[]; prior: PolyTrade[];
    };
    const byMarket = new Map<string, MktAcc>();
    for (const t of trades) {
      const key = t.conditionId ?? t.title;
      if (!key) continue;
      if (!byMarket.has(key)) {
        byMarket.set(key, {
          conditionId: t.conditionId ?? key,
          title: t.title,
          slug: t.slug,
          icon: t.icon,
          recent: [],
          prior: [],
        });
      }
      const acc = byMarket.get(key)!;
      if (t.timestamp >= midPoint) acc.recent.push(t);
      else acc.prior.push(t);
    }

    const results = [...byMarket.values()]
      .filter((m) => m.recent.length > 0 || m.prior.length > 0)
      .map((m) => {
        const allTrades = [...m.recent, ...m.prior];
        const usdcOf = (t: PolyTrade) => t.usdcSize ?? (t.size * t.price);
        const vol2h     = m.recent.reduce((s, t) => s + usdcOf(t), 0);
        const volPrev2h = m.prior.reduce((s,  t) => s + usdcOf(t), 0);
        const totalVol  = vol2h + volPrev2h;
        // velocity: ratio of recent to prior; cap at 10× to avoid inf on new surges
        const velocity  = volPrev2h > 0 ? Math.min(vol2h / volPrev2h, 10) : (vol2h > 0 ? 5 : 0);
        const buyVol    = allTrades.filter((t) => t.side === "BUY").reduce((s, t) => s + usdcOf(t), 0);
        const buyPressure = totalVol > 0 ? buyVol / totalVol : 0.5;
        const wallets   = new Set(allTrades.map((t) => t.proxyWallet));
        const avgSize   = allTrades.length > 0 ? totalVol / allTrades.length : 0;
        const topSide   = buyVol >= totalVol - buyVol ? "BUY" : "SELL";
        return {
          conditionId:  m.conditionId,
          title:        m.title,
          slug:         m.slug ?? null,
          icon:         m.icon ?? null,
          tradeCount:   allTrades.length,
          totalVolume:  totalVol,
          volume2h:     vol2h,
          volumePrev2h: volPrev2h,
          velocity,
          buyPressure,
          walletCount:  wallets.size,
          avgSize,
          topSide,
        };
      })
      // Sort: velocity * log(volume) gives balanced "hot but big" ranking
      .sort((a, b) => (b.velocity * Math.log1p(b.totalVolume)) - (a.velocity * Math.log1p(a.totalVolume)))
      .slice(0, 15);

    return res.json(results);
  } catch (err) {
    logger.error({ err }, "momentum route error");
    return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

router.get("/markets/:conditionId/whales", async (req, res) => {
  try {
    const { conditionId } = req.params;
    if (!conditionId || !CONDITION_ID_RE.test(conditionId)) {
      return res.status(400).json({ error: "Invalid conditionId" });
    }
    const raw = await fetchPolymarket<PolyTrade[]>(
      `${DATA_API}/trades?conditionId=${encodeURIComponent(conditionId)}&limit=200`
    );
    if (!Array.isArray(raw)) return res.json([]);

    const result = raw
      .map((t) => ({ ...t, usdcSize: t.usdcSize ?? t.size * t.price }))
      .filter((t) => t.conditionId === conditionId && t.usdcSize >= 500)
      .sort((a, b) => b.usdcSize - a.usdcSize)
      .slice(0, 20)
      .map((t) => tradeToResponse(t, null, null));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch market whales");
    return res.status(500).json({ error: "Failed to fetch market whales" });
  }
});

router.get("/wallets/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!EVM_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const [actRes, posRes] = await Promise.allSettled([
      getActivityForWallet(address, 500),
      fetchPolymarket<PolyPosition[]>(`${DATA_API}/positions?user=${address}&limit=100`),
    ]);

    const trades = actRes.status === "fulfilled" ? actRes.value : [];
    const rawPositions = posRes.status === "fulfilled" ? posRes.value : [];
    const positions = Array.isArray(rawPositions) ? rawPositions : [];

    if (trades.length === 0 && positions.length === 0) {
      return res.status(404).json({ error: "Wallet not found or has no activity" });
    }

    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    const firstTradeAt = sorted[0]?.timestamp ?? Math.floor(Date.now() / 1000);
    const lastTradeAt = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : null;
    const walletAgeDays = (Date.now() / 1000 - firstTradeAt) / 86400;

    const totalVolumeUsdc = trades.reduce((s, t) => s + (t.usdcSize ?? 0), 0);
    const avgTradeSize = trades.length > 0 ? totalVolumeUsdc / trades.length : 0;

    let positivePnl = 0;
    let closedCount = 0;
    for (const p of positions) {
      if (p.cashPnl !== undefined) {
        closedCount++;
        if (p.cashPnl > 0) positivePnl++;
      }
    }
    const winRate = closedCount > 0 ? (positivePnl / closedCount) * 100 : null;
    const firstTrade = sorted[0] as PolyTrade | undefined;

    const { score, label, factors } = computeRisk(walletAgeDays, trades.length, avgTradeSize);

    // Trade payloads usually carry name/pseudonym but rarely carry profileImage/verifiedBadge —
    // fall back to Polymarket's public-profile lookup (cached) whenever an avatar is missing.
    const profile = !firstTrade?.profileImage ? await getPublicProfile(address) : null;

    return res.json({
      address,
      name: firstTrade?.name ?? profile?.name ?? null,
      pseudonym: firstTrade?.pseudonym ?? profile?.pseudonym ?? null,
      totalVolumeUsdc,
      tradeCount: trades.length,
      walletAgeDays: Math.round(walletAgeDays * 10) / 10,
      firstTradeAt,
      lastTradeAt,
      avgTradeSize,
      riskScore: score,
      riskLabel: label,
      riskFactors: factors,
      winRate,
      profileImage: firstTrade?.profileImage ?? profile?.profileImage ?? null,
      verifiedBadge: profile?.verifiedBadge ?? false,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch wallet profile");
    return res.status(500).json({ error: "Failed to fetch wallet profile" });
  }
});

router.get("/wallets/:address/trades", async (req, res) => {
  try {
    const { address } = req.params;
    if (!EVM_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const trades = await getActivityForWallet(address, 500);

    const result = trades
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((t) => tradeToResponse({ ...t, usdcSize: t.usdcSize ?? 0 }, null, null));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch wallet trades");
    return res.status(500).json({ error: "Failed to fetch wallet trades" });
  }
});

router.get("/wallets/:address/positions", async (req, res) => {
  try {
    const { address } = req.params;
    if (!EVM_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const raw = await fetchPolymarket<PolyPosition[]>(
      `${DATA_API}/positions?user=${address}&limit=100`
    );
    if (!Array.isArray(raw)) return res.json([]);

    const result = raw.map((p) => ({
      proxyWallet: p.proxyWallet,
      asset: p.asset,
      conditionId: p.conditionId,
      size: p.size,
      avgPrice: p.avgPrice,
      initialValue: p.initialValue ?? null,
      currentValue: p.currentValue,
      cashPnl: p.cashPnl ?? null,
      percentPnl: p.percentPnl ?? null,
      curPrice: p.curPrice ?? null,
      title: p.title,
      slug: p.slug ?? null,
      icon: p.icon ?? null,
      outcome: p.outcome,
      endDate: p.endDate ?? null,
      redeemable: p.redeemable ?? null,
    }));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch wallet positions");
    return res.status(500).json({ error: "Failed to fetch wallet positions" });
  }
});

// ─── clobDelete helper ────────────────────────────────────────────────────────
async function clobDelete<T>(path: string): Promise<T> {
  const bodyStr = JSON.stringify({});
  const headers = buildClobHeaders("DELETE", path, bodyStr);
  const resp = await fetch(`${CLOB_API}${path}`, {
    method: "DELETE", headers, body: bodyStr, signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`CLOB DELETE ${path} → ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

// ─── Open Orders ──────────────────────────────────────────────────────────────
router.get("/orders", async (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const data = await clobGet<{ orders?: unknown[] } | unknown[]>(`/orders?maker_address=${creds.address}`);
    const orders = Array.isArray(data) ? data : ((data as { orders?: unknown[] }).orders ?? []);
    return res.json(orders);
  } catch (err) {
    logger.error({ err }, "Failed to fetch open orders");
    return res.status(500).json({ error: "Failed to fetch open orders" });
  }
});

// ─── Cancel all orders ────────────────────────────────────────────────────────
router.delete("/orders", requireAdmin, async (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const result = await clobDelete<unknown>("/orders");
    return res.json({ ok: true, result });
  } catch (err) {
    logger.error({ err }, "Failed to cancel all orders");
    return res.status(500).json({ ok: false, error: "Failed to cancel all orders" });
  }
});

// ─── Cancel single order ──────────────────────────────────────────────────────
router.delete("/orders/:orderId", requireAdmin, async (req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  const { orderId } = req.params;
  try {
    const result = await clobDelete<unknown>(`/orders/${orderId}`);
    return res.json({ ok: true, result });
  } catch (err) {
    logger.error({ err }, "Failed to cancel order");
    return res.status(500).json({ ok: false, error: "Failed to cancel order" });
  }
});

// ─── Closed Positions ─────────────────────────────────────────────────────────
router.get("/portfolio/closed", async (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const raw = await fetchPolymarket<unknown>(
      `${DATA_API}/closed-positions?user=${creds.address}&limit=100`
    );
    const positions = Array.isArray(raw) ? raw
      : (raw as { data?: unknown[]; results?: unknown[] }).data
        ?? (raw as { results?: unknown[] }).results
        ?? [];
    return res.json(positions);
  } catch (err) {
    logger.error({ err }, "Failed to fetch closed positions");
    return res.status(500).json({ error: "Failed to fetch closed positions" });
  }
});

// ─── Builder Leaderboard ──────────────────────────────────────────────────────
router.get("/leaderboard", async (req: Request, res: Response) => {
  try {
    const VALID_PERIODS = new Set(["DAY", "WEEK", "MONTH", "ALL"]);
    const timePeriod = VALID_PERIODS.has(String(req.query.timePeriod ?? "").toUpperCase())
      ? String(req.query.timePeriod).toUpperCase()
      : "WEEK";
    const raw = await fetchPolymarket<unknown>(
      `${DATA_API}/v1/builders/leaderboard?timePeriod=${timePeriod}`
    );
    const entries = Array.isArray(raw) ? raw
      : (raw as { data?: unknown[] }).data ?? [];
    const normalized = (entries as Record<string, unknown>[]).map((e) => ({
      builderCode: String(e["builderCode"] ?? e["builder_code"] ?? ""),
      name: e["builder"] != null ? String(e["builder"]) : (e["name"] != null ? String(e["name"]) : null),
      volumeUsdc: Number(e["volume"] ?? e["volumeUsdc"] ?? e["volume_usdc"] ?? 0),
      rank: e["rank"] != null ? Number(e["rank"]) : null,
      tradeCount: e["activeUsers"] != null ? Number(e["activeUsers"]) : (e["tradeCount"] != null ? Number(e["tradeCount"]) : null),
      verified: e["verified"] ?? null,
      logo: e["builderLogo"] ?? e["logo"] ?? null,
      address: e["address"] != null ? String(e["address"]) : (e["makerAddress"] != null ? String(e["makerAddress"]) : null),
    }));
    return res.json(normalized);
  } catch (err) {
    logger.error({ err }, "Failed to fetch leaderboard");
    return res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// ─── Builder Analytics: volume time-series (extends /leaderboard) ────────────
// Note: the upstream `builderCode` query param on this endpoint is ignored by
// Polymarket's Data API (it always returns the full per-period ranking), so we
// fetch the full set and filter to the requested builder ourselves.
router.get("/builders/volume", async (req: Request, res: Response) => {
  try {
    const VALID_PERIODS_VOL = new Set(["DAY", "WEEK", "MONTH", "ALL"]);
    const timePeriod = VALID_PERIODS_VOL.has(String(req.query["timePeriod"] ?? "").toUpperCase())
      ? String(req.query["timePeriod"]).toUpperCase()
      : "WEEK";
    const builderCode = req.query["builderCode"] ? String(req.query["builderCode"]) : null;
    const raw = await fetchPolymarket<unknown>(
      `${DATA_API}/v1/builders/volume?timePeriod=${timePeriod}`
    );
    const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const filtered = builderCode
      ? rows.filter((r) => String(r["builderCode"] ?? r["builder_code"] ?? "").toLowerCase() === builderCode.toLowerCase())
      : rows;
    const normalized = filtered
      .map((e) => ({
        date: String(e["dt"] ?? e["date"] ?? ""),
        builderCode: String(e["builderCode"] ?? e["builder_code"] ?? ""),
        name: e["builder"] != null ? String(e["builder"]) : null,
        volumeUsdc: Number(e["volume"] ?? e["volumeUsdc"] ?? 0),
        activeUsers: e["activeUsers"] != null ? Number(e["activeUsers"]) : null,
        rank: e["rank"] != null ? Number(e["rank"]) : null,
        verified: typeof e["verified"] === "boolean" ? e["verified"] : null,
        logo: e["builderLogo"] != null ? String(e["builderLogo"]) : (e["logo"] != null ? String(e["logo"]) : null),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return res.json(normalized);
  } catch (err) {
    logger.error({ err }, "Failed to fetch builder volume");
    return res.status(500).json({ error: "Failed to fetch builder volume" });
  }
});

// ─── Builder Analytics: raw trades attributed to a builder code (public) ─────
router.get("/builders/trades", async (req: Request, res: Response) => {
  try {
    const builderCode = req.query["builderCode"] ? String(req.query["builderCode"]) : getBuilderCode();
    if (!builderCode) return res.status(400).json({ error: "builderCode query param required" });
    const limit = req.query["limit"] ? String(req.query["limit"]) : "50";
    const cursor = req.query["cursor"] ? String(req.query["cursor"]) : undefined;
    const qs = new URLSearchParams({ builder_code: builderCode, limit });
    if (cursor) qs.set("next_cursor", cursor);
    const raw = await fetchPolymarket<{ data?: Record<string, unknown>[]; next_cursor?: string; count?: number }>(
      `${CLOB_API}/builder/trades?${qs.toString()}`
    );
    const data = (raw.data ?? []).map((t) => ({
      id: String(t["id"] ?? ""),
      market: String(t["market"] ?? ""),
      side: String(t["side"] ?? "BUY"),
      size: Number(t["size"] ?? 0),
      sizeUsdc: Number(t["sizeUsdc"] ?? 0),
      price: Number(t["price"] ?? 0),
      status: String(t["status"] ?? ""),
      outcome: String(t["outcome"] ?? ""),
      outcomeIndex: t["outcomeIndex"] != null ? Number(t["outcomeIndex"]) : null,
      transactionHash: t["transactionHash"] != null ? String(t["transactionHash"]) : null,
      matchTime: t["matchTime"] != null ? Number(t["matchTime"]) : null,
      createdAt: t["createdAt"] != null ? String(t["createdAt"]) : null,
      builderCode: String(t["builderCode"] ?? ""),
      fee: t["fee"] != null ? Number(t["fee"]) : null,
      feeUsdc: t["feeUsdc"] != null ? Number(t["feeUsdc"]) : null,
    }));
    return res.json({ data, nextCursor: raw.next_cursor ?? null, count: raw.count ?? data.length });
  } catch (err) {
    logger.error({ err }, "Failed to fetch builder trades");
    return res.status(500).json({ error: "Failed to fetch builder trades" });
  }
});

// ─── Builder Analytics: aggregate fee revenue (bounded pagination) ───────────
// The CLOB /builder/trades endpoint pages results; we walk up to MAX_FEE_PAGES
// pages (MAX_FEE_TRADES trades) summing `feeUsdc` and report `truncated: true`
// if a next_cursor remains, so the UI can be honest about incompleteness
// instead of silently under-reporting revenue.
const FEE_SUMMARY_PAGE_SIZE = 100;
const MAX_FEE_PAGES = 10;

router.get("/builders/fees/summary", async (req: Request, res: Response) => {
  try {
    const builderCode = req.query["builderCode"] ? String(req.query["builderCode"]) : getBuilderCode();
    if (!builderCode) return res.status(400).json({ error: "builderCode query param required" });

    let cursor: string | undefined;
    let totalFeeUsdc = 0;
    let tradeCount = 0;
    let feeTradeCount = 0;
    let truncated = false;

    for (let page = 0; page < MAX_FEE_PAGES; page++) {
      const qs = new URLSearchParams({ builder_code: builderCode, limit: String(FEE_SUMMARY_PAGE_SIZE) });
      if (cursor) qs.set("next_cursor", cursor);
      const raw = await fetchPolymarket<{ data?: Record<string, unknown>[]; next_cursor?: string }>(
        `${CLOB_API}/builder/trades?${qs.toString()}`
      );
      const rows = raw.data ?? [];
      tradeCount += rows.length;
      for (const t of rows) {
        if (t["feeUsdc"] != null) {
          totalFeeUsdc += Number(t["feeUsdc"]);
          feeTradeCount++;
        }
      }
      cursor = raw.next_cursor;
      if (!cursor || rows.length === 0) { truncated = false; break; }
      if (page === MAX_FEE_PAGES - 1) truncated = true;
    }

    return res.json({ totalFeeUsdc, tradeCount, feeTradeCount, truncated });
  } catch (err) {
    logger.error({ err }, "Failed to fetch builder fee summary");
    return res.status(500).json({ error: "Failed to fetch builder fee summary" });
  }
});

// ─── Rewards: currently active reward-eligible markets (public) ──────────────
router.get("/rewards/markets", async (req: Request, res: Response) => {
  try {
    const limit = req.query["limit"] ? String(req.query["limit"]) : "50";
    const cursor = req.query["cursor"] ? String(req.query["cursor"]) : undefined;
    const qs = new URLSearchParams({ limit });
    if (cursor) qs.set("next_cursor", cursor);
    const raw = await fetchPolymarket<{ data?: Record<string, unknown>[]; next_cursor?: string; count?: number }>(
      `${CLOB_API}/rewards/markets/current?${qs.toString()}`
    );
    const data = (raw.data ?? []).map((m) => ({
      conditionId: String(m["condition_id"] ?? m["conditionId"] ?? ""),
      rewardsMaxSpread: Number(m["rewards_max_spread"] ?? m["rewardsMaxSpread"] ?? 0),
      rewardsMinSize: Number(m["rewards_min_size"] ?? m["rewardsMinSize"] ?? 0),
      nativeDailyRate: Number(m["native_daily_rate"] ?? m["nativeDailyRate"] ?? 0),
      totalDailyRate: Number(m["total_daily_rate"] ?? m["totalDailyRate"] ?? 0),
      rewardsConfig: Array.isArray(m["rewards_config"] ?? m["rewardsConfig"])
        ? ((m["rewards_config"] ?? m["rewardsConfig"]) as Record<string, unknown>[]).map((c) => ({
            assetAddress: String(c["asset_address"] ?? c["assetAddress"] ?? ""),
            startDate: String(c["start_date"] ?? c["startDate"] ?? ""),
            endDate: String(c["end_date"] ?? c["endDate"] ?? ""),
            ratePerDay: Number(c["rate_per_day"] ?? c["ratePerDay"] ?? 0),
            totalRewards: Number(c["total_rewards"] ?? c["totalRewards"] ?? 0),
          }))
        : [],
    }));
    return res.json({ data, nextCursor: raw.next_cursor ?? null, count: raw.count ?? data.length });
  } catch (err) {
    logger.error({ err }, "Failed to fetch reward markets");
    return res.status(500).json({ error: "Failed to fetch reward markets" });
  }
});

// ─── Rewards: my current per-market reward percentages/rates (authed) ────────
// Note: like other authed CLOB endpoints (see /settings/test), this can be blocked
// by Polymarket's Cloudflare Bot Fight Mode when called from cloud/server IPs —
// we surface the real upstream error rather than fabricating a response.
// The upstream response shape isn't fully documented, so we pass it through as-is
// (validated only as an array of records) instead of guessing field names.
router.get("/rewards/user/percentages", async (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const raw = await clobGet<unknown>("/rewards/user/percentages");
    return res.json(Array.isArray(raw) ? raw : []);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    logger.error({ err }, "Failed to fetch reward percentages");
    return res.status(502).json({
      error: "Could not reach CLOB rewards API — Cloudflare blocks authenticated CLOB calls from cloud/server IPs",
      detail: msg,
    });
  }
});

// ─── Rewards: my reward earnings history (authed, paginated) ─────────────────
router.get("/rewards/earnings", async (req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) return res.status(503).json({ error: "CLOB credentials not configured" });
  try {
    const limit = req.query["limit"] ? String(req.query["limit"]) : "20";
    const cursor = req.query["cursor"] ? String(req.query["cursor"]) : undefined;
    const qs = new URLSearchParams({ limit });
    if (cursor) qs.set("next_cursor", cursor);
    const raw = await clobGet<{ data?: unknown[]; next_cursor?: string; count?: number }>(`/rewards/user?${qs.toString()}`);
    return res.json({
      data: Array.isArray(raw?.data) ? raw.data : [],
      nextCursor: raw?.next_cursor ?? null,
      count: raw?.count ?? 0,
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    logger.error({ err }, "Failed to fetch reward earnings");
    return res.status(502).json({
      error: "Could not reach CLOB rewards API — Cloudflare blocks authenticated CLOB calls from cloud/server IPs",
      detail: msg,
    });
  }
});

// ─── Sports live scores SSE ───────────────────────────────────────────────────
const sportsClients = new Set<Response>();
let sportsWs: WebSocket | null = null;
let sportsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function startSportsWs() {
  if (sportsWs && (sportsWs.readyState === WebSocket.OPEN || sportsWs.readyState === WebSocket.CONNECTING)) return;
  if (sportsReconnectTimer) { clearTimeout(sportsReconnectTimer); sportsReconnectTimer = null; }
  try {
    const ws = new WebSocket("wss://sports-api.polymarket.com/ws");
    sportsWs = ws;
    ws.on("message", (raw) => {
      const str = raw.toString();
      if (str === "ping") { try { ws.send("pong"); } catch { /* ignore */ } return; }
      if (sportsClients.size === 0) return;
      const msg = `data: ${str}\n\n`;
      for (const client of sportsClients) {
        try { client.write(msg); } catch { sportsClients.delete(client); }
      }
    });
    ws.on("close", () => {
      sportsWs = null;
      if (sportsClients.size > 0) sportsReconnectTimer = setTimeout(startSportsWs, 3000);
    });
    ws.on("error", () => { sportsWs = null; });
  } catch { /* ignore */ }
}

router.get("/sports-stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  sportsClients.add(res);
  startSportsWs();
  const hb = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch { clearInterval(hb); } }, 20000);
  req.on("close", () => { clearInterval(hb); sportsClients.delete(res); });
});

// ─── User activity SSE (authenticated WS proxy) ───────────────────────────────
const userSseClients = new Set<Response>();
let userWs: WebSocket | null = null;
let userReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function startUserWs() {
  const creds = getClobCreds();
  if (!creds.ok) return;
  if (userWs && (userWs.readyState === WebSocket.OPEN || userWs.readyState === WebSocket.CONNECTING)) return;
  if (userReconnectTimer) { clearTimeout(userReconnectTimer); userReconnectTimer = null; }
  try {
    const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/user");
    userWs = ws;
    ws.on("open", () => {
      logger.info("User WS connected");
      ws.send(JSON.stringify({
        auth: { apiKey: creds.key, secret: creds.secret, passphrase: creds.passphrase },
        markets: [], type: "user", assets_ids: [],
      }));
    });
    ws.on("message", (raw) => {
      if (userSseClients.size === 0) return;
      const msg = `data: ${raw.toString()}\n\n`;
      for (const client of userSseClients) {
        try { client.write(msg); } catch { userSseClients.delete(client); }
      }
    });
    ws.on("close", () => {
      userWs = null;
      if (userSseClients.size > 0) userReconnectTimer = setTimeout(startUserWs, 3000);
    });
    ws.on("error", () => { userWs = null; });
  } catch { /* ignore */ }
}

router.get("/user-stream", (req: Request, res: Response): void => {
  const creds = getClobCreds();
  if (!creds.ok) { res.status(503).json({ error: "CLOB credentials not configured" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  userSseClients.add(res);
  startUserWs();
  const hb = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch { clearInterval(hb); } }, 20000);
  req.on("close", () => { clearInterval(hb); userSseClients.delete(res); });
});

// ─── Notification settings ────────────────────────────────────────────────────
router.get("/settings/notifications", (_req: Request, res: Response) => {
  return res.json({
    email: notifyConfig.email,
    whaleEnabled: notifyConfig.whaleEnabled,
    signalsEnabled: notifyConfig.signalsEnabled,
    whaleThreshold: notifyConfig.whaleThreshold,
    resendConfigured: !!(process.env["RESEND_API_KEY"] || "").trim(),
  });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/settings/notifications", requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Partial<NotifyConfig>;
  if (typeof body.email === "string") {
    const trimmed = body.email.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    notifyConfig.email = trimmed;
  }
  if (typeof body.whaleEnabled === "boolean") notifyConfig.whaleEnabled = body.whaleEnabled;
  if (typeof body.signalsEnabled === "boolean") notifyConfig.signalsEnabled = body.signalsEnabled;
  if (typeof body.whaleThreshold === "number" && Number.isFinite(body.whaleThreshold) && body.whaleThreshold >= 100) {
    notifyConfig.whaleThreshold = Math.round(body.whaleThreshold);
  }
  return res.json({
    email: notifyConfig.email,
    whaleEnabled: notifyConfig.whaleEnabled,
    signalsEnabled: notifyConfig.signalsEnabled,
    whaleThreshold: notifyConfig.whaleThreshold,
    resendConfigured: !!(process.env["RESEND_API_KEY"] || "").trim(),
  });
});

router.post("/settings/notifications/test", requireAdmin, async (_req: Request, res: Response) => {
  const apiKey = (process.env["RESEND_API_KEY"] || "").trim();
  const to = notifyConfig.email.trim();
  if (!apiKey) return res.status(503).json({ ok: false, error: "RESEND_API_KEY not configured" });
  if (!to) return res.status(400).json({ ok: false, error: "No destination email set" });
  try {
    await sendEmail(
      "✅ PolyWatch — Email notifications active",
      `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#e5e7eb;font-family:monospace;padding:24px">
<div style="max-width:480px;margin:0 auto;border:1px solid #27272a;border-radius:12px;padding:24px">
  <div style="font-size:16px;font-weight:bold;color:#06b6d4;margin-bottom:12px">✅ Email notifications are working!</div>
  <div style="font-size:12px;color:#9ca3af;line-height:1.6">
    <b style="color:#e5e7eb">Whale feed alerts</b> — you'll receive an email for any trade ≥ ${formatUsd(notifyConfig.whaleThreshold)}.<br><br>
    <b style="color:#e5e7eb">AI signals digest</b> — you'll receive an email each time you run an AI analysis on the Signals page.
  </div>
</div></body></html>`,
    );
    return res.json({ ok: true, sentTo: to });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Send failed" });
  }
});

// ─── Settings: credential status (never expose secret values; builderCode is public) ──
router.get("/settings/status", (_req: Request, res: Response) => {
  const creds = getClobCreds();
  const pk = getPrivateKey();
  const bc = getBuilderCode();
  const relayer = getRelayerCreds();
  return res.json({
    address:      { set: !!creds.address,     source: runtimeCreds.address     ? "runtime" : (process.env["POLY_ADDRESS"]        ? "env" : "unset") },
    apiKey:       { set: !!creds.key,          source: runtimeCreds.key         ? "runtime" : (process.env["POLY_API_KEY"]        ? "env" : "unset") },
    apiSecret:    { set: !!creds.secret,       source: runtimeCreds.secret      ? "runtime" : (process.env["POLY_API_SECRET"]     ? "env" : "unset") },
    apiPassphrase:{ set: !!creds.passphrase,   source: runtimeCreds.passphrase  ? "runtime" : (process.env["POLY_API_PASSPHRASE"] ? "env" : "unset") },
    privateKey:   { set: !!pk,                 source: runtimeCreds.privateKey  ? "runtime" : (process.env["POLY_PRIVATE_KEY"]    ? "env" : "unset") },
    builderCode:  { set: !!bc, value: bc || null, source: runtimeCreds.builderCode ? "runtime" : (process.env["POLY_BUILDER_CODE"] ? "env" : "unset") },
    clobReady:    creds.ok,
    relayerReady: relayer.ok,
    proxyReady:   !!getClobProxyUrl(),
    derivation:   { state: derivationState, error: derivationError },
  });
});

// ─── Credential derivation from private key (Polymarket EIP-191 auth flow) ───
// Credentials are stored in-memory (runtimeCreds). They persist for the life of
// the server process. For permanent storage, set the returned values in Replit Secrets.
let derivationState: "idle" | "running" | "done" | "failed" = "idle";
let derivationError: string | null = null;

async function deriveAndStoreCredentials(): Promise<{ ok: boolean; error?: string }> {
  const pk      = getPrivateKey();
  const address = (runtimeCreds.address || process.env["POLY_ADDRESS"] || "").trim();
  if (!pk)      return { ok: false, error: "POLY_PRIVATE_KEY not set" };
  if (!address) return { ok: false, error: "POLY_ADDRESS not set" };

  derivationState = "running";
  try {
    const wallet = new Wallet(pk);
    const eoaFromKey = await wallet.getAddress();

    // POLY_ADDRESS is the proxy/API wallet (e.g. 0xe3e93099...) — it will differ from the
    // EOA derived from POLY_PRIVATE_KEY (0xB14436...) because Polymarket uses a dual-wallet
    // model. Log a warning but continue — derivation signs with the EOA key on behalf of the
    // proxy wallet (requires on-chain CLOB setup), and may still succeed or fail gracefully.
    if (eoaFromKey.toLowerCase() !== address.toLowerCase()) {
      logger.warn(
        { eoaFromKey, polyAddress: address },
        "POLY_PRIVATE_KEY derives to a different address than POLY_ADDRESS — " +
        "derivation will attempt anyway (EOA may control proxy wallet on-chain); " +
        "if it fails, env-var credentials (POLY_API_KEY etc.) will be used as-is.",
      );
    }

    // @polymarket/clob-client detects ethers v5 via _signTypedData; wrap v6 wallet
    const signerCompat = {
      _signTypedData: (domain: Parameters<typeof wallet.signTypedData>[0], types: Parameters<typeof wallet.signTypedData>[1], value: Parameters<typeof wallet.signTypedData>[2]) =>
        wallet.signTypedData(domain, types, value),
      getAddress: () => wallet.getAddress(),
    };

    // Use the official @polymarket/clob-client to build L1 auth headers (EIP-712)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l1 = await createL1Headers(signerCompat as any, Chain.POLYGON);

    const resp = await clobFetch(`${CLOB_API}/auth/api-key`, {
      method: "POST",
      headers: {
        "User-Agent":    "@polymarket/clob-client",
        "Accept":        "*/*",
        "Content-Type":  "application/json",
        "POLY_ADDRESS":  l1.POLY_ADDRESS,
        "POLY_SIGNATURE": l1.POLY_SIGNATURE,
        "POLY_TIMESTAMP": l1.POLY_TIMESTAMP,
        "POLY_NONCE":    l1.POLY_NONCE,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`CLOB /auth/api-key → ${resp.status}: ${text}`);
    }

    const data = await resp.json() as { apiKey?: string; secret?: string; passphrase?: string };
    if (!data.apiKey || !data.secret || !data.passphrase) {
      throw new Error(`Unexpected credential response: ${JSON.stringify(data)}`);
    }

    runtimeCreds.key        = data.apiKey;
    runtimeCreds.secret     = data.secret;
    runtimeCreds.passphrase = data.passphrase;
    runtimeCreds.address    = address;
    derivationState = "done";
    derivationError = null;
    logger.info({ address }, "CLOB API credentials auto-derived from private key");
    return { ok: true };
  } catch (err) {
    derivationState = "failed";
    derivationError = err instanceof Error ? err.message : String(err);
    logger.warn({ err: derivationError }, "CLOB credential derivation failed");
    return { ok: false, error: derivationError };
  }
}

// Assign the forward reference now that the function is defined.
// clobGet/clobPost use this to auto-recover from 401s without a circular declaration.
_autoRederive = deriveAndStoreCredentials;

// Auto-derive at startup whenever a private key is present.
// If env var API keys are also set they may be stale — always re-derive so the server
// starts with fresh credentials instead of hitting 401s on the first CLOB call.
void (async () => {
  const hasPk = !!(process.env["POLY_PRIVATE_KEY"]);
  if (hasPk) {
    const hasApi = !!(process.env["POLY_API_KEY"] && process.env["POLY_API_SECRET"] && process.env["POLY_API_PASSPHRASE"]);
    if (hasApi) {
      logger.info("Private key + env API keys both found — re-deriving to ensure fresh CLOB credentials");
    } else {
      logger.info("Private key found, no CLOB API keys — deriving credentials");
    }
    await deriveAndStoreCredentials();
  }
})();

// ─── Auth: derive CLOB credentials from private key on demand ────────────────
router.post("/auth/derive", requireAdmin, async (_req: Request, res: Response) => {
  if (derivationState === "running") {
    return res.json({ ok: false, error: "Derivation already in progress" });
  }
  const pk = getPrivateKey();
  let computedAddress: string | null = null;
  if (pk && pk !== "0xblank") {
    try { computedAddress = new Wallet(pk).address; } catch { /* invalid key */ }
  }
  const result = await deriveAndStoreCredentials();
  return res.json({ ...result, computedAddress });
});

// ─── Relayer: status ─────────────────────────────────────────────────────────
router.get("/relayer/status", async (_req: Request, res: Response) => {
  const creds = getRelayerCreds();
  if (!creds.ok) {
    return res.json({ ok: false, ready: false, error: "RELAYER_API_KEY or RELAYER_API_KEY_ADDRESS not set" });
  }
  try {
    const deployed = await fetch(
      `${RELAYER_API}/deployed?address=${encodeURIComponent(creds.address)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const body = await deployed.json() as { deployed?: boolean };
    return res.json({ ok: true, ready: true, address: creds.address, deployed: body.deployed ?? null });
  } catch (err) {
    return res.json({ ok: false, ready: false, error: String(err instanceof Error ? err.message : err) });
  }
});

// ─── Relayer: recent transactions ────────────────────────────────────────────
router.get("/relayer/transactions", async (_req: Request, res: Response) => {
  const creds = getRelayerCreds();
  if (!creds.ok) return res.status(401).json({ error: "Relayer not configured" });
  try {
    const data = await relayerGet<unknown[]>("/transactions");
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ─── Relayer: check if a wallet is deployed (no auth) ────────────────────────
router.get("/relayer/deployed", async (req: Request, res: Response) => {
  const address = req.query["address"] as string | undefined;
  if (!address) return res.status(400).json({ error: "address query param required" });
  try {
    const resp = await fetch(
      `${RELAYER_API}/deployed?address=${encodeURIComponent(address)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const body = await resp.json() as { deployed?: boolean };
    return res.json(body);
  } catch (err) {
    return res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ─── Settings: test CLOB proxy ───────────────────────────────────────────────
// Verifies the residential proxy can reach clob.polymarket.com
router.get("/settings/proxy-test", async (_req: Request, res: Response) => {
  const proxyUrl = getClobProxyUrl();
  if (!proxyUrl) {
    return res.json({ ok: false, proxyConfigured: false, error: "CLOB_PROXY_URL not set — add it to Replit Secrets" });
  }
  try {
    const agent = new ProxyAgent(sanitizeProxyUrl(proxyUrl));
    const undiciResp = await proxyFetch(
      `${CLOB_API}/`,
      { dispatcher: agent, signal: AbortSignal.timeout(10000) } as Parameters<typeof proxyFetch>[1]
    );
    const status = undiciResp.status;
    return res.json({
      ok: true,
      proxyConfigured: true,
      httpStatus: status,
      note: status < 500
        ? "CLOB reachable through proxy — bot auto-trading should work"
        : `CLOB returned ${status} through proxy — check proxy credentials`,
    });
  } catch (err) {
    return res.json({
      ok: false,
      proxyConfigured: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── Settings: test CLOB connection ──────────────────────────────────────────
// Note: Polymarket's CLOB API (clob.polymarket.com) is behind Cloudflare Bot Fight Mode,
// which blocks direct server-to-server calls from cloud IPs. We can only verify that
// credentials are present and well-formed; a live ping is not possible from this host.
router.get("/settings/test", (_req: Request, res: Response) => {
  const creds = getClobCreds();
  if (!creds.ok) {
    return res.json({ ok: false, error: "Credentials incomplete — set POLY_API_KEY/SECRET/PASSPHRASE in Replit Secrets" });
  }
  const bc = getBuilderCode();
  return res.json({
    ok: true,
    address: creds.address,
    builderCode: bc || null,
    note: "Credentials present. Live CLOB ping not available from server (Cloudflare blocks cloud IPs).",
  });
});

// ─── Perps API base ───────────────────────────────────────────────────────────
const PERPS_API = "https://api.perpetuals.polymarket.com";

// ─── Market Top Holders ────────────────────────────────────────────────────────
router.get("/markets/:conditionId/holders", async (req: Request, res: Response) => {
  try {
    const conditionId = String(req.params.conditionId);
    if (!conditionId || !CONDITION_ID_RE.test(conditionId)) {
      return res.status(400).json({ error: "Invalid conditionId" });
    }
    const raw = await fetchPolymarket<Array<{
      token?: string;
      holders?: Array<{
        proxyWallet?: string;
        pseudonym?: string;
        name?: string;
        profileImage?: string;
        amount?: number;
        outcomeIndex?: number;
      }>;
    }>>(
      `${DATA_API}/holders?market=${encodeURIComponent(conditionId)}&limit=20`
    );
    if (!Array.isArray(raw)) return res.json([]);
    // Flatten MetaHolder[] → Holder[], tagging each with the token index
    const holders = raw.flatMap((meta, tokenIdx) =>
      (meta.holders ?? []).map((h) => ({
        proxyWallet: h.proxyWallet ?? "",
        pseudonym: h.pseudonym ?? null,
        name: h.name ?? null,
        profileImage: h.profileImage ?? null,
        balance: Number(h.amount ?? 0),
        outcomeIndex: h.outcomeIndex ?? tokenIdx,
        outcome: null as string | null,
      }))
    );
    return res.json(holders);
  } catch (err) {
    req.log.warn({ err }, "holders fetch failed");
    return res.json([]);
  }
});

// ─── Market Price History ─────────────────────────────────────────────────────
const VALID_PRICE_INTERVALS = new Set(["1m", "1w", "1d", "6h", "1h", "max"]);

router.get("/market-price-history", async (req: Request, res: Response) => {
  try {
    const conditionId = String(req.query.conditionId ?? "");
    const interval = String(req.query.interval ?? "1w");
    if (!conditionId || !CONDITION_ID_RE.test(conditionId)) {
      return res.status(400).json({ error: "conditionId required and must be a valid hex condition ID" });
    }
    const safeInterval = VALID_PRICE_INTERVALS.has(interval) ? interval : "1w";

    // Step 1: get clobTokenIds from Gamma
    const gammaMarkets = await fetchPolymarket<Array<{ clobTokenIds?: string; outcomes?: string }>>(
      `${GAMMA_API}/markets?condition_id=${encodeURIComponent(conditionId)}&limit=1`
    );
    if (!Array.isArray(gammaMarkets) || gammaMarkets.length === 0) {
      return res.status(404).json({ error: "Market not found" });
    }
    const market = gammaMarkets[0];
    let tokenIds: string[] = [];
    let outcomes: string[] = [];
    try { tokenIds = JSON.parse(market.clobTokenIds ?? "[]"); } catch {}
    try { outcomes = JSON.parse(market.outcomes ?? "[]"); } catch {}

    if (tokenIds.length === 0) {
      return res.status(404).json({ error: "No token IDs for this market" });
    }

    // Step 2: fetch price history for each outcome token from CLOB public endpoint
    const histories = await Promise.allSettled(
      tokenIds.map((tokenId) =>
        fetch(
          `${CLOB_API}/prices-history?token_id=${encodeURIComponent(tokenId)}&interval=${safeInterval}&fidelity=60`,
          { signal: AbortSignal.timeout(10000) }
        )
          .then((r) => r.json() as Promise<{ history?: Array<{ t: number; p: number }> }>)
          .then((data) => data.history ?? [])
      )
    );

    return res.json({
      history: histories.map((h) => (h.status === "fulfilled" ? h.value : [])),
      outcomes,
      tokenIds,
    });
  } catch (err) {
    req.log.warn({ err }, "price history fetch failed");
    return res.status(500).json({ error: "Failed to fetch price history" });
  }
});

// ─── Market Comments ──────────────────────────────────────────────────────────
router.get("/markets/:conditionId/comments", async (req: Request, res: Response) => {
  try {
    const conditionId = String(req.params.conditionId);
    if (!conditionId || !CONDITION_ID_RE.test(conditionId)) {
      return res.status(400).json({ error: "Invalid conditionId" });
    }

    // Get integer market ID from Gamma
    const gammaMarkets = await fetchPolymarket<Array<{ id?: number | string }>>(
      `${GAMMA_API}/markets?condition_id=${encodeURIComponent(conditionId)}&limit=1`
    );
    if (!Array.isArray(gammaMarkets) || gammaMarkets.length === 0) {
      return res.json([]);
    }
    const marketId = gammaMarkets[0].id;
    if (!marketId) return res.json([]);

    const comments = await fetchPolymarket<Array<{
      id?: number;
      body?: string;
      content?: string;
      author?: string;
      pseudonym?: string;
      profileImage?: string;
      createdAt?: string;
      parentEntityId?: number;
      likes?: number;
      likeCount?: number;
    }>>(
      `${GAMMA_API}/comments?parent_entity_type=market&parent_entity_id=${marketId}&limit=30&order=createdAt&ascending=false`
    );
    if (!Array.isArray(comments)) return res.json([]);
    return res.json(
      comments.map((c) => ({
        id: c.id ?? 0,
        content: c.body ?? c.content ?? "",
        author: c.author ?? null,
        pseudonym: c.pseudonym ?? null,
        profileImage: c.profileImage ?? null,
        createdAt: c.createdAt ?? new Date().toISOString(),
        parentEntityId: c.parentEntityId ?? null,
        likes: c.likes ?? c.likeCount ?? null,
      }))
    );
  } catch (err) {
    req.log.warn({ err }, "comments fetch failed");
    return res.json([]);
  }
});

// ─── Trader Leaderboard ────────────────────────────────────────────────────────
const VALID_TRADER_PERIODS = new Set(["DAY", "WEEK", "MONTH", "ALL"]);

router.get("/trader-leaderboard", async (req: Request, res: Response) => {
  try {
    const timePeriod = VALID_TRADER_PERIODS.has(String(req.query.timePeriod ?? "").toUpperCase())
      ? String(req.query.timePeriod).toUpperCase()
      : "ALL";
    const category = String(req.query.category ?? "all").toLowerCase();

    const raw = await fetchPolymarket<Array<{
      rank?: string | number;
      proxyWallet?: string;
      userName?: string;
      vol?: number;
      pnl?: number;
      profileImage?: string;
      xUsername?: string;
      verifiedBadge?: boolean;
    }>>(
      `${DATA_API}/v1/leaderboard?timePeriod=${timePeriod}${category && category !== "all" ? `&category=${encodeURIComponent(category)}` : ""}`
    );
    if (!Array.isArray(raw)) return res.json([]);
    return res.json(
      raw.map((e, i) => ({
        rank: Number(e.rank ?? i + 1),
        address: e.proxyWallet ?? "",
        pseudonym: e.userName ?? null,
        name: null,
        profileImage: e.profileImage ?? null,
        pnl: e.pnl ?? null,
        roi: null,
        volume: e.vol ?? null,
        tradesCount: null,
        verifiedBadge: e.verifiedBadge ?? false,
        xUsername: e.xUsername ?? null,
      }))
    );
  } catch (err) {
    req.log.warn({ err }, "trader leaderboard fetch failed");
    return res.json([]);
  }
});

// ─── Events Explorer ──────────────────────────────────────────────────────────
router.get("/events", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const search = req.query.search ? String(req.query.search) : null;
    const tag = req.query.tag ? String(req.query.tag) : null;

    let url = `${GAMMA_API}/events?limit=${limit}&closed=false&active=true`;
    if (tag) url += `&tag=${encodeURIComponent(tag)}`;

    const raw = await fetchPolymarket<Array<{
      id?: string | number;
      title?: string;
      slug?: string;
      description?: string;
      image?: string;
      icon?: string;
      startDate?: string;
      endDate?: string;
      volume?: number;
      volume24hr?: number;
      liquidity?: number;
      markets?: unknown[];
      tags?: Array<{ label?: string; slug?: string }>;
    }>>(url);

    if (!Array.isArray(raw)) return res.json([]);

    let events = raw.map((e) => ({
      id: Number(e.id ?? 0),
      title: e.title ?? "",
      slug: e.slug ?? "",
      description: e.description ?? null,
      image: e.image ?? null,
      icon: e.icon ?? null,
      startDate: e.startDate ?? null,
      endDate: e.endDate ?? null,
      volume: typeof e.volume === "number" ? e.volume : null,
      volume24hr: typeof e.volume24hr === "number" ? e.volume24hr : null,
      liquidity: typeof e.liquidity === "number" ? e.liquidity : null,
      marketCount: Array.isArray(e.markets) ? e.markets.length : null,
      markets: (e.markets ?? []) as Record<string, unknown>[],
      tags: (e.tags ?? []).map((t) => t.label ?? t.slug ?? "").filter(Boolean),
    }));

    if (search) {
      const q = search.toLowerCase();
      events = events.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q)
      );
    }

    return res.json(events);
  } catch (err) {
    req.log.warn({ err }, "events fetch failed");
    return res.json([]);
  }
});

// ─── Perps: Instruments ────────────────────────────────────────────────────────
router.get("/perps/instruments", async (req: Request, res: Response) => {
  try {
    const resp = await fetch(`${PERPS_API}/instruments`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "perps instruments non-2xx");
      return res.json([]);
    }
    const raw = (await resp.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return res.json([]);
    return res.json(
      raw.map((inst) => ({
        id: String(inst["id"] ?? inst["instrument_id"] ?? ""),
        symbol: String(inst["symbol"] ?? inst["ticker"] ?? ""),
        baseAsset: inst["baseAsset"] ?? inst["base_asset"] ?? null,
        quoteAsset: inst["quoteAsset"] ?? inst["quote_asset"] ?? "USDC",
        indexPrice: inst["indexPrice"] ?? inst["index_price"] ?? null,
        markPrice: inst["markPrice"] ?? inst["mark_price"] ?? null,
        lastPrice: inst["lastPrice"] ?? inst["last_price"] ?? null,
        openInterest: inst["openInterest"] ?? inst["open_interest"] ?? null,
        fundingRate: inst["fundingRate"] ?? inst["funding_rate"] ?? null,
        volume24h: inst["volume24h"] ?? inst["volume_24h"] ?? null,
        change24h: inst["change24h"] ?? inst["price_change_24h"] ?? null,
        high24h: inst["high24h"] ?? inst["high_24h"] ?? null,
        low24h: inst["low24h"] ?? inst["low_24h"] ?? null,
        category: inst["category"] ?? null,
        maxLeverage: inst["maxLeverage"] ?? inst["max_leverage"] ?? null,
      }))
    );
  } catch (err) {
    req.log.warn({ err }, "perps instruments fetch failed");
    return res.json([]);
  }
});

// ─── Perps: Recent Trades ──────────────────────────────────────────────────────
router.get("/perps/trades", async (req: Request, res: Response) => {
  try {
    const instrumentId = req.query.instrumentId ? String(req.query.instrumentId) : null;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    let url = `${PERPS_API}/trades?limit=${limit}`;
    if (instrumentId) url += `&instrument_id=${encodeURIComponent(instrumentId)}`;

    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "perps trades non-2xx");
      return res.json([]);
    }
    const raw = (await resp.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return res.json([]);
    return res.json(
      raw.map((t) => ({
        id: String(t["id"] ?? t["trade_id"] ?? ""),
        side: String(t["side"] ?? "BUY").toUpperCase(),
        size: Number(t["size"] ?? t["quantity"] ?? 0),
        price: Number(t["price"] ?? 0),
        timestamp: Number(t["timestamp"] ?? t["created_at"] ?? Math.floor(Date.now() / 1000)),
        instrumentId: String(t["instrumentId"] ?? t["instrument_id"] ?? ""),
        instrumentSymbol: t["symbol"] ?? t["instrumentSymbol"] ?? null,
        traderAddress: t["traderAddress"] ?? t["maker"] ?? null,
      }))
    );
  } catch (err) {
    req.log.warn({ err }, "perps trades fetch failed");
    return res.json([]);
  }
});

// ─── Taker Rebate Tier Stats ───────────────────────────────────────────────────
const TAKER_TIERS = [
  { name: "Bronze",   minVol: 0,           rebatePct: 0 },
  { name: "Silver",   minVol: 10_000,      rebatePct: 0.01 },
  { name: "Gold",     minVol: 100_000,     rebatePct: 0.02 },
  { name: "Platinum", minVol: 1_000_000,   rebatePct: 0.03 },
  { name: "Diamond",  minVol: 5_000_000,   rebatePct: 0.05 },
  { name: "Elite",    minVol: 25_000_000,  rebatePct: 0.075 },
  { name: "Obsidian", minVol: 100_000_000, rebatePct: 0.1 },
] as const;

router.get("/taker-stats", async (req: Request, res: Response) => {
  try {
    const creds = getClobCreds();
    if (!creds.ok) {
      return res.status(503).json({ error: "CLOB credentials not configured" });
    }
    const data = await clobGet<{
      takerVolume7d?: number;
      makerVolume7d?: number;
      makerShare?: number;
      entityMakerShare?: number;
    }>("/account/stats");

    const takerVol7d = Number(data.takerVolume7d ?? 0);
    const estimated30d = takerVol7d * (30 / 7);
    const tier =
      [...TAKER_TIERS].reverse().find((t) => estimated30d >= t.minVol) ?? TAKER_TIERS[0];
    const tierIndex = TAKER_TIERS.findIndex((t) => t.name === tier.name);
    const nextTier = TAKER_TIERS[tierIndex + 1] ?? null;

    return res.json({
      takerVolume7d: takerVol7d,
      makerVolume7d: Number(data.makerVolume7d ?? 0),
      makerShare: data.makerShare ?? null,
      entityMakerShare: data.entityMakerShare ?? null,
      tier: tierIndex,
      tierName: tier.name,
      nextTierVolume: nextTier ? nextTier.minVol : null,
      dailyRebatePct: tier.rebatePct,
      estimated30dTakerVol: estimated30d,
    });
  } catch (err) {
    req.log.warn({ err }, "taker stats fetch failed");
    return res.status(502).json({ error: "Failed to fetch taker stats" });
  }
});

export default router;
