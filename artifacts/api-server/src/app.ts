import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ─── Security headers ─────────────────────────────────────────────────────────
// helmet sets X-Content-Type-Options, X-Frame-Options, HSTS, etc.
// contentSecurityPolicy is disabled — this is a pure JSON API with no HTML output.
app.use(helmet({ contentSecurityPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests from:
//   • any *.replit.app or *.repl.co subdomain (published + preview)
//   • localhost (local dev)
//   • any origin listed in REPLIT_DOMAINS at runtime
const replitDomains: string[] = (process.env["REPLIT_DOMAINS"] ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

const ALLOWED_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[\w-]+\.(replit\.app|repl\.co|replit\.dev)(\/.*)?$/;

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / server-to-server requests have no Origin header — allow them.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGIN_RE.test(origin)) return callback(null, true);
      // Exact-match custom domains from REPLIT_DOMAINS — never use .includes() which
      // allows attacker-replit.app.evil.com to bypass the check.
      if (replitDomains.some((d) => origin === `https://${d}` || origin === `http://${d}`)) return callback(null, true);
      // Pass false (not an Error) so cors doesn't set ACAO header — browsers block it,
      // and we avoid a misleading 500. Return a 403 via a follow-up handler if needed.
      callback(null, false);
    },
    credentials: true,
  }),
);

// ─── Request parsing ──────────────────────────────────────────────────────────
// 100 KB cap prevents OOM attacks via huge JSON bodies (e.g. on /ai/signals).
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global: 300 requests per 15 minutes per IP — prevents scraping/DoS.
// Expensive proxy endpoints get a tighter window applied at the route level
// via the per-route limiters exported from polymarket.ts.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
  skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1", // allow loopback health-checks
});
app.use(globalLimiter);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use("/api", router);

export default app;
