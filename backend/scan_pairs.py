"""
Pair Scanner — scores a curated watchlist and ranks by safety score.
Run: python backend/scan_pairs.py

Add/remove symbols from WATCHLIST to customise.
"""

import MetaTrader5 as mt5
import sys
from data_fetcher import score_symbol, print_scorecard, FALLBACK_BALANCE_NGN

# ── WATCHLIST ────────────────────────────────────────────────────────────────
WATCHLIST = [
    # Forex Majors
    "EURUSDm", "GBPUSDm", "USDJPYm", "USDCHFm",
    "AUDUSDm", "NZDUSDm", "USDCADm",
    "EURGBPm", "EURJPYm", "GBPJPYm",
    # Crypto
    "BTCUSDm", "ETHUSDm", "SOLUSDm", "XRPUSDm", "BNBUSDm",
    # Metals
    "XAUUSDm", "XAGUSDm",
    # Indices
    "US500m", "US30m",
]

def main():
    if not mt5.initialize():
        print(f"MT5 connection failed: {mt5.last_error()}")
        sys.exit(1)

    account = mt5.account_info()
    balance = account.balance if account and account.balance > 0 else FALLBACK_BALANCE_NGN
    if account and account.balance == 0:
        print(f"⚠️  Balance is 0 — using fallback ₦{FALLBACK_BALANCE_NGN:,.0f}\n")

    print(f"Balance: ₦{balance:,.2f}  |  Daily limit: ₦{balance * 0.02:,.2f}")
    print(f"Scanning {len(WATCHLIST)} pairs...\n")

    results = []
    for sym in WATCHLIST:
        r = score_symbol(sym, balance)
        print_scorecard(r)
        results.append(r)

    # ── RANKED SUMMARY TABLE ─────────────────────────────────────────────────
    safe     = [r for r in results if r.get("classification") == "SAFE"]
    moderate = [r for r in results if r.get("classification") == "MODERATE"]
    risky    = [r for r in results if r.get("classification") == "RISKY"]
    errors   = [r for r in results if "error" in r]

    safe.sort(    key=lambda x: x["score"], reverse=True)
    moderate.sort(key=lambda x: x["score"], reverse=True)

    print(f"\n{'═'*65}")
    print(f"  FULL RANKING SUMMARY")
    print(f"{'═'*65}")

    header = f"  {'#':<4} {'Symbol':<14} {'Score':>6}  {'Class':<10}  {'SD':>5}  {'ADX':>5}  {'ATR×':>5}  {'Sprd%':>6}  {'Cap%':>5}"
    print(header)
    print(f"  {'-'*61}")

    rank = 1
    for group in [safe, moderate, risky]:
        for r in group:
            d = r["dimensions"]
            label_icon = {"SAFE": "✅", "MODERATE": "⚠️ ", "RISKY": "🔴"}
            icon = label_icon.get(r["classification"], "?")
            print(
                f"  {rank:<4} {r['symbol']:<14} {r['score']:>5.0f}  "
                f"{icon} {r['classification']:<8}  "
                f"{d['sd_position']['value']:>5.2f}  "
                f"{d['trend_strength']['value']:>5.1f}  "
                f"{d['volatility']['value']:>5.2f}  "
                f"{d['liquidity']['spread_pct']:>6.4f}  "
                f"{d['capital_exposure']['value']*100:>4.0f}%"
            )
            rank += 1
        if group and group != risky:
            print(f"  {'·'*61}")

    if errors:
        print(f"\n  Errors ({len(errors)}):")
        for r in errors:
            print(f"    {r['symbol']}: {r['error']}")

    print(f"\n  ✅ SAFE: {len(safe)}   ⚠️  MODERATE: {len(moderate)}   🔴 RISKY: {len(risky)}")
    print(f"{'═'*65}\n")

    mt5.shutdown()

if __name__ == "__main__":
    main()
