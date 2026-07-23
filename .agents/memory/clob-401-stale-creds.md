---
name: CLOB 401 — diagnosing expired credentials vs wrong address
description: Diagnosing and handling CLOB 401 errors — expired credentials vs wrong POLY_ADDRESS
---

## The Rule

A 401 from authed CLOB routes can mean:
1. **Env-var API keys expired** (Polymarket rotates them) — fix: re-derive via `/api/auth/derive` or paste fresh keys from polymarket.com
2. **POLY_ADDRESS doesn't match the address the API key was created for** — fix: set POLY_ADDRESS to the proxy/API wallet (see `polymarket-proxy-wallet.md`), NOT the EOA

## Auto-retry on 401

`clobGet`/`clobPost` use a forward-ref `_autoRederive` (assigned after `deriveAndStoreCredentials` is defined) to auto-re-derive on 401 and retry once. Pattern needed because the function is defined ~2300 lines later in the same file.

**Why:** CLOB credentials expire periodically. Auto-retry lets the server self-heal without a restart.

## Startup re-derive

Always call `deriveAndStoreCredentials()` at startup when `POLY_PRIVATE_KEY` is present. Env-var keys can be stale on startup; re-deriving ensures fresh credentials. Derivation may fail with 400 (EOA not CLOB-linked) — that's OK, env-var credentials are used as-is.

## The mismatch check is NON-BLOCKING

When EOA address (from POLY_PRIVATE_KEY) ≠ POLY_ADDRESS, log a warning and continue — do NOT return early. The mismatch is expected (dual-wallet model). Derivation will fail with 400; env-var credentials still work correctly.

## HMAC signature format

The HMAC signature in L2 headers must be **URL-safe base64** (replace `+` → `-`, `/` → `_`). The secret input may arrive as base64url and must be normalized before decoding (`-` → `+`, `_` → `/`). Using plain base64 output causes 401 even with correct credentials.
