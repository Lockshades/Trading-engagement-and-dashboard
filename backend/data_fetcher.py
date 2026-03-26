"""
MT5 Risk Data Fetcher
---------------------
Pulls all 5 risk dimensions for any symbol and returns a structured scorecard.

Dimensions:
  1. SD Position      — how far price is from its mean (z-score)
  2. Trend Strength   — ADX-based trend detection
  3. Spike Volatility — current ATR vs historical ATR average
  4. Liquidity        — spread % + tick volume
  5. Capital Exposure — recommended lot size to risk exactly 1% of balance on a 1-ATR stop.
                        If recommended lot < minimum lot, the pair is too large for the account.

Usage:
  python data_fetcher.py                  # scores BTCUSDm and ETHUSDm
  python data_fetcher.py BTCUSDm ETHUSDm SOLUSDm
"""

import MetaTrader5 as mt5
import numpy as np
import sys
from datetime import datetime

# ── CONFIG ──────────────────────────────────────────────────────────────────
BARS          = 200          # lookback window for SD and trend
ATR_PERIOD    = 14           # ATR smoothing period
ADX_PERIOD    = 14           # ADX smoothing period
TIMEFRAME     = mt5.TIMEFRAME_H1

# Daily loss limit as % of balance (from your strategy: 2%)
DAILY_LOSS_PCT = 0.02

# Risk per trade as % of balance (from your strategy: 1%)
RISK_PER_TRADE_PCT = 0.01

# Fallback balance if MT5 shows 0 (e.g. unfunded sub-account)
FALLBACK_BALANCE_NGN = 150_000.0

# Gate thresholds — any RED here = pair classified RISKY
GATES = {
    "sd_position":     {"amber": 1.5,  "red": 2.5},   # z-score
    "trend_strength":  {"amber": 20.0, "red": 35.0},  # ADX
    "volatility":      {"amber": 1.5,  "red": 2.5},   # ATR ratio vs avg
    "liquidity_spread":{"amber": 0.05, "red": 0.15},  # spread as % of price
}

# Score weights (must sum to 1.0)
WEIGHTS = {
    "capital_exposure": 0.30,
    "liquidity":        0.25,
    "sd_position":      0.20,
    "trend_strength":   0.15,
    "volatility":       0.10,
}

SCORE_MAP = {"GREEN": 100, "AMBER": 60, "RED": 0}


# ── HELPERS ─────────────────────────────────────────────────────────────────

def rate_value(value, thresholds, invert=False):
    """Rate a value GREEN / AMBER / RED. invert=True means higher is better."""
    lo, hi = thresholds["amber"], thresholds["red"]
    if not invert:
        if value < lo:  return "GREEN"
        if value < hi:  return "AMBER"
        return "RED"
    else:
        if value > lo:  return "GREEN"
        if value > hi:  return "AMBER"
        return "RED"


def calc_atr(rates, period=ATR_PERIOD):
    """Average True Range using Wilder smoothing."""
    high  = rates["high"]
    low   = rates["low"]
    close = rates["close"]
    tr = np.maximum(
        high[1:] - low[1:],
        np.maximum(
            np.abs(high[1:] - close[:-1]),
            np.abs(low[1:]  - close[:-1])
        )
    )
    atr = np.zeros(len(tr))
    atr[period - 1] = tr[:period].mean()
    for i in range(period, len(tr)):
        atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period
    return atr[period - 1:]


def calc_adx(rates, period=ADX_PERIOD):
    """Average Directional Index (ADX)."""
    high  = rates["high"]
    low   = rates["low"]
    close = rates["close"]

    tr = np.maximum(
        high[1:] - low[1:],
        np.maximum(
            np.abs(high[1:] - close[:-1]),
            np.abs(low[1:]  - close[:-1])
        )
    )
    up   = high[1:] - high[:-1]
    down = low[:-1] - low[1:]

    dm_plus  = np.where((up > down) & (up > 0), up, 0.0)
    dm_minus = np.where((down > up) & (down > 0), down, 0.0)

    def wilder(arr, p):
        out = np.zeros(len(arr))
        out[p-1] = arr[:p].mean()
        for i in range(p, len(arr)):
            out[i] = (out[i-1] * (p-1) + arr[i]) / p
        return out[p-1:]

    atr_s   = wilder(tr, period)
    dip_s   = wilder(dm_plus, period)
    dim_s   = wilder(dm_minus, period)

    di_plus  = 100 * dip_s / (atr_s + 1e-10)
    di_minus = 100 * dim_s / (atr_s + 1e-10)
    dx       = 100 * np.abs(di_plus - di_minus) / (di_plus + di_minus + 1e-10)

    adx = wilder(dx, period)
    return float(adx[-1])


# ── DIMENSION CALCULATORS ────────────────────────────────────────────────────

def dim_sd_position(rates):
    close = rates["close"]
    mean  = close.mean()
    std   = close.std()
    z     = abs((close[-1] - mean) / (std + 1e-10))
    label = rate_value(z, GATES["sd_position"])
    return {
        "value": round(float(z), 3),
        "label": label,
        "description": f"Price is {z:.2f}s from {BARS}-bar mean  (mean={mean:.2f}, std={std:.2f})"
    }


def dim_trend_strength(rates, adx_gate=None):
    adx   = calc_adx(rates)
    gate  = adx_gate or GATES["trend_strength"]
    label = rate_value(adx, gate)
    return {
        "value": round(adx, 2),
        "label": label,
        "description": f"ADX={adx:.1f}  ({'strong' if adx>35 else 'moderate' if adx>20 else 'weak/ranging'} trend)"
    }


def dim_volatility(rates):
    atr_series = calc_atr(rates)
    current    = atr_series[-1]
    avg        = atr_series.mean()
    ratio      = current / (avg + 1e-10)
    label      = rate_value(ratio, GATES["volatility"])
    return {
        "value": round(float(ratio), 3),
        "label": label,
        "description": f"Current ATR={current:.2f}  avg ATR={avg:.2f}  ratio={ratio:.2f}x",
        "atr_current": round(float(current), 4),
    }


def dim_liquidity(info, rates):
    mid         = (info.bid + info.ask) / 2 if info.bid > 0 else float(rates["close"][-1])
    spread_pct  = (info.spread * info.point) / (mid + 1e-10) * 100
    avg_tickvol = float(rates["tick_volume"].mean())

    spread_label = rate_value(spread_pct, GATES["liquidity_spread"])
    vol_label    = "GREEN" if avg_tickvol > 1000 else "AMBER" if avg_tickvol > 300 else "RED"
    order = ["RED", "AMBER", "GREEN"]
    label = order[min(order.index(spread_label), order.index(vol_label))]

    return {
        "value": round(spread_pct, 4),
        "label": label,
        "description": f"Spread={spread_pct:.4f}% of price  |  avg tick vol={avg_tickvol:.0f}",
        "spread_pct": round(spread_pct, 4),
        "avg_tick_volume": round(avg_tickvol, 1),
        "spread_label": spread_label,
        "volume_label": vol_label,
    }


def dim_capital_exposure(info, rates, balance_ngn, risk_pct=0.01, daily_loss_pct=0.02):
    """
    Recommended lot size to risk exactly 1% of balance on a 1-ATR stop.
    Gate: RED if recommended lot < minimum lot (pair is too large for the account).
          AMBER if tradeable but very tight (rec lot < 3x minimum).
          GREEN if comfortably tradeable.
    """
    atr_series  = calc_atr(rates)
    atr_current = float(atr_series[-1])

    risk_per_trade = balance_ngn * risk_pct
    daily_limit    = balance_ngn * daily_loss_pct

    tick_value_ngn = info.trade_tick_value
    ticks_per_atr  = atr_current / (info.point + 1e-10)
    loss_per_lot   = ticks_per_atr * tick_value_ngn  # NGN loss per 1-ATR move at 1 lot

    if loss_per_lot > 0:
        recommended_lot = risk_per_trade / loss_per_lot
    else:
        recommended_lot = info.volume_min

    step = info.volume_step if info.volume_step > 0 else 0.01
    recommended_lot = max(round(int(recommended_lot / step) * step, 8), 0.0)

    tradeable = recommended_lot >= info.volume_min

    if not tradeable:
        label = "RED"
    elif recommended_lot < info.volume_min * 3:
        label = "AMBER"
    else:
        label = "GREEN"

    effective_lot = recommended_lot if tradeable else info.volume_min
    loss_at_effective = effective_lot * loss_per_lot

    return {
        "value": round(recommended_lot, 4),
        "label": label,
        "tradeable": tradeable,
        "recommended_lot": round(recommended_lot, 4),
        "min_lot": info.volume_min,
        "loss_at_recommended_ngn": round(loss_at_effective, 2),
        "daily_limit_ngn": round(daily_limit, 2),
        "atr": round(atr_current, 4),
        "description": (
            f"Rec. lot: {recommended_lot:.4f}  (min: {info.volume_min})  "
            + ("OK to trade" if tradeable else "BELOW MIN — pair too large for account")
            + f"  |  1% risk ({risk_per_trade:,.0f}) at stop: {loss_at_effective:,.0f}"
        ),
    }


# ── MAIN SCORER ─────────────────────────────────────────────────────────────

def score_symbol(symbol: str, balance_ngn: float, adx_gate: dict = None, risk_pct: float = 0.01, daily_loss_pct: float = 0.02) -> dict:
    info = mt5.symbol_info(symbol)
    if info is None:
        return {"symbol": symbol, "error": f"Symbol not found: {mt5.last_error()}"}

    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)

    raw = mt5.copy_rates_from_pos(symbol, TIMEFRAME, 0, BARS)
    if raw is None or len(raw) < 50:
        return {"symbol": symbol, "error": "Not enough candle data"}

    rates = {
        "open":        raw["open"],
        "high":        raw["high"],
        "low":         raw["low"],
        "close":       raw["close"],
        "tick_volume": raw["tick_volume"],
    }

    display_price = info.bid if info.bid > 0 else float(raw["close"][-1])

    dims = {
        "sd_position":      dim_sd_position(rates),
        "trend_strength":   dim_trend_strength(rates, adx_gate=adx_gate),
        "volatility":       dim_volatility(rates),
        "liquidity":        dim_liquidity(info, rates),
        "capital_exposure": dim_capital_exposure(info, rates, balance_ngn, risk_pct=risk_pct, daily_loss_pct=daily_loss_pct),
    }

    red_flags  = [k for k, v in dims.items() if v["label"] == "RED"]
    gate_pass  = len(red_flags) == 0

    score = sum(
        SCORE_MAP[dims[k]["label"]] * w
        for k, w in WEIGHTS.items()
    )

    classification = "SAFE"     if gate_pass and score >= 70 \
                else "MODERATE" if gate_pass \
                else "RISKY"

    return {
        "symbol":         symbol,
        "price":          display_price,
        "timestamp":      datetime.now().isoformat(timespec="seconds"),
        "dimensions":     dims,
        "gate_pass":      gate_pass,
        "red_flags":      red_flags,
        "score":          round(score, 1),
        "classification": classification,
    }


# ── DISPLAY ──────────────────────────────────────────────────────────────────

LABEL_COLOUR = {"GREEN": "[G]", "AMBER": "[A]", "RED": "[R]"}
CLASS_COLOUR  = {"SAFE": "SAFE", "MODERATE": "MODERATE", "RISKY": "RISKY"}

def print_scorecard(result):
    if "error" in result:
        print(f"\n  {result['symbol']}: ERROR -- {result['error']}")
        return

    print(f"\n{'--'*30}")
    print(f"  {result['symbol']}  |  Price: {result['price']:,.2f}  |  {result['timestamp']}")
    print(f"  Classification: {CLASS_COLOUR[result['classification']]}   Score: {result['score']}/100")
    if result["red_flags"]:
        print(f"  Gate FAILED on: {', '.join(result['red_flags'])}")
    print()

    dim_labels = {
        "sd_position":      "SD Position     ",
        "trend_strength":   "Trend Strength  ",
        "volatility":       "Spike Volatility",
        "liquidity":        "Liquidity       ",
        "capital_exposure": "Capital Exposure",
    }
    for key, label in dim_labels.items():
        d = result["dimensions"][key]
        icon = LABEL_COLOUR[d["label"]]
        print(f"  {icon} {label}  {d['description']}")


# ── ENTRY POINT ──────────────────────────────────────────────────────────────

def main():
    symbols = sys.argv[1:] if len(sys.argv) > 1 else ["BTCUSDm", "ETHUSDm"]

    if not mt5.initialize():
        print(f"MT5 connection failed: {mt5.last_error()}")
        sys.exit(1)

    account = mt5.account_info()
    balance = account.balance if account and account.balance > 0 else FALLBACK_BALANCE_NGN
    if account and account.balance == 0:
        print(f"Balance is 0 -- using fallback {FALLBACK_BALANCE_NGN:,.0f} for capital exposure calc")

    print(f"\nBalance used: {balance:,.2f}  |  Daily loss limit: {balance * DAILY_LOSS_PCT:,.2f}")
    print(f"Scoring {len(symbols)} symbol(s)...")

    results = []
    for sym in symbols:
        r = score_symbol(sym, balance)
        print_scorecard(r)
        results.append(r)

    safe = sorted([r for r in results if r.get("classification") != "RISKY"],
                  key=lambda x: x["score"], reverse=True)
    if safe:
        print(f"\n{'--'*30}")
        print("  RANKING (safe/moderate pairs by score):")
        for i, r in enumerate(safe, 1):
            print(f"  {i}. {r['symbol']:<14} {r['score']}/100  [{r['classification']}]")

    mt5.shutdown()


if __name__ == "__main__":
    main()
