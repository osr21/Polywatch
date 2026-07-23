import { logger } from "./logger";

const GAMMA_API = "https://gamma-api.polymarket.com";

// In-memory TTL cache for Polymarket public profile lookups (no DB in this project).
// Populated on demand for wallets the Data API trade/activity payloads didn't already
// enrich with a name/pseudonym/profileImage (those come back empty for most wallets).
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const CONCURRENCY = 5;

export interface PublicProfile {
  name: string | null;
  pseudonym: string | null;
  profileImage: string | null;
  verifiedBadge: boolean;
}

interface CacheEntry {
  value: PublicProfile | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function pruneIfNeeded() {
  if (cache.size <= MAX_ENTRIES) return;
  // Map preserves insertion order — evict the oldest entry.
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

async function fetchPublicProfile(address: string): Promise<PublicProfile | null> {
  try {
    const resp = await fetch(`${GAMMA_API}/public-profile?address=${encodeURIComponent(address)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const name = typeof data["name"] === "string" && data["name"] ? data["name"] : null;
    const pseudonym = typeof data["pseudonym"] === "string" && data["pseudonym"] ? data["pseudonym"] : null;
    const profileImageRaw = data["profileImage"];
    const profileImage = typeof profileImageRaw === "string" && profileImageRaw ? profileImageRaw : null;
    const verifiedBadge = data["verifiedBadge"] === true;
    return { name, pseudonym, profileImage, verifiedBadge };
  } catch (err) {
    logger.warn({ err, address }, "Failed to fetch Polymarket public profile");
    return null;
  }
}

// Returns cached (or freshly fetched) public profile info for a wallet address.
// Always resolves — never throws — so callers can enrich data without risking
// the primary request.
export async function getPublicProfile(address: string): Promise<PublicProfile | null> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await fetchPublicProfile(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  pruneIfNeeded();
  return value;
}

// Batch-fetches public profiles for multiple addresses with bounded concurrency,
// skipping addresses that are still fresh in the cache.
export async function getPublicProfilesBatch(addresses: string[]): Promise<Map<string, PublicProfile | null>> {
  const uniqueAddresses = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const result = new Map<string, PublicProfile | null>();

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueAddresses.length) {
      const address = uniqueAddresses[cursor++];
      result.set(address, await getPublicProfile(address));
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, uniqueAddresses.length) }, () => worker());
  await Promise.all(workers);
  return result;
}
