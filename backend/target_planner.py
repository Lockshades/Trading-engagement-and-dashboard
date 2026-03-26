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
