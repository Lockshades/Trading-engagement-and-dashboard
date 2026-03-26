# Target Planner + KPI Tracker — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Build a milestone-based target planner that derives a compounding path from ₦X to ₦Y using trade history, live pair data, and risk rules — plus a daily KPI tracker showing actual vs planned progress.

**Architecture:** Python math engine (`target_planner.py`) feeds two new FastAPI endpoints (`/plan`, `/kpi/today`). React component (`TargetPlanner.jsx`) adds a third tab to the existing dashboard with Path and Daily KPI sub-tabs. All inputs derived from history + live data; user can override individual parameters and must be able to set assumptions manually if no history exists.

**Tech Stack:** Python 3.11, FastAPI, MetaTrader5 API, pytest, React 18, Vite, inline styles only.

---

## No-History Rule

**If MT5 returns fewer than 3 trading days of closed deals, the system must not block the user.**
- Show the override panel as the primary interface (not collapsed)
- Pre-fill with sensible defaults: win_rate=0.50, avg_win=2000, avg_loss=1500, avg_trades=3, marginal_cutoff=4
- Display a banner: "No history yet — using estimated defaults. Adjust to match your expectations."
- All milestone estimates are labelled ESTIMATED, data_quality = "NONE"
- As history accumulates, the system silently replaces defaults with real values

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/target_planner.py` | Create | Math engine: history analysis, milestone generation, KPI calc |
| `backend/api.py` | Modify | Add POST /plan and GET /kpi/today endpoints |
| `src/TargetPlanner.jsx` | Create | Path tab + Daily KPI tab React component |
| `src/RiskScanner.jsx` | Modify | Add "Target" third tab, pass settings as props |
| `tests/test_target_planner.py` | Create | pytest unit tests for math engine |

---

## Task 1 — History Analysis Engine

**File:** Create `backend/target_planner.py`

- [ ] **Step 1: Install pytest**
```
pip install pytest
```

- [ ] **Step 2: Create `tests/test_target_planner.py` with failing tests**
```python
import pytest, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from target_planner import analyze_history, DEFAULTS

SAMPLE_DEALS = [
    {"time": 1705190400, "symbol": "BTCUSDm", "profit": 14992.0, "volume": 0.02},
    {"time": 1705190400, "symbol": "BTCUSDm", "profit":  6242.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit":  3701.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": -5117.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": 18625.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": -5067.0, "volume": 0.01},
    {"time": 1705363200, "symbol": "BTCUSDm", "profit":  -504.0, "volume": 0.01},
    {"time": 1705363200, "symbol": "BTCUSDm", "profit":   102.0, "volume": 0.01},
]

def test_analyze_history_win_rate():
    stats = analyze_history(SAMPLE_DEALS)
    # Day 1: 21234 (win), Day 2: 12142 (win), Day 3: -402 (loss)
    assert stats["win_rate"] == pytest.approx(2/3, rel=0.01)

def test_analyze_history_low_data_warning():
    stats = analyze_history(SAMPLE_DEALS)
    assert stats["low_data_warning"] is True
    assert stats["data_quality"] == "LOW"

def test_analyze_history_no_history_returns_defaults():
    stats = analyze_history([])
    assert stats["no_history"] is True
    assert stats["win_rate"] == DEFAULTS["win_rate"]
    assert stats["avg_win_ngn"] == DEFAULTS["avg_win_ngn"]

def test_analyze_history_consecutive_losses():
    deals = [
        {"time": 1705190400, "profit": -500.0, "volume": 0.01, "symbol": "BTCUSDm"},
        {"time": 1705276800, "profit": -300.0, "volume": 0.01, "symbol": "BTCUSDm"},
        {"time": 1705363200, "profit":  800.0, "volume": 0.01, "symbol": "BTCUSDm"},
    ]
    stats = analyze_history(deals)
    assert stats["max_consecutive_losses"] == 2
```

- [ ] **Step 3: Run tests — confirm they fail**
```
cd "c:\Users\locks\OneDrive\Documents\Trading engagement and dashboard"
python -m pytest tests/test_target_planner.py -v
```
Expected: `ModuleNotFoundError: No module named 'target_planner'`

- [ ] **Step 4: Implement `analyze_history` in `backend/target_planner.py`**
```python
"""
Target Planner — Math Engine
-----------------------------
analyze_history  : derives trading stats from MT5 closed deals
compute_milestones: generates compounding milestone path
get_kpi_today    : computes actual vs planned for today
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from collections import defaultdict
import math

# ── Sensible defaults when no history exists ────────────────────────────────
DEFAULTS = {
    "win_rate":           0.50,
    "avg_win_ngn":        2000.0,
    "avg_loss_ngn":       1500.0,
    "std_win":            800.0,
    "std_loss":           600.0,
    "avg_trades_per_day": 3.0,
    "marginal_cutoff":    4,      # max trades before returns diminish
    "max_consecutive_losses": 2,
}


def analyze_history(deals: list) -> dict:
    """
    Derive trading statistics from a list of MT5 deal dicts.
    Each deal: {time (unix), profit (float), volume (float), symbol (str)}

    Returns a stats dict. If no deals, returns defaults with no_history=True.
    """
    if not deals:
        return {**DEFAULTS, "no_history": True, "low_data_warning": True,
                "data_quality": "NONE", "total_trading_days": 0}

    # Group by date
    daily = defaultdict(float)
    daily_counts = defaultdict(int)
    for d in deals:
        day = datetime.fromtimestamp(d["time"], tz=timezone.utc).date().isoformat()
        daily[day] += d["profit"]
        daily_counts[day] += 1

    days = sorted(daily.keys())
    pnls = [daily[d] for d in days]

    wins  = [p for p in pnls if p > 0]
    losses= [p for p in pnls if p <= 0]

    win_rate  = len(wins) / len(pnls) if pnls else DEFAULTS["win_rate"]
    avg_win   = sum(wins) / len(wins)   if wins   else DEFAULTS["avg_win_ngn"]
    avg_loss  = sum(losses) / len(losses) if losses else -DEFAULTS["avg_loss_ngn"]

    import statistics
    std_win  = statistics.stdev(wins)   if len(wins)   > 1 else DEFAULTS["std_win"]
    std_loss = statistics.stdev(losses) if len(losses) > 1 else DEFAULTS["std_loss"]

    # Max consecutive losses
    max_consec = cur_consec = 0
    for p in pnls:
        if p <= 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    # Marginal cutoff: day trade count where avg profit peaks
    count_profit = defaultdict(list)
    for d in days:
        count_profit[daily_counts[d]].append(daily[d])
    avg_by_count = {k: sum(v)/len(v) for k, v in count_profit.items()}
    if avg_by_count:
        marginal_cutoff = max(avg_by_count, key=avg_by_count.get)
    else:
        marginal_cutoff = DEFAULTS["marginal_cutoff"]

    avg_trades = sum(daily_counts.values()) / len(days) if days else DEFAULTS["avg_trades_per_day"]

    n = len(days)
    data_quality = "NONE" if n == 0 else "LOW" if n < 15 else "MEDIUM" if n < 30 else "HIGH"

    return {
        "win_rate":               win_rate,
        "avg_win_ngn":            avg_win,
        "avg_loss_ngn":           abs(avg_loss),
        "std_win":                std_win,
        "std_loss":               std_loss,
        "avg_trades_per_day":     avg_trades,
        "marginal_cutoff":        marginal_cutoff,
        "max_consecutive_losses": max_consec,
        "total_trading_days":     n,
        "low_data_warning":       n < 15,
        "data_quality":           data_quality,
        "no_history":             False,
    }
```

- [ ] **Step 5: Run tests — confirm they pass**
```
python -m pytest tests/test_target_planner.py -v
```
Expected: 4 PASSED

- [ ] **Step 6: Commit**
```
git add backend/target_planner.py tests/test_target_planner.py
git commit -m "feat: add history analysis engine with no-history fallback"
```

---

## Task 2 — Milestone Generator

**File:** Modify `backend/target_planner.py`

- [ ] **Step 1: Add failing tests to `tests/test_target_planner.py`**
```python
from target_planner import compute_milestones

SAMPLE_STATS = {
    "win_rate": 0.60, "avg_win_ngn": 3000.0, "avg_loss_ngn": 1500.0,
    "std_win": 500.0, "std_loss": 400.0, "avg_trades_per_day": 3.0,
    "marginal_cutoff": 4, "max_consecutive_losses": 2,
    "total_trading_days": 20, "low_data_warning": False,
    "data_quality": "MEDIUM", "no_history": False,
}

SAMPLE_PAIR_INFO = {
    "symbol": "ETHUSDm", "volume_min": 0.1, "volume_step": 0.1,
    "volume_max": 100.0, "trade_tick_value": 160.0, "point": 0.01,
    "atr": 15.0,
}

def test_milestones_start_below_target():
    ms = compute_milestones(100_000, 200_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    assert len(ms) >= 1
    assert ms[-1]["capital_end"] >= 200_000

def test_milestone_lot_increases_with_capital():
    ms = compute_milestones(100_000, 500_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    lots = [m["lot_size"] for m in ms]
    assert lots == sorted(lots)  # lots must be non-decreasing

def test_confidence_band_wider_on_low_data():
    low_stats = {**SAMPLE_STATS, "low_data_warning": True, "data_quality": "LOW"}
    high_stats = {**SAMPLE_STATS, "low_data_warning": False, "data_quality": "HIGH"}
    ms_low  = compute_milestones(100_000, 200_000, low_stats,  SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    ms_high = compute_milestones(100_000, 200_000, high_stats, SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    band_low  = ms_low[0]["est_days_high"]  - ms_low[0]["est_days_low"]
    band_high = ms_high[0]["est_days_high"] - ms_high[0]["est_days_low"]
    assert band_low > band_high

def test_override_win_rate_applied():
    overrides = {"win_rate": 0.80}
    ms_base     = compute_milestones(100_000, 200_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, {},        0.01, 0.02)
    ms_override = compute_milestones(100_000, 200_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, overrides, 0.01, 0.02)
    # Higher win rate -> fewer estimated days
    assert ms_override[0]["est_days_mid"] < ms_base[0]["est_days_mid"]
```

- [ ] **Step 2: Run tests — confirm they fail**
```
python -m pytest tests/test_target_planner.py::test_milestones_start_below_target -v
```
Expected: `ImportError`

- [ ] **Step 3: Implement `compute_milestones` in `backend/target_planner.py`**
```python
def compute_milestones(
    start_ngn: float,
    target_ngn: float,
    stats: dict,
    pair_info: dict,
    overrides: dict,
    risk_pct: float = 0.01,
    daily_loss_pct: float = 0.02,
) -> list:
    """
    Generate milestone list from start_ngn to target_ngn.
    Each milestone = one lot tier increment.
    """
    # Apply overrides
    win_rate  = overrides.get("win_rate",    stats["win_rate"])
    avg_win   = overrides.get("avg_win_ngn", stats["avg_win_ngn"])
    avg_loss  = overrides.get("avg_loss_ngn",stats["avg_loss_ngn"])
    std_win   = stats["std_win"]
    std_loss  = stats["std_loss"]
    cutoff    = int(stats["marginal_cutoff"])
    avg_trades= stats["avg_trades_per_day"]
    low_data  = stats["low_data_warning"]

    vol_min  = pair_info["volume_min"]
    vol_step = pair_info["volume_step"]
    atr      = pair_info["atr"]
    tick_val = pair_info["trade_tick_value"]
    point    = pair_info["point"]
    pip_val_per_lot = tick_val / point  # NGN per pip per 1 lot

    milestones = []
    capital = start_ngn

    # safety cap: max 20 milestones
    for _ in range(20):
        if capital >= target_ngn:
            break

        # Recommended lot at this capital
        loss_per_lot = (atr / point) * tick_val
        rec_lot = (capital * risk_pct) / loss_per_lot if loss_per_lot > 0 else vol_min
        rec_lot = max(math.floor(rec_lot / vol_step) * vol_step, vol_min)
        rec_lot = round(rec_lot, 8)

        # Next lot tier = next milestone end
        next_lot = rec_lot + vol_step
        # Capital needed to unlock next lot tier
        capital_for_next = (next_lot * loss_per_lot) / risk_pct
        milestone_end = min(capital_for_next, target_ngn)

        # Daily target: scale marginal threshold proportionally
        daily_target_ngn = capital * daily_loss_pct * 0.5  # target = 50% of daily limit
        pip_val_at_lot = pip_val_per_lot * rec_lot
        daily_target_pips = daily_target_ngn / pip_val_at_lot if pip_val_at_lot > 0 else 0

        # Trade counts
        avg_pip_per_trade = daily_target_pips / avg_trades if avg_trades > 0 else 10
        min_trades = math.ceil(daily_target_pips / avg_pip_per_trade) if avg_pip_per_trade > 0 else 1
        max_trades = cutoff

        # Capital needed to complete milestone
        gain_needed = milestone_end - capital

        # Expected daily gain = win_rate * avg_win - (1-win_rate) * avg_loss  (scaled to lot)
        scale = rec_lot / vol_min
        eff_win  = avg_win  * scale
        eff_loss = avg_loss * scale
        exp_daily = win_rate * eff_win - (1 - win_rate) * eff_loss

        if exp_daily <= 0:
            est_mid = 999
        else:
            est_mid = math.ceil(gain_needed / exp_daily)

        # Confidence bands
        opt_daily  = (win_rate) * (eff_win + 0.5 * std_win * scale) - (1 - win_rate) * max(eff_loss - 0.5 * std_loss * scale, 1)
        pess_daily = (win_rate) * max(eff_win - 0.5 * std_win * scale, 1) - (1 - win_rate) * (eff_loss + 0.5 * std_loss * scale)

        est_low  = math.ceil(gain_needed / opt_daily)  if opt_daily  > 0 else 999
        est_high = math.ceil(gain_needed / pess_daily) if pess_daily > 0 else 999

        # Widen band if low data
        if low_data:
            mid = (est_low + est_high) / 2
            half = (est_high - est_low) / 2 * 1.5
            est_low  = max(1, math.floor(mid - half))
            est_high = math.ceil(mid + half)

        # Consecutive loss survival
        margin_per_lot = loss_per_lot * rec_lot
        survival = math.floor((capital * daily_loss_pct) / margin_per_lot) if margin_per_lot > 0 else 99

        milestones.append({
            "capital_start":          round(capital, 2),
            "capital_end":            round(milestone_end, 2),
            "lot_size":               rec_lot,
            "pair":                   pair_info["symbol"],
            "daily_target_ngn":       round(daily_target_ngn, 2),
            "daily_target_pips":      round(daily_target_pips, 1),
            "min_trades_per_day":     min_trades,
            "max_trades_per_day":     max_trades,
            "est_days_mid":           est_mid,
            "est_days_low":           est_low,
            "est_days_high":          est_high,
            "consecutive_loss_survival": survival,
            "data_quality":           stats["data_quality"],
            "overrides_applied":      list(overrides.keys()),
        })

        capital = milestone_end

    return milestones
```

- [ ] **Step 4: Run all tests — confirm they pass**
```
python -m pytest tests/test_target_planner.py -v
```
Expected: 8 PASSED

- [ ] **Step 5: Commit**
```
git add backend/target_planner.py tests/test_target_planner.py
git commit -m "feat: add milestone generator with confidence bands and override support"
```

---

## Task 3 — Daily KPI Calculator

**File:** Modify `backend/target_planner.py`

- [ ] **Step 1: Add failing tests**
```python
from target_planner import get_kpi_today
from datetime import date

def _make_deals(profits):
    today_ts = int(datetime.combine(date.today(), datetime.min.time()).timestamp())
    return [{"time": today_ts, "profit": p, "volume": 0.1, "symbol": "ETHUSDm"} for p in profits]

def test_kpi_ahead():
    kpi = get_kpi_today(_make_deals([2000, 1500]), {"daily_target_ngn": 2000, "min_trades_per_day": 2, "max_trades_per_day": 4}, 160.0)
    assert kpi["status"] == "AHEAD"
    assert kpi["actual_ngn"] == 3500

def test_kpi_danger_daily_limit_hit():
    kpi = get_kpi_today(_make_deals([-5000]), {"daily_target_ngn": 2000, "min_trades_per_day": 2, "max_trades_per_day": 4}, 160.0, balance=100_000, daily_loss_pct=0.02)
    assert kpi["status"] == "DANGER"

def test_kpi_trades_remaining():
    kpi = get_kpi_today(_make_deals([1000]), {"daily_target_ngn": 2000, "min_trades_per_day": 2, "max_trades_per_day": 4}, 160.0)
    assert kpi["trades_remaining"] == 3  # max 4 - 1 taken
```

- [ ] **Step 2: Run tests — confirm they fail**

- [ ] **Step 3: Implement `get_kpi_today`**
```python
def get_kpi_today(
    deals_today: list,
    milestone: dict,
    pip_value_ngn: float,
    balance: float = 150_000,
    daily_loss_pct: float = 0.02,
) -> dict:
    actual_ngn   = sum(d["profit"] for d in deals_today)
    trades_taken = len(deals_today)
    actual_pips  = actual_ngn / pip_value_ngn if pip_value_ngn > 0 else 0
    daily_limit  = balance * daily_loss_pct
    target_ngn   = milestone["daily_target_ngn"]
    target_pips  = milestone.get("daily_target_pips", 0)
    max_trades   = milestone["max_trades_per_day"]
    min_trades   = milestone["min_trades_per_day"]

    if actual_ngn <= -daily_limit:
        status = "DANGER"
    elif actual_ngn >= target_ngn:
        status = "COMPLETE" if trades_taken >= min_trades else "AHEAD"
    elif actual_ngn >= target_ngn * 0.8:
        status = "AHEAD"
    elif trades_taken >= min_trades:
        status = "ON_TRACK"
    elif actual_ngn < 0:
        status = "BEHIND"
    else:
        status = "ON_TRACK"

    pct_of_target = (actual_ngn / target_ngn * 100) if target_ngn > 0 else 0

    return {
        "actual_ngn":       round(actual_ngn, 2),
        "actual_pips":      round(actual_pips, 1),
        "target_ngn":       round(target_ngn, 2),
        "target_pips":      round(target_pips, 1),
        "trades_taken":     trades_taken,
        "trades_remaining": max(max_trades - trades_taken, 0),
        "min_trades":       min_trades,
        "max_trades":       max_trades,
        "status":           status,
        "pct_of_target":    round(pct_of_target, 1),
        "daily_limit_ngn":  round(daily_limit, 2),
    }
```

- [ ] **Step 4: Run all tests**
```
python -m pytest tests/test_target_planner.py -v
```
Expected: 11 PASSED

- [ ] **Step 5: Commit**
```
git add backend/target_planner.py tests/test_target_planner.py
git commit -m "feat: add daily KPI calculator with DANGER/AHEAD/BEHIND status"
```

---

## Task 4 — API Endpoints

**File:** Modify `backend/api.py`

- [ ] **Step 1: Add imports and endpoints**

Add to top of `backend/api.py`:
```python
from target_planner import analyze_history, compute_milestones, get_kpi_today
from datetime import datetime, timezone, timedelta
```

Add after the existing `/scan` endpoint:
```python
class PlanRequest(BaseModel):
    target_ngn:     float
    balance:        Optional[float] = None
    daily_loss_pct: Optional[float] = 0.02
    risk_pct:       Optional[float] = 0.01
    overrides:      Optional[dict]  = {}


@app.post("/plan")
def plan(req: PlanRequest):
    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    account        = mt5.account_info()
    bal            = req.balance or (account.balance if account and account.balance > 0 else FALLBACK_BALANCE_NGN)
    daily_loss_pct = req.daily_loss_pct or 0.02
    risk_pct       = req.risk_pct or 0.01

    # Pull last 90 days of history
    date_to   = datetime.now()
    date_from = date_to - timedelta(days=90)
    deals_raw = mt5.history_deals_get(date_from, date_to)
    deals = [d._asdict() for d in deals_raw] if deals_raw else []

    stats = analyze_history(deals)

    # Get best safe pair from watchlist for planning (use ETHUSDm as default)
    plan_symbol = "ETHUSDm"
    info = mt5.symbol_info(plan_symbol)
    if info is None:
        mt5.symbol_select(plan_symbol, True)
        info = mt5.symbol_info(plan_symbol)

    from data_fetcher import calc_atr, BARS, TIMEFRAME
    import numpy as np
    raw = mt5.copy_rates_from_pos(plan_symbol, TIMEFRAME, 0, BARS)
    atr_val = float(calc_atr({"high": raw["high"], "low": raw["low"], "close": raw["close"]})[-1]) if raw is not None else 15.0

    pair_info = {
        "symbol":           plan_symbol,
        "volume_min":       info.volume_min,
        "volume_step":      info.volume_step,
        "volume_max":       info.volume_max,
        "trade_tick_value": info.trade_tick_value,
        "point":            info.point,
        "atr":              atr_val,
    }

    milestones = compute_milestones(bal, req.target_ngn, stats, pair_info, req.overrides or {}, risk_pct, daily_loss_pct)

    mt5.shutdown()
    return {
        "balance_ngn":    bal,
        "target_ngn":     req.target_ngn,
        "milestones":     milestones,
        "history_stats":  stats,
        "pair_info":      pair_info,
        "daily_loss_pct": daily_loss_pct,
        "risk_pct":       risk_pct,
    }


@app.get("/kpi/today")
def kpi_today(balance: float = 150000, daily_loss_pct: float = 0.02, risk_pct: float = 0.01, target_ngn: float = 1000000):
    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    account = mt5.account_info()
    bal = balance if balance > 0 else (account.balance if account and account.balance > 0 else FALLBACK_BALANCE_NGN)

    today_start = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    deals_raw   = mt5.history_deals_get(today_start, datetime.now(tz=timezone.utc))
    deals_today = [d._asdict() for d in deals_raw] if deals_raw else []

    # Get current milestone from plan
    date_from = datetime.now() - timedelta(days=90)
    all_deals_raw = mt5.history_deals_get(date_from, datetime.now())
    all_deals = [d._asdict() for d in all_deals_raw] if all_deals_raw else []
    stats = analyze_history(all_deals)

    info = mt5.symbol_info("ETHUSDm")
    pip_value_ngn = (info.trade_tick_value / info.point) * info.volume_min if info else 160.0

    from data_fetcher import calc_atr, BARS, TIMEFRAME
    raw = mt5.copy_rates_from_pos("ETHUSDm", TIMEFRAME, 0, BARS)
    atr_val = float(calc_atr({"high": raw["high"], "low": raw["low"], "close": raw["close"]})[-1]) if raw is not None else 15.0

    pair_info = {
        "symbol": "ETHUSDm", "volume_min": info.volume_min if info else 0.1,
        "volume_step": info.volume_step if info else 0.1, "volume_max": 100.0,
        "trade_tick_value": info.trade_tick_value if info else 160.0,
        "point": info.point if info else 0.01, "atr": atr_val,
    }

    milestones = compute_milestones(bal, target_ngn, stats, pair_info, {}, risk_pct, daily_loss_pct)
    # Find current milestone (first one not yet complete)
    current_ms = next((m for m in milestones if m["capital_end"] > bal), milestones[-1] if milestones else None)

    kpi = get_kpi_today(deals_today, current_ms or {}, pip_value_ngn, bal, daily_loss_pct) if current_ms else {}

    mt5.shutdown()
    return {
        "date":            datetime.now().date().isoformat(),
        "balance_ngn":     bal,
        "kpi":             kpi,
        "current_milestone": current_ms,
    }
```

- [ ] **Step 2: Restart uvicorn and test endpoints manually**
```
# In browser or curl:
curl -X POST http://localhost:8000/plan \
  -H "Content-Type: application/json" \
  -d '{"target_ngn": 1000000, "balance": 150000}'
```
Expected: JSON with milestones array

- [ ] **Step 3: Commit**
```
git add backend/api.py
git commit -m "feat: add /plan and /kpi/today API endpoints"
```

---

## Task 5 — Frontend: TargetPlanner Component

**File:** Create `src/TargetPlanner.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState, useEffect } from 'react';

const API = 'http://localhost:8000';

const STATUS_COLOURS = {
  AHEAD:    '#22c55e',
  ON_TRACK: '#38bdf8',
  BEHIND:   '#f59e0b',
  DANGER:   '#ef4444',
  COMPLETE: '#a78bfa',
};

const QUALITY_COLOURS = {
  HIGH:   '#22c55e',
  MEDIUM: '#f59e0b',
  LOW:    '#f97316',
  NONE:   '#ef4444',
};

function ConfidenceBand({ low, mid, high }) {
  const max = Math.max(high, 1);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>
        Est. {low}–{high} trading days (midpoint {mid})
      </div>
      <div style={{ position: 'relative', height: 6, background: '#1e1e1e', borderRadius: 4 }}>
        <div style={{
          position: 'absolute',
          left:  `${(low / max) * 100}%`,
          width: `${((high - low) / max) * 100}%`,
          height: '100%',
          background: '#38bdf855',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute',
          left: `${(mid / max) * 100}%`,
          width: 3, height: '100%',
          background: '#38bdf8',
          borderRadius: 2,
        }} />
      </div>
    </div>
  );
}

function MilestoneCard({ ms, index }) {
  const [expanded, setExpanded] = useState(false);
  const qColour = QUALITY_COLOURS[ms.data_quality] || '#888';

  return (
    <div onClick={() => setExpanded(e => !e)} style={{
      background: '#0f1a14', border: '1px solid #22c55e22',
      borderLeft: '3px solid #22c55e44', borderRadius: 8,
      padding: '12px 14px', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#555' }}>M{index + 1}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>
            ₦{ms.capital_start.toLocaleString()} → ₦{ms.capital_end.toLocaleString()}
          </span>
          <span style={{ fontSize: 11, background: '#38bdf822', color: '#38bdf8', border: '1px solid #38bdf844', borderRadius: 4, padding: '1px 7px' }}>
            {ms.lot_size} lot
          </span>
          <span style={{ fontSize: 10, background: qColour + '22', color: qColour, border: `1px solid ${qColour}44`, borderRadius: 4, padding: '1px 6px' }}>
            {ms.data_quality}
          </span>
        </div>
        <span style={{ fontSize: 12, color: '#38bdf8' }}>
          ~{ms.est_days_low}–{ms.est_days_high} days
        </span>
      </div>

      <ConfidenceBand low={ms.est_days_low} mid={ms.est_days_mid} high={ms.est_days_high} />

      {expanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid #1e1e1e', paddingTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            ['Daily NGN target', `₦${ms.daily_target_ngn.toLocaleString(undefined, {maximumFractionDigits:0})}`],
            ['Daily pip target', `${ms.daily_target_pips} pips`],
            ['Min trades/day',   ms.min_trades_per_day],
            ['Max trades/day',   ms.max_trades_per_day],
            ['Survives N losses',ms.consecutive_loss_survival],
            ['Pair',             ms.pair],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginTop: 2 }}>{val}</div>
            </div>
          ))}
          {ms.overrides_applied?.length > 0 && (
            <div style={{ gridColumn: '1/-1', fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
              Manual overrides: {ms.overrides_applied.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KPICard({ label, actual, target, unit, colour }) {
  const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
  return (
    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colour }}>{unit}{actual?.toLocaleString(undefined, {maximumFractionDigits: 1})}</div>
      <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>Target: {unit}{target?.toLocaleString(undefined, {maximumFractionDigits: 1})}</div>
      <div style={{ width: '100%', background: '#1e1e1e', borderRadius: 4, height: 4, marginTop: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: colour, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

export default function TargetPlanner({ settings }) {
  const [subTab, setSubTab]       = useState('path');
  const [targetInput, setTarget]  = useState('');
  const [planData, setPlanData]   = useState(null);
  const [kpiData, setKpiData]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [overrides, setOverrides] = useState({});
  const [showOverrides, setShowOverrides] = useState(false);

  const fetchPlan = async () => {
    if (!targetInput || Number(targetInput) <= Number(settings?.balance || 150000)) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_ngn:     Number(targetInput),
          balance:        Number(settings?.balance || 150000),
          daily_loss_pct: Number(settings?.dailyLossPct || 2) / 100,
          risk_pct:       Number(settings?.riskPct || 1) / 100,
          overrides,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPlanData(json);
      if (json.history_stats?.no_history) setShowOverrides(true);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const fetchKPI = async () => {
    setKpiLoading(true);
    try {
      const params = new URLSearchParams({
        balance:        settings?.balance || 150000,
        daily_loss_pct: (settings?.dailyLossPct || 2) / 100,
        risk_pct:       (settings?.riskPct || 1) / 100,
        target_ngn:     targetInput || 1000000,
      });
      const res  = await fetch(`${API}/kpi/today?${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setKpiData(json);
    } catch (e) { setError(e.message); }
    finally { setKpiLoading(false); }
  };

  useEffect(() => { if (subTab === 'kpi') fetchKPI(); }, [subTab]);

  const SUB_TAB = (active) => ({
    background: 'transparent', color: active ? '#f0f0f0' : '#555',
    border: 'none', borderBottom: `2px solid ${active ? '#38bdf8' : 'transparent'}`,
    padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  });

  const noHistory = planData?.history_stats?.no_history;
  const dataQuality = planData?.history_stats?.data_quality;

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', marginBottom: 20, gap: 4 }}>
        <button style={SUB_TAB(subTab === 'path')} onClick={() => setSubTab('path')}>Path</button>
        <button style={SUB_TAB(subTab === 'kpi')}  onClick={() => setSubTab('kpi')}>Daily KPI</button>
      </div>

      {/* PATH TAB */}
      {subTab === 'path' && (
        <div>
          {/* Target input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <span style={{ fontSize: 13, color: '#888' }}>Target</span>
            <span style={{ fontSize: 13, color: '#666' }}>₦</span>
            <input
              type="number" placeholder="1000000" value={targetInput}
              onChange={e => setTarget(e.target.value)}
              style={{ background: '#111', border: '1px solid #333', color: '#e0e0e0', borderRadius: 6, padding: '7px 12px', fontSize: 14, width: 160 }}
            />
            <button onClick={fetchPlan} disabled={loading || !targetInput} style={{
              background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e',
              borderRadius: 6, padding: '7px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>
              {loading ? 'Planning…' : 'Generate Plan'}
            </button>
          </div>

          {/* No-history banner */}
          {noHistory && (
            <div style={{ background: '#1a1200', border: '1px solid #f59e0b55', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f59e0b' }}>
              No trade history found — using estimated defaults. Adjust the overrides below to match your expectations.
            </div>
          )}

          {/* Data quality banner */}
          {dataQuality === 'LOW' && !noHistory && (
            <div style={{ background: '#1a1200', border: '1px solid #f9731655', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f97316' }}>
              Only {planData.history_stats.total_trading_days} trading days of history. Estimates are approximate — confidence bands are widened to reflect this.
            </div>
          )}

          {/* Overrides panel */}
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setShowOverrides(o => !o)} style={{
              background: 'transparent', color: '#555', border: '1px solid #2a2a2a',
              borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 11,
            }}>
              {showOverrides ? '▾' : '▸'} Manual overrides {Object.keys(overrides).length > 0 ? `(${Object.keys(overrides).length} active)` : ''}
            </button>
            {showOverrides && (
              <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px', marginTop: 8, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {[
                  { key: 'win_rate', label: 'Win Rate', suffix: '%', scale: 100, min: 10, max: 90, step: 5, default: 50 },
                  { key: 'avg_win_ngn', label: 'Avg Win (NGN)', suffix: '', scale: 1, min: 500, max: 20000, step: 500, default: 2000 },
                  { key: 'avg_loss_ngn', label: 'Avg Loss (NGN)', suffix: '', scale: 1, min: 200, max: 10000, step: 200, default: 1500 },
                ].map(({ key, label, suffix, scale, min, max, step, default: def }) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: '#aaa' }}>{label} <span style={{ color: '#444' }}>(manual)</span></label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        value={overrides[key] !== undefined ? overrides[key] * scale : def}
                        min={min} max={max} step={step}
                        onChange={e => setOverrides(prev => ({ ...prev, [key]: Number(e.target.value) / scale }))}
                        style={{ width: 90, background: '#0a0a0a', border: '1px solid #f59e0b55', color: '#f59e0b', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                      />
                      {suffix && <span style={{ fontSize: 11, color: '#666' }}>{suffix}</span>}
                      {overrides[key] !== undefined && (
                        <button onClick={(e) => { e.stopPropagation(); setOverrides(prev => { const n={...prev}; delete n[key]; return n; }); }}
                          style={{ fontSize: 10, color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>✕</button>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ alignSelf: 'flex-end' }}>
                  <button onClick={fetchPlan} style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 11 }}>
                    Recalculate
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {/* Milestone cards */}
          {planData?.milestones?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#444', marginBottom: 4 }}>
                {planData.milestones.length} milestone{planData.milestones.length !== 1 ? 's' : ''} to reach ₦{Number(targetInput).toLocaleString()} — click to expand
              </div>
              {planData.milestones.map((ms, i) => <MilestoneCard key={i} ms={ms} index={i} />)}
            </div>
          )}
        </div>
      )}

      {/* DAILY KPI TAB */}
      {subTab === 'kpi' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: '#555' }}>{new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
            <button onClick={fetchKPI} disabled={kpiLoading} style={{
              background: '#1e1e1e', color: '#e0e0e0', border: '1px solid #333',
              borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 11,
            }}>
              {kpiLoading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {kpiData?.kpi && (() => {
            const k = kpiData.kpi;
            const statusColour = STATUS_COLOURS[k.status] || '#888';
            return (
              <>
                {/* Status banner */}
                <div style={{
                  background: statusColour + '15', border: `1px solid ${statusColour}44`,
                  borderRadius: 8, padding: '10px 16px', marginBottom: 16,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 700, color: statusColour, fontSize: 14 }}>{k.status}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{k.pct_of_target}% of daily target</span>
                </div>

                {/* KPI cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                  <KPICard label="P&L Today"    actual={k.actual_ngn}  target={k.target_ngn}  unit="₦" colour={k.actual_ngn >= 0 ? '#22c55e' : '#ef4444'} />
                  <KPICard label="Pips Today"   actual={k.actual_pips} target={k.target_pips} unit=""  colour="#38bdf8" />
                </div>

                {/* Trade counter */}
                <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Trades</div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    {[
                      ['Taken',     k.trades_taken,     '#f0f0f0'],
                      ['Remaining', k.trades_remaining, '#38bdf8'],
                      ['Min',       k.min_trades,       '#22c55e'],
                      ['Max',       k.max_trades,       '#f59e0b'],
                    ].map(([label, val, colour]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: '#555' }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: colour }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Daily limit warning */}
                {k.status === 'DANGER' && (
                  <div style={{ marginTop: 12, background: '#2a0d0d', border: '1px solid #ef444455', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12 }}>
                    Daily loss limit reached (₦{kpiData.balance_ngn?.toLocaleString()} × {(kpiData.kpi?.daily_limit_ngn / kpiData.balance_ngn * 100).toFixed(0)}%). Stop trading for today.
                  </div>
                )}
              </>
            );
          })()}

          {!kpiData && !kpiLoading && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Set your target in the Path tab first, then refresh KPI.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```
git add src/TargetPlanner.jsx
git commit -m "feat: add TargetPlanner component with Path and Daily KPI tabs"
```

---

## Task 6 — Dashboard Integration

**File:** Modify `src/RiskScanner.jsx`

- [ ] **Step 1: Add import and Target tab**

At the top of `src/RiskScanner.jsx`, add:
```jsx
import TargetPlanner from './TargetPlanner';
```

In the tab bar (after the Settings button):
```jsx
<button style={TAB_STYLE(tab === 'target')} onClick={() => setTab('target')}>Target</button>
```

In the render section, after the Settings tab block:
```jsx
{tab === 'target' && (
  <TargetPlanner settings={settings} />
)}
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173`. You should see three tabs: Scanner | ⚙ Settings | Target.

Click Target → Path sub-tab → enter a target (e.g. 1000000) → Generate Plan.

- [ ] **Step 3: Commit**
```
git add src/RiskScanner.jsx
git commit -m "feat: integrate TargetPlanner as third dashboard tab"
```

---

## Done

All 6 tasks complete. The Target Planner:
- Derives everything from history automatically
- Falls back to editable defaults when no history exists (no UX blocking)
- Shows confidence bands that widen with thin data
- Daily KPI tab shows live actual vs planned
- All settings (balance, risk%, daily loss%) flow from the shared Settings tab
