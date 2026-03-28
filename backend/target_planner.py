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
    "avg_volume": 0.01,
}


def _safe_average(values: list[float], default: float) -> float:
    return sum(values) / len(values) if values else default


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
            "total_deals": 0,
            "trade_win_rate": DEFAULTS["win_rate"],
            "trade_avg_win_ngn": DEFAULTS["avg_win_ngn"],
            "trade_avg_loss_ngn": DEFAULTS["avg_loss_ngn"],
            "planner_baseline_source": "defaults",
            "planning_win_rate": DEFAULTS["win_rate"],
            "planning_avg_win_ngn": DEFAULTS["avg_win_ngn"],
            "planning_avg_loss_ngn": DEFAULTS["avg_loss_ngn"],
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
    trade_profits = [float(deal.get("profit", 0.0) or 0.0) for deal in deals]
    trade_wins = [profit for profit in trade_profits if profit > 0]
    trade_losses = [profit for profit in trade_profits if profit <= 0]
    trade_win_rate = len(trade_wins) / len(trade_profits) if trade_profits else DEFAULTS["win_rate"]
    trade_avg_win = _safe_average(trade_wins, DEFAULTS["avg_win_ngn"])
    trade_avg_loss = abs(_safe_average(trade_losses, -DEFAULTS["avg_loss_ngn"]))
    volumes = [float(deal.get("volume", 0.0) or 0.0) for deal in deals if float(deal.get("volume", 0.0) or 0.0) > 0]
    avg_volume = (sum(volumes) / len(volumes)) if volumes else DEFAULTS["avg_volume"]

    total_days = len(days)
    data_quality = (
        "NONE" if total_days == 0
        else "LOW" if total_days < 15
        else "MEDIUM" if total_days < 30
        else "HIGH"
    )
    if total_days >= 3:
        planner_baseline_source = "history_daily"
        planning_win_rate = win_rate
        planning_avg_win = avg_win
        planning_avg_loss = abs(avg_loss)
    else:
        planner_baseline_source = "trade_average_fallback"
        planning_win_rate = trade_win_rate
        planning_avg_win = trade_avg_win
        planning_avg_loss = trade_avg_loss

    return {
        "win_rate": win_rate,
        "avg_win_ngn": avg_win,
        "avg_loss_ngn": abs(avg_loss),
        "trade_win_rate": trade_win_rate,
        "trade_avg_win_ngn": trade_avg_win,
        "trade_avg_loss_ngn": trade_avg_loss,
        "planner_baseline_source": planner_baseline_source,
        "planning_win_rate": planning_win_rate,
        "planning_avg_win_ngn": planning_avg_win,
        "planning_avg_loss_ngn": planning_avg_loss,
        "std_win": std_win,
        "std_loss": std_loss,
        "avg_trades_per_day": avg_trades,
        "marginal_cutoff": marginal_cutoff,
        "max_consecutive_losses": max_consec,
        "avg_volume": avg_volume,
        "total_trading_days": total_days,
        "total_deals": len(trade_profits),
        "low_data_warning": total_days < 15,
        "data_quality": data_quality,
        "no_history": False,
    }


def _recommended_lot(capital: float, pair_info: dict, risk_pct: float) -> float:
    vol_min = max(pair_info["volume_min"], 0.01)
    vol_step = max(pair_info["volume_step"], 0.01)
    vol_max = max(pair_info.get("volume_max", vol_min), vol_min)
    atr = max(pair_info["atr"], 0.0)
    tick_val = max(pair_info["trade_tick_value"], 0.0)
    point = max(pair_info["point"], 1e-10)
    loss_per_lot = (atr / point) * tick_val if point > 0 else 0.0

    if loss_per_lot <= 0 or risk_pct <= 0:
        return round(vol_min, 8)

    raw_lot = (capital * risk_pct) / loss_per_lot
    min_units = max(int(math.ceil((vol_min - 1e-12) / vol_step)), 1)
    max_units = max(int(math.floor((vol_max + 1e-12) / vol_step)), min_units)
    lot_units = max(int(math.floor((raw_lot + 1e-12) / vol_step)), min_units)
    lot_units = min(lot_units, max_units)
    return round(lot_units * vol_step, 8)


def _capital_checkpoints(start_ngn: float, target_ngn: float) -> list[float]:
    if target_ngn <= start_ngn:
        return []

    ratio = max(target_ngn / max(start_ngn, 1.0), 1.01)
    desired_segments = min(max(math.ceil(math.log(ratio, 1.35)), 4), 8)
    growth_factor = ratio ** (1 / desired_segments)

    checkpoints = []
    previous = start_ngn
    for step in range(1, desired_segments + 1):
        checkpoint = target_ngn if step == desired_segments else round(start_ngn * (growth_factor ** step), 2)
        checkpoint = max(checkpoint, round(previous + 1.0, 2))
        checkpoint = min(checkpoint, target_ngn)
        if checkpoint > previous:
            checkpoints.append(checkpoint)
            previous = checkpoint

    if checkpoints and checkpoints[-1] != target_ngn:
        checkpoints[-1] = target_ngn

    return checkpoints


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
    Generate milestone checkpoints from start_ngn to target_ngn.
    Milestones are capital progress bands with lot sizing recomputed at each step.
    """
    if start_ngn >= target_ngn:
        return []

    baseline_win_rate = stats.get("planning_win_rate", stats["win_rate"])
    baseline_avg_win = stats.get("planning_avg_win_ngn", stats["avg_win_ngn"])
    baseline_avg_loss = stats.get("planning_avg_loss_ngn", stats["avg_loss_ngn"])
    win_rate = overrides.get("win_rate", baseline_win_rate)
    avg_win = overrides.get("avg_win_ngn", baseline_avg_win)
    avg_loss = overrides.get("avg_loss_ngn", baseline_avg_loss)
    std_win = stats["std_win"]
    std_loss = stats["std_loss"]
    cutoff = max(int(stats["marginal_cutoff"]), 1)
    avg_trades = stats["avg_trades_per_day"]
    avg_volume = max(float(stats.get("avg_volume", DEFAULTS["avg_volume"]) or DEFAULTS["avg_volume"]), 1e-6)
    low_data = stats["low_data_warning"]
    move_unit_label = pair_info.get("move_unit_label", "Pips")
    move_unit_short = pair_info.get("move_unit_short", "pip")

    atr = max(pair_info["atr"], 0.0)
    tick_val = max(pair_info["trade_tick_value"], 0.0)
    point = max(pair_info["point"], 1e-10)
    move_val_per_lot = float(pair_info.get("move_value_ngn_per_lot", 0.0) or 0.0)
    if move_val_per_lot <= 0:
        move_val_per_lot = tick_val / point if point > 0 else 0.0

    milestones = []
    capital = start_ngn

    for milestone_end in _capital_checkpoints(start_ngn, target_ngn):
        rec_lot = _recommended_lot(capital, pair_info, risk_pct)

        daily_target_ngn = capital * daily_loss_pct * 0.5
        move_val_at_lot = move_val_per_lot * rec_lot
        daily_target_units = daily_target_ngn / move_val_at_lot if move_val_at_lot > 0 else 0.0

        avg_units_per_trade = daily_target_units / avg_trades if avg_trades > 0 else 10.0
        min_trades = math.ceil(daily_target_units / avg_units_per_trade) if avg_units_per_trade > 0 else 1
        max_trades = max(cutoff, min_trades)

        gain_needed = milestone_end - capital
        scale = rec_lot / avg_volume
        eff_win = avg_win * scale
        eff_loss = avg_loss * scale
        exp_daily = win_rate * eff_win - (1 - win_rate) * eff_loss

        opt_daily = (
            win_rate * (eff_win + 0.5 * std_win * scale)
            - (1 - win_rate) * max(eff_loss - 0.5 * std_loss * scale, 1)
        )
        pess_daily = (
            win_rate * max(eff_win - 0.5 * std_win * scale, 1)
            - (1 - win_rate) * (eff_loss + 0.5 * std_loss * scale)
        )

        if exp_daily > 0 and opt_daily > 0 and pess_daily > 0:
            est_mid = math.ceil(gain_needed / exp_daily)
            est_low = math.ceil(gain_needed / opt_daily)
            est_high = math.ceil(gain_needed / pess_daily)
            estimation_mode = "model"
        else:
            est_mid = None
            est_low = None
            est_high = None
            estimation_mode = "review"

        if low_data and est_low is not None and est_high is not None:
            mid = (est_low + est_high) / 2
            half = max((est_high - est_low) / 2 * 1.5, 1)
            est_low = max(1, math.floor(mid - half))
            est_high = math.ceil(mid + half)

        loss_per_lot = (atr / point) * tick_val if point > 0 else 0.0
        margin_per_lot = loss_per_lot * rec_lot
        survival = math.floor((capital * daily_loss_pct) / margin_per_lot) if margin_per_lot > 0 else 99

        milestones.append({
            "capital_start": round(capital, 2),
            "capital_end": round(milestone_end, 2),
            "lot_size": rec_lot,
            "pair": pair_info["symbol"],
            "daily_target_ngn": round(daily_target_ngn, 2),
            "daily_target_units": round(daily_target_units, 1),
            "daily_target_pips": round(daily_target_units, 1),
            "move_unit_label": move_unit_label,
            "move_unit_short": move_unit_short,
            "min_trades_per_day": min_trades,
            "max_trades_per_day": max_trades,
            "est_days_mid": est_mid,
            "est_days_low": est_low,
            "est_days_high": est_high,
            "estimation_mode": estimation_mode,
            "consecutive_loss_survival": survival,
            "data_quality": stats["data_quality"],
            "overrides_applied": list(overrides.keys()),
        })

        capital = milestone_end

    return milestones


def get_kpi_today(
    deals_today: list,
    milestone: dict,
    move_value_ngn: float,
    balance: float = 150_000,
    daily_loss_pct: float = 0.02,
    daily_limit_balance: float | None = None,
) -> dict:
    actual_ngn = sum(float(deal.get("profit", 0.0)) for deal in deals_today)
    trades_taken = len(deals_today)
    actual_units = actual_ngn / move_value_ngn if move_value_ngn > 0 else 0.0

    target_ngn = float(milestone.get("daily_target_ngn", 0.0) or 0.0)
    target_units = float(milestone.get("daily_target_units", milestone.get("daily_target_pips", 0.0)) or 0.0)
    min_trades = int(milestone.get("min_trades_per_day", 0) or 0)
    max_trades = max(int(milestone.get("max_trades_per_day", 0) or 0), min_trades)
    limit_balance = daily_limit_balance if daily_limit_balance is not None else balance
    daily_limit = max(limit_balance, 0.0) * daily_loss_pct
    move_unit_label = milestone.get("move_unit_label", "Pips")
    move_unit_short = milestone.get("move_unit_short", "pip")

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
        "actual_units": round(actual_units, 1),
        "actual_pips": round(actual_units, 1),
        "target_ngn": round(target_ngn, 2),
        "target_units": round(target_units, 1),
        "target_pips": round(target_units, 1),
        "move_unit_label": move_unit_label,
        "move_unit_short": move_unit_short,
        "trades_taken": trades_taken,
        "trades_remaining": max(max_trades - trades_taken, 0),
        "min_trades": min_trades,
        "max_trades": max_trades,
        "status": status,
        "pct_of_target": round(pct_of_target, 1),
        "daily_limit_ngn": round(daily_limit, 2),
        "daily_limit_balance_ngn": round(max(limit_balance, 0.0), 2),
    }


def get_open_position_alignment(
    open_positions: list,
    milestone: dict,
    move_value_ngn_per_lot: float,
    closed_trades_count: int = 0,
    volume_step: float = 0.01,
) -> dict:
    positions_count = len(open_positions)
    target_ngn = float(milestone.get("daily_target_ngn", 0.0) or 0.0)
    target_units = float(milestone.get("daily_target_units", milestone.get("daily_target_pips", 0.0)) or 0.0)
    min_trades = max(int(milestone.get("min_trades_per_day", 0) or 0), 1)
    max_trades = max(int(milestone.get("max_trades_per_day", 0) or 0), min_trades)
    recommended_lot = float(milestone.get("lot_size", 0.0) or 0.0)
    move_unit_label = milestone.get("move_unit_label", "Pips")
    move_unit_short = milestone.get("move_unit_short", "pip")
    lot_step = max(float(volume_step or 0.01), 1e-9)

    active_trade_slots = max(closed_trades_count + positions_count, 1)
    planned_trade_slots = min(max(active_trade_slots, min_trades), max_trades)
    target_ngn_per_trade = target_ngn / planned_trade_slots if planned_trade_slots > 0 else 0.0
    target_units_per_trade = target_units / planned_trade_slots if planned_trade_slots > 0 else 0.0

    aligned_positions = []
    total_open_ngn = 0.0
    total_open_units = 0.0
    matching_positions = 0

    for index, position in enumerate(open_positions, start=1):
        volume = float(position.get("volume", 0.0) or 0.0)
        open_ngn = float(position.get("profit", 0.0) or 0.0)
        move_value_ngn = move_value_ngn_per_lot * volume if volume > 0 and move_value_ngn_per_lot > 0 else 0.0
        open_units = open_ngn / move_value_ngn if move_value_ngn > 0 else 0.0
        pct_of_slot_target = (open_ngn / target_ngn_per_trade * 100) if target_ngn_per_trade > 0 else 0.0
        slot_number = closed_trades_count + index
        within_trade_limit = slot_number <= max_trades
        lot_delta = volume - recommended_lot
        lot_matches_plan = abs(lot_delta) <= (lot_step / 2)
        settings_notes = []
        if not lot_matches_plan:
            settings_notes.append(f"Lot differs from KPI plan by {round(lot_delta, 8)}")
        if not within_trade_limit:
            settings_notes.append("Trade exceeds the daily max trade plan")

        settings_status = "MATCH" if lot_matches_plan and within_trade_limit else "REVIEW"

        if open_ngn < 0:
            status = "BEHIND"
        elif target_ngn_per_trade > 0 and open_ngn >= target_ngn_per_trade:
            status = "AHEAD"
        else:
            status = "ON_TRACK"

        if settings_status == "MATCH":
            matching_positions += 1

        aligned_positions.append({
            **position,
            "open_ngn": round(open_ngn, 2),
            "open_units": round(open_units, 1),
            "recommended_lot": round(recommended_lot, 8),
            "lot_delta": round(lot_delta, 8),
            "lot_matches_plan": lot_matches_plan,
            "within_trade_limit": within_trade_limit,
            "trade_slot_number": slot_number,
            "settings_status": settings_status,
            "settings_notes": settings_notes,
            "slot_target_ngn": round(target_ngn_per_trade, 2),
            "slot_target_units": round(target_units_per_trade, 1),
            "pct_of_slot_target": round(pct_of_slot_target, 1),
            "status": status,
        })
        total_open_ngn += open_ngn
        total_open_units += open_units

    target_ngn_for_open_positions = target_ngn_per_trade * positions_count
    target_units_for_open_positions = target_units_per_trade * positions_count
    total_pct_of_slot_target = (
        (total_open_ngn / target_ngn_for_open_positions) * 100
        if target_ngn_for_open_positions > 0 else 0.0
    )
    requires_review = matching_positions < positions_count
    if requires_review:
        overall_status = "REVIEW"
    elif total_open_ngn < 0:
        overall_status = "BEHIND"
    elif target_ngn_for_open_positions > 0 and total_open_ngn >= target_ngn_for_open_positions:
        overall_status = "AHEAD"
    else:
        overall_status = "ON_TRACK"

    return {
        "positions_count": positions_count,
        "matching_positions_count": matching_positions,
        "open_positions_count": positions_count,
        "closed_trades_count": closed_trades_count,
        "active_trades_count": closed_trades_count + positions_count,
        "active_trade_slots": active_trade_slots,
        "planned_trade_slots": planned_trade_slots,
        "remaining_trade_slots": max(max_trades - (closed_trades_count + positions_count), 0),
        "target_ngn_per_trade": round(target_ngn_per_trade, 2),
        "target_units_per_trade": round(target_units_per_trade, 1),
        "target_ngn_for_open_positions": round(target_ngn_for_open_positions, 2),
        "target_units_for_open_positions": round(target_units_for_open_positions, 1),
        "total_open_ngn": round(total_open_ngn, 2),
        "total_open_units": round(total_open_units, 1),
        "pct_of_slot_target": round(total_pct_of_slot_target, 1),
        "status": overall_status,
        "recommended_lot": round(recommended_lot, 8),
        "move_unit_label": move_unit_label,
        "move_unit_short": move_unit_short,
        "positions": aligned_positions,
    }
