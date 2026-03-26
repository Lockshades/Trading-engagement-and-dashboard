"""
Target Planner - Math Engine
----------------------------
analyze_history: derives trading stats from MT5 closed deals
compute_milestones: generates compounding milestone path
get_kpi_today: computes actual vs planned for today
"""

from collections import defaultdict
from datetime import datetime, timezone
import math
import statistics as _stats


DEFAULTS = {
    "win_rate": 0.50,
    "avg_win_ngn": 2000.0,
    "avg_loss_ngn": 1500.0,
    "std_win": 800.0,
    "std_loss": 600.0,
    "avg_trades_per_day": 3.0,
    "marginal_cutoff": 4,
    "max_consecutive_losses": 2,
}


def analyze_history(deals: list) -> dict:
    """
    Derive trading statistics from a list of MT5 deal dicts.
    Each deal: {time (unix), profit (float), volume (float), symbol (str)}
    Returns a stats dict. If no deals, returns defaults with no_history=True.
    """
    if not deals:
        return {
            **DEFAULTS,
            "no_history": True,
            "low_data_warning": True,
            "data_quality": "NONE",
            "total_trading_days": 0,
        }

    daily = defaultdict(float)
    daily_counts = defaultdict(int)
    for deal in deals:
        day = datetime.fromtimestamp(deal["time"], tz=timezone.utc).date().isoformat()
        daily[day] += deal["profit"]
        daily_counts[day] += 1

    days = sorted(daily.keys())
    pnls = [daily[day] for day in days]

    wins = [pnl for pnl in pnls if pnl > 0]
    losses = [pnl for pnl in pnls if pnl <= 0]

    win_rate = len(wins) / len(pnls) if pnls else DEFAULTS["win_rate"]
    avg_win = sum(wins) / len(wins) if wins else DEFAULTS["avg_win_ngn"]
    avg_loss = sum(losses) / len(losses) if losses else -DEFAULTS["avg_loss_ngn"]

    std_win = _stats.stdev(wins) if len(wins) > 1 else DEFAULTS["std_win"]
    std_loss = _stats.stdev(losses) if len(losses) > 1 else DEFAULTS["std_loss"]

    max_consec = 0
    cur_consec = 0
    for pnl in pnls:
        if pnl <= 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    count_profit = defaultdict(list)
    for day in days:
        count_profit[daily_counts[day]].append(daily[day])

    avg_by_count = {
        trade_count: sum(values) / len(values)
        for trade_count, values in count_profit.items()
    }
    marginal_cutoff = (
        max(avg_by_count, key=avg_by_count.get)
        if avg_by_count
        else DEFAULTS["marginal_cutoff"]
    )

    avg_trades = (
        sum(daily_counts.values()) / len(days)
        if days
        else DEFAULTS["avg_trades_per_day"]
    )

    total_days = len(days)
    data_quality = (
        "NONE" if total_days == 0
        else "LOW" if total_days < 15
        else "MEDIUM" if total_days < 30
        else "HIGH"
    )

    return {
        "win_rate": win_rate,
        "avg_win_ngn": avg_win,
        "avg_loss_ngn": abs(avg_loss),
        "std_win": std_win,
        "std_loss": std_loss,
        "avg_trades_per_day": avg_trades,
        "marginal_cutoff": marginal_cutoff,
        "max_consecutive_losses": max_consec,
        "total_trading_days": total_days,
        "low_data_warning": total_days < 15,
        "data_quality": data_quality,
        "no_history": False,
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
    Each milestone represents one lot-tier increment.
    """
    if start_ngn >= target_ngn:
        return []

    win_rate = overrides.get("win_rate", stats["win_rate"])
    avg_win = overrides.get("avg_win_ngn", stats["avg_win_ngn"])
    avg_loss = overrides.get("avg_loss_ngn", stats["avg_loss_ngn"])
    std_win = stats["std_win"]
    std_loss = stats["std_loss"]
    cutoff = max(int(stats["marginal_cutoff"]), 1)
    avg_trades = stats["avg_trades_per_day"]
    low_data = stats["low_data_warning"]

    vol_min = max(pair_info["volume_min"], 0.01)
    vol_step = max(pair_info["volume_step"], 0.01)
    vol_max = max(pair_info.get("volume_max", vol_min), vol_min)
    atr = max(pair_info["atr"], 0.0)
    tick_val = max(pair_info["trade_tick_value"], 0.0)
    point = max(pair_info["point"], 1e-10)
    pip_val_per_lot = tick_val / point if point > 0 else 0.0

    milestones = []
    capital = start_ngn

    for _ in range(20):
        if capital >= target_ngn:
            break

        loss_per_lot = (atr / point) * tick_val if point > 0 else 0.0
        raw_lot = (capital * risk_pct) / loss_per_lot if loss_per_lot > 0 else vol_min
        min_units = max(int(math.ceil((vol_min - 1e-12) / vol_step)), 1)
        max_units = max(int(math.floor((vol_max + 1e-12) / vol_step)), min_units)
        lot_units = max(int(math.floor((raw_lot + 1e-12) / vol_step)), min_units)
        lot_units = min(lot_units, max_units)
        rec_lot = round(lot_units * vol_step, 8)

        at_max_lot = lot_units >= max_units
        next_lot = rec_lot if at_max_lot else round((lot_units + 1) * vol_step, 8)
        capital_for_next = (next_lot * loss_per_lot) / risk_pct if risk_pct > 0 else target_ngn
        milestone_end = target_ngn if at_max_lot else min(capital_for_next, target_ngn)
        if milestone_end <= capital:
            break

        daily_target_ngn = capital * daily_loss_pct * 0.5
        pip_val_at_lot = pip_val_per_lot * rec_lot
        daily_target_pips = daily_target_ngn / pip_val_at_lot if pip_val_at_lot > 0 else 0.0

        avg_pip_per_trade = daily_target_pips / avg_trades if avg_trades > 0 else 10.0
        min_trades = math.ceil(daily_target_pips / avg_pip_per_trade) if avg_pip_per_trade > 0 else 1
        max_trades = cutoff

        gain_needed = milestone_end - capital
        scale = rec_lot / vol_min
        eff_win = avg_win * scale
        eff_loss = avg_loss * scale
        exp_daily = win_rate * eff_win - (1 - win_rate) * eff_loss

        est_mid = math.ceil(gain_needed / exp_daily) if exp_daily > 0 else 999

        opt_daily = (
            win_rate * (eff_win + 0.5 * std_win * scale)
            - (1 - win_rate) * max(eff_loss - 0.5 * std_loss * scale, 1)
        )
        pess_daily = (
            win_rate * max(eff_win - 0.5 * std_win * scale, 1)
            - (1 - win_rate) * (eff_loss + 0.5 * std_loss * scale)
        )

        est_low = math.ceil(gain_needed / opt_daily) if opt_daily > 0 else 999
        est_high = math.ceil(gain_needed / pess_daily) if pess_daily > 0 else 999

        if low_data:
            mid = (est_low + est_high) / 2
            half = (est_high - est_low) / 2 * 1.5
            est_low = max(1, math.floor(mid - half))
            est_high = math.ceil(mid + half)

        margin_per_lot = loss_per_lot * rec_lot
        survival = math.floor((capital * daily_loss_pct) / margin_per_lot) if margin_per_lot > 0 else 99

        milestones.append({
            "capital_start": round(capital, 2),
            "capital_end": round(milestone_end, 2),
            "lot_size": rec_lot,
            "pair": pair_info["symbol"],
            "daily_target_ngn": round(daily_target_ngn, 2),
            "daily_target_pips": round(daily_target_pips, 1),
            "min_trades_per_day": min_trades,
            "max_trades_per_day": max_trades,
            "est_days_mid": est_mid,
            "est_days_low": est_low,
            "est_days_high": est_high,
            "consecutive_loss_survival": survival,
            "data_quality": stats["data_quality"],
            "lot_capped": at_max_lot,
            "overrides_applied": list(overrides.keys()),
        })

        capital = milestone_end

    return milestones


def get_kpi_today(
    deals_today: list,
    milestone: dict,
    pip_value_ngn: float,
    balance: float = 150_000,
    daily_loss_pct: float = 0.02,
) -> dict:
    actual_ngn = sum(float(deal.get("profit", 0.0)) for deal in deals_today)
    trades_taken = len(deals_today)
    actual_pips = actual_ngn / pip_value_ngn if pip_value_ngn > 0 else 0.0

    target_ngn = float(milestone.get("daily_target_ngn", 0.0) or 0.0)
    target_pips = float(milestone.get("daily_target_pips", 0.0) or 0.0)
    min_trades = int(milestone.get("min_trades_per_day", 0) or 0)
    max_trades = int(milestone.get("max_trades_per_day", 0) or 0)
    daily_limit = balance * daily_loss_pct

    if actual_ngn <= -daily_limit:
        status = "DANGER"
    elif target_ngn > 0 and actual_ngn >= target_ngn:
        status = "COMPLETE" if trades_taken >= min_trades else "AHEAD"
    elif target_ngn > 0 and actual_ngn >= target_ngn * 0.8:
        status = "AHEAD"
    elif actual_ngn < 0:
        status = "BEHIND"
    else:
        status = "ON_TRACK"

    pct_of_target = (actual_ngn / target_ngn * 100) if target_ngn > 0 else 0.0

    return {
        "actual_ngn": round(actual_ngn, 2),
        "actual_pips": round(actual_pips, 1),
        "target_ngn": round(target_ngn, 2),
        "target_pips": round(target_pips, 1),
        "trades_taken": trades_taken,
        "trades_remaining": max(max_trades - trades_taken, 0),
        "min_trades": min_trades,
        "max_trades": max_trades,
        "status": status,
        "pct_of_target": round(pct_of_target, 1),
        "daily_limit_ngn": round(daily_limit, 2),
    }
