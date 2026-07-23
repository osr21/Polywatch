---
name: Polymarket CLOB L2 header names
description: L2 HMAC auth headers use underscores, matching the official JS client (not hyphens like the Python client)
---

The official `@polymarket/clob-client` JS package sends L2 authentication headers with **underscores**:
- `POLY_ADDRESS`
- `POLY_API_KEY`
- `POLY_PASSPHRASE`
- `POLY_SIGNATURE`
- `POLY_TIMESTAMP`
- `POLY_NONCE`

The Python `py-clob-client` uses hyphens (`POLY-ADDRESS`, `POLY-API-KEY`, etc.). Both seem to work on Polymarket's backend, but the JS convention (underscores) should be preferred for this Node.js project to match the official JS client.

**L2 HMAC message format:** `timestamp + METHOD + requestPath + (body if present)`  
Example for `GET /balance`: `"1234567890GET/balance"`  
HMAC-SHA256 with base64-decoded secret, digest as base64.

**L1 EIP-712 signing** (for getting API keys): uses `buildClobEip712Signature` from `@polymarket/clob-client` with domain `{ name: "ClobAuthDomain", version: "1", chainId: 137 }`, type `ClobAuth` with nonce as `uint256`.
