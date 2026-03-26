"""
Target Planner — Math Engine
-----------------------------
analyze_history   : derives trading stats from MT5 closed deals
compute_milestones: generates compounding milestone path
get_kpi_today     : computes actual vs planned for today
"""
from datetime import datetime, timezone
from collections import defaultdict
import math

# ── Sensible defaults when no history exists ────────────────────────────────
DEFAULTS = {
    "win_rate":               0.50,
    "avg_win_ngn":            2000.0,
    "avg_loss_ngn":           1500.0,
    "std_win":                800.0,
    "std_loss":               600.0,
    "avg_trades_per_day":     3.0,
    "marginal_cutoff":        4,
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

    daily = defaultdict(float)
    daily_counts = defaultdict(int)
    for d in deals:
        day = datetime.fromtimestamp(d["time"], tz=timezone.utc).date().isoformat()
        daily[day] += d["profit"]
        daily_counts[day] += 1

    days = sorted(daily.keys())
    pnls = [daily[d] for d in days]

    wins   = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(pnls) if pnls else DEFAULTS["win_rate"]
    avg_win  = sum(wins) / len(wins)     if wins   else DEFAULTS["avg_win_ngn"]
    avg_loss = sum(losses) / len(losses) if losses else -DEFAULTS["avg_loss_ngn"]

    import statistics as _stats
    std_win  = _stats.stdev(wins)   if len(wins)   > 1 else DEFAULTS["std_win"]
    std_loss = _stats.stdev(losses) if len(losses) > 1 else DEFAULTS["std_loss"]

    max_consec = cur_consec = 0
    for p in pnls:
        if p <= 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    count_profit = defaultdict(list)
    for d in days:
        count_profit[daily_counts[d]].append(daily[d])
    avg_by_count = {k: sum(v) / len(v) for k, v in count_profit.items()}
    marginal_cutoff = max(avg_by_count, key=avg_by_count.get) if avg_by_count else DEFAULTS["marginal_cutoff"]

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
    win_rate  = overrides.get("win_rate",     stats["win_rate"])
    avg_win   = overrides.get("avg_win_ngn",  stats["avg_win_ngn"])
    avg_loss  = overrides.get("avg_loss_ngn", stats["avg_loss_ngn"])
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
    pip_val_per_lot = tick_val / point

    milestones = []
    capital = start_ngn

    for _ in range(20):
        if capital >= target_ngn:
            break

        loss_per_lot = (atr / point) * tick_val
        rec_lot = (capital * risk_pct) / loss_per_lot if loss_per_lot > 0 else vol_min
        rec_lot = max(math.floor(rec_lot / vol_step) * vol_step, vol_min)
        rec_lot = round(rec_lot, 8)

        next_lot = rec_lot + vol_step
        capital_for_next = (next_lot * loss_per_lot) / risk_pct
        milestone_end = min(capital_for_next, target_ngn)

        daily_target_ngn = capital * daily_loss_pct * 0.5
        pip_val_at_lot = pip_val_per_lot * rec_lot
        daily_target_pips = daily_target_ngn / pip_val_at_lot if pip_val_at_lot > 0 else 0

        avg_pip_per_trade = daily_target_pips / avg_trades if avg_trades > 0 else 10
        min_trades = math.ceil(daily_target_pips / avg_pip_per_trade) if avg_pip_per_trade > 0 else 1
        max_trades = cutoff

        gain_needed = milestone_end - capital
        scale = rec_lot / vol_min
        eff_win  = avg_win  * scale
        eff_loss = avg_loss * scale
        exp_daily = win_rate * eff_win - (1 - win_rate) * eff_loss

        est_mid = math.ceil(gain_needed / exp_daily) if exp_daily > 0 else 999

        opt_daily  = win_rate * (eff_win + 0.5 * std_win * scale) - (1 - win_rate) * max(eff_loss - 0.5 * std_loss * scale, 1)
        pess_daily = win_rate * max(eff_win - 0.5 * std_win * scale, 1) - (1 - win_rate) * (eff_loss + 0.5 * std_loss * scale)

        est_low  = math.ceil(gain_needed / opt_daily)  if opt_daily  > 0 else 999
        est_high = math.ceil(gain_needed / pess_daily) if pess_daily > 0 else 999

        if low_data:
            mid  = (est_low + est_high) / 2
            half = (est_high - est_low) / 2 * 1.5
            est_low  = max(1, math.floor(mid - half))
            est_high = math.ceil(mid + half)

        margin_per_lot = loss_per_lot * rec_lot
        survival = math.floor((capital * daily_loss_pct) / margin_per_lot) if margin_per_lot > 0 else 99

        milestones.append({
            "capital_start":             round(capital, 2),
            "capital_end":               round(milestone_end, 2),
            "lot_size":                  rec_lot,
            "pair":                      pair_info["symbol"],
            "daily_target_ngn":          round(daily_target_ngn, 2),
            "daily_target_pips":         round(daily_target_pips, 1),
            "min_trades_per_day":        min_trades,
            "max_trades_per_day":        max_trades,
            "est_days_mid":              est_mid,
            "est_days_low":              est_low,
            "est_days_high":             est_high,
            "consecutive_loss_survival": survival,
            "data_quality":              stats["data_quality"],
            "overrides_applied":         list(overrides.keys()),
        })

        capital = milestone_end

    return milestones
