---
name: Polymarket position `redeemable` field semantics
description: What the `redeemable` boolean on a Polymarket position actually means (and what it doesn't).
---

On Polymarket position payloads (Data API `/positions`), `redeemable: true` means the underlying market has resolved and the position is eligible for on-chain redemption via the CTF/adapter contract. It does **not** mean the position won or has any value.

**Why:** Losing positions on resolved markets are also `redeemable: true`, just with `currentValue: 0` (and `curPrice: 0`). A UI that sums `currentValue` over all `redeemable === true` positions to show "redeemable winnings" will often show $0 even when there are many resolved positions, because most of them are worthless losers. Confirmed empirically: a wallet with 24 redeemable positions had 0 with positive value.

**How to apply:** Any "redeemable winnings" or "claimable value" UI must filter on `redeemable === true && currentValue > 0`, not `redeemable === true` alone.
