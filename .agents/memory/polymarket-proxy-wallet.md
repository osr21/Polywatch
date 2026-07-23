---
name: Polymarket dual-wallet model — POLY_ADDRESS vs EOA
description: Which address goes in POLY_ADDRESS and why it differs from POLY_PRIVATE_KEY's address
---

## The Rule

Polymarket uses a **dual-wallet model**:

- **EOA** (MetaMask wallet, e.g. `0xB14436...`) — used for on-chain actions; its private key goes in `POLY_PRIVATE_KEY`
- **Proxy/API wallet** (e.g. `0xe3e93099...`) — used for CLOB API calls; shown on polymarket.com/settings Builder tab as "For API use only"; this is what `POLY_ADDRESS` must be set to

**`POLY_ADDRESS` must equal the proxy/API wallet address, NOT the EOA address.** These two addresses are by design different. The API credentials (POLY_API_KEY / POLY_API_SECRET / POLY_API_PASSPHRASE) are created for the proxy wallet, so `POLY_ADDRESS` in L2 HMAC headers must match it.

**Why:** CLOB authenticates using the proxy wallet address + API key/secret. If `POLY_ADDRESS` = EOA, the CLOB rejects with `401: Unauthorized/Invalid api key` because the API key belongs to a different address.

## How to apply

- `POLY_ADDRESS` → proxy/API wallet address (the "For API use only" address on polymarket.com settings Builder tab)
- `POLY_PRIVATE_KEY` → EOA private key (MetaMask) — can be used for L1 signing; does NOT need to match POLY_ADDRESS
- Derivation (`/auth/api-key`) may fail with `400: Could not create api key` if the EOA isn't CLOB-linked — that is OK; fall back to env-var credentials (key/secret/passphrase) directly
- Do NOT add a hard mismatch check that blocks execution when EOA ≠ POLY_ADDRESS — this is expected and normal

## For this project

- EOA (MetaMask wallet, has private key): set via `POLY_PRIVATE_KEY` secret — do not hardcode address here
- Proxy/API wallet (for CLOB): set via `POLY_ADDRESS` secret — see polymarket.com/settings Builder tab
- `POLY_ADDRESS` secret must be the proxy wallet address (not the EOA address)
- `POLY_PRIVATE_KEY` is the EOA key — derivation will log a warning and fail with 400, env-var credentials are used directly
