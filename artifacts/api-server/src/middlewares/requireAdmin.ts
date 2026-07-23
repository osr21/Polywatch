import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";

/**
 * Gates fund-risk / mutating endpoints (bot config, bot execute, order
 * cancellation, credential re-derivation) behind a shared admin secret.
 *
 * This app has no user accounts — it's a single-owner dashboard exposed on a
 * public domain, so every route is otherwise reachable by anyone. Any route
 * that can move real funds (place/cancel orders, enable auto-trade) MUST be
 * gated by this middleware.
 *
 * Fails closed: if ADMIN_TOKEN is not configured, the route is unusable
 * rather than silently open.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env["ADMIN_TOKEN"] || "";
  if (!configured) {
    res.status(503).json({ error: "Admin token not configured on the server" });
    return;
  }

  const authHeader = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const provided = match?.[1]?.trim() || "";

  if (!provided || !safeCompare(provided, configured)) {
    res.status(401).json({ error: "Admin token required" });
    return;
  }

  next();
}

// Constant-time comparison of two strings. Hashing both to a fixed-length
// digest first avoids leaking the secret's length via timing, and avoids
// timingSafeEqual throwing on unequal-length buffers.
function safeCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
