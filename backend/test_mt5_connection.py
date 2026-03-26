"""
MT5 Connection Test
-------------------
Run this while MT5 terminal is open.
It will print what data is accessible from Python.
"""

import MetaTrader5 as mt5
from datetime import datetime
import sys

def section(title):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print(f"{'='*50}")

# ── 1. CONNECT ──────────────────────────────────────
section("1. Connecting to MT5")
if not mt5.initialize():
    print(f"FAILED: {mt5.last_error()}")
    print("Make sure MT5 is open and logged in.")
    sys.exit(1)
print("Connected OK")

# ── 2. ACCOUNT INFO ─────────────────────────────────
section("2. Account Info")
account = mt5.account_info()
if account:
    print(f"  Login      : {account.login}")
    print(f"  Broker     : {account.company}")
    print(f"  Currency   : {account.currency}")
    print(f"  Balance    : {account.balance:,.2f}")
    print(f"  Equity     : {account.equity:,.2f}")
    print(f"  Leverage   : 1:{account.leverage}")
else:
    print(f"  Could not fetch account info: {mt5.last_error()}")

# ── 3. AVAILABLE SYMBOLS ────────────────────────────
section("3. Available Symbols (first 30)")
symbols = mt5.symbols_get()
if symbols:
    print(f"  Total symbols available: {len(symbols)}")
    for s in symbols[:30]:
        print(f"  - {s.name}")
else:
    print(f"  No symbols: {mt5.last_error()}")

# ── 4. TEST A SPECIFIC SYMBOL ───────────────────────
# Change this to any symbol you actively trade
TEST_SYMBOL = "BTCUSDm"

section(f"4. Symbol Info: {TEST_SYMBOL}")
info = mt5.symbol_info(TEST_SYMBOL)
if info:
    print(f"  Spread          : {info.spread} points")
    print(f"  Point value     : {info.point}")
    print(f"  Contract size   : {info.trade_contract_size}")
    print(f"  Volume min      : {info.volume_min}")
    print(f"  Volume step     : {info.volume_step}")
    print(f"  Bid             : {info.bid}")
    print(f"  Ask             : {info.ask}")
else:
    print(f"  Symbol not found. Try another name from the list above.")

# ── 5. OHLC + TICK VOLUME (last 10 H1 candles) ──────
section(f"5. Last 10 H1 Candles for {TEST_SYMBOL}")
import numpy as np
rates = mt5.copy_rates_from_pos(TEST_SYMBOL, mt5.TIMEFRAME_H1, 0, 10)
if rates is not None and len(rates) > 0:
    print(f"  {'Time':<22} {'Open':>10} {'High':>10} {'Low':>10} {'Close':>10} {'TickVol':>10}")
    for r in rates:
        t = datetime.fromtimestamp(r['time']).strftime('%Y-%m-%d %H:%M')
        print(f"  {t:<22} {r['open']:>10.2f} {r['high']:>10.2f} {r['low']:>10.2f} {r['close']:>10.2f} {r['tick_volume']:>10}")
else:
    print(f"  No candle data: {mt5.last_error()}")

# ── 6. TRADE HISTORY (last 30 days) ─────────────────
section("6. Closed Trades (last 30 days)")
from datetime import timedelta
date_to   = datetime.now()
date_from = date_to - timedelta(days=30)
deals = mt5.history_deals_get(date_from, date_to)
if deals and len(deals) > 0:
    print(f"  Total deals found: {len(deals)}")
    print(f"  Columns available: {deals[0]._asdict().keys()}")
else:
    print(f"  No deals found (or no history): {mt5.last_error()}")

# ── DONE ────────────────────────────────────────────
section("Done")
mt5.shutdown()
print("Connection closed cleanly.\n")
