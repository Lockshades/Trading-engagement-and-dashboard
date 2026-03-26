"""
List all available symbols grouped by type.
Run: python backend/list_symbols.py
"""
import MetaTrader5 as mt5
import sys

if not mt5.initialize():
    print(f"Failed: {mt5.last_error()}")
    sys.exit(1)

symbols = mt5.symbols_get()

# Group by suffix/path
crypto, forex_majors, forex_other, metals, indices, other = [], [], [], [], [], []

MAJOR_BASES = {"EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"}
MAJOR_PAIRS = {
    "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD",
    "EURGBP","EURJPY","GBPJPY"
}

for s in symbols:
    name = s.name
    if name.endswith("m") and any(c in name for c in ["BTC","ETH","LTC","XRP","SOL","BNB","ADA","DOT","DOGE","MATIC","LINK"]):
        crypto.append(name)
    elif any(name.startswith(p) or name.replace("m","") in MAJOR_PAIRS for p in MAJOR_PAIRS):
        forex_majors.append(name)
    elif s.path and "Forex" in s.path:
        forex_other.append(name)
    elif any(x in name for x in ["XAU","XAG","Gold","Silver"]):
        metals.append(name)
    elif any(x in name for x in ["US30","US500","NAS","DAX","FTSE","SPX","NDX"]):
        indices.append(name)
    else:
        other.append(name)

def show(title, lst):
    if lst:
        print(f"\n── {title} ({len(lst)}) ──")
        for i in range(0, len(lst), 6):
            print("  " + "  ".join(f"{x:<14}" for x in lst[i:i+6]))

show("Crypto (m pairs)", sorted(crypto))
show("Forex Majors", sorted(forex_majors))
show("Forex Other", sorted(forex_other))
show("Metals", sorted(metals))
show("Indices", sorted(indices))
show("Other", sorted(other[:40]))  # cap at 40 for readability

print(f"\nTotal: {len(symbols)} symbols")
mt5.shutdown()
