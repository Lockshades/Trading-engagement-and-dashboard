"""
Risk Scanner API
----------------
Run: cd backend && uvicorn api:app --reload --port 8000
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
import atexit
import logging
import signal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import MetaTrader5 as mt5
from pydantic import BaseModel, Field

from data_fetcher import BARS, TIMEFRAME, calc_atr, score_symbol
from target_planner import (
    analyze_history,
    compute_milestones,
    get_kpi_today,
    get_open_position_alignment,
)
from executive_arm import (
    ExecutiveArmController,
    create_default_controller,
    get_controller,
    enforce_lot,
    check_close,
    get_settings,
    PositionInfo,
    EnforcementSettings,
)

logger = logging.getLogger(__name__)


app = FastAPI(title="Pair Risk Scanner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WATCHLIST = {
    "crypto": [
        "BTCUSDm", "ETHUSDm", "SOLUSDm", "XRPUSDm",
        "BNBUSDm", "ADAUSDm", "DOGEUSDm", "LTCUSDm",
        "MATICUSDm", "LINKUSDm",
    ],
    "forex": [
        "EURUSDm", "GBPUSDm", "USDJPYm", "USDCHFm",
        "AUDUSDm", "NZDUSDm", "USDCADm",
        "EURGBPm", "EURJPYm", "GBPJPYm",
    ],
    "metals": [
        "XAUUSDm", "XAGUSDm",
    ],
    "indices": [
        "US500m", "US30m",
    ],
}

SYMBOL_TO_ASSET_CLASS = {
    symbol: asset_class
    for asset_class, symbols in WATCHLIST.items()
    for symbol in symbols
}

CLASS_ADX_GATES = {
    "crypto": {"amber": 30.0, "red": 50.0},
    "forex": {"amber": 20.0, "red": 35.0},
    "metals": {"amber": 25.0, "red": 40.0},
    "indices": {"amber": 25.0, "red": 40.0},
}

CLASS_LABELS = {
    "crypto": "Crypto",
    "forex": "Forex",
    "metals": "Metals",
    "indices": "Indices",
}

CLASSIFICATION_ORDER = {"SAFE": 0, "MODERATE": 1, "RISKY": 2}
DEFAULT_PLAN_SYMBOL = "ETHUSDm"
HISTORY_LOOKBACK_DAYS = 90
ALL_HISTORY_START = datetime(2000, 1, 1, tzinfo=timezone.utc)
ALLOWED_OVERRIDE_KEYS = {"win_rate", "avg_win_ngn", "avg_loss_ngn"}
EXTERNAL_CASHFLOW_TYPES = {
    getattr(mt5, "DEAL_TYPE_BALANCE", None),
    getattr(mt5, "DEAL_TYPE_CREDIT", None),
    getattr(mt5, "DEAL_TYPE_CHARGE", None),
    getattr(mt5, "DEAL_TYPE_CORRECTION", None),
    getattr(mt5, "DEAL_TYPE_BONUS", None),
}
EXTERNAL_CASHFLOW_TYPES.discard(None)

# Cash flow classifications for milestone tracking
# DEPOSIT_TYPES: Add to capital base (advances progress)
DEPOSIT_TYPES = {
    getattr(mt5, "DEAL_TYPE_BALANCE", None),
    getattr(mt5, "DEAL_TYPE_CREDIT", None),
    getattr(mt5, "DEAL_TYPE_BONUS", None),
}
DEPOSIT_TYPES.discard(None)

# CHARGE_TYPES: Subtract from capital base (causes setback)
CHARGE_TYPES = {
    getattr(mt5, "DEAL_TYPE_CHARGE", None),
    getattr(mt5, "DEAL_TYPE_CORRECTION", None),
}
CHARGE_TYPES.discard(None)

# WITHDRAWAL_TYPES: Subtract from capital but don't cause milestone setback
# (User withdrew profit, not capital base)
WITHDRAWAL_TYPES = {
    getattr(mt5, "DEAL_TYPE_WITHDRAWAL", None),
}
WITHDRAWAL_TYPES.discard(None)


class ScanRequest(BaseModel):
    balance: Optional[float] = Field(default=None, gt=0, description="Account balance, must be positive if provided")
    daily_loss_pct: Optional[float] = Field(default=0.02, ge=0.01, le=0.5, description="Daily loss limit percentage, between 1% and 50%")
    risk_pct: Optional[float] = Field(default=0.01, ge=0.001, le=0.1, description="Risk per trade percentage, between 0.1% and 10%")


class PlanRequest(BaseModel):
    target_ngn: float = Field(gt=0, le=1_000_000_000, description="Target balance in NGN, must be positive up to 1 billion")
    balance: Optional[float] = Field(default=None, ge=0, description="Account balance, must be non-negative if provided")
    daily_loss_pct: Optional[float] = Field(default=0.02, ge=0.01, le=0.5, description="Daily loss limit percentage, between 1% and 50%")
    risk_pct: Optional[float] = Field(default=0.01, ge=0.001, le=0.1, description="Risk per trade percentage, between 0.1% and 10%")
    planning_symbol: Optional[str] = None
    history_days: Optional[int] = Field(default=HISTORY_LOOKBACK_DAYS, ge=1, le=3650, description="History lookback days, must be positive up to 10 years")
    use_all_history: bool = False
    overrides: dict[str, float] = Field(default_factory=dict)


def enrich(result: dict, asset_class: str, class_rank: int) -> dict:
    return {
        **result,
        "asset_class": asset_class,
        "class_label": CLASS_LABELS[asset_class],
        "class_rank": class_rank,
    }


def resolve_ratio(value: Optional[float], default: float) -> float:
    return value if value is not None and value > 0 else default


def infer_asset_class(symbol: str, scored_pairs: Optional[list[dict]] = None) -> Optional[str]:
    if scored_pairs:
        for pair in scored_pairs:
            if pair.get("symbol") == symbol and pair.get("asset_class"):
                return pair["asset_class"]
    return SYMBOL_TO_ASSET_CLASS.get(symbol)


def build_move_unit(symbol: str, asset_class: Optional[str], point: float, digits: int, trade_tick_value: float, trade_tick_size: float) -> dict:
    tick_size = trade_tick_size if trade_tick_size and trade_tick_size > 0 else point

    if asset_class == "forex":
        pip_size = point * 10 if digits in (3, 5) else point
        unit_size = pip_size if pip_size > 0 else point
        unit_label = "Pips"
        unit_short = "pip"
    else:
        unit_size = tick_size if tick_size > 0 else point
        unit_label = "Points"
        unit_short = "pt"

    value_per_unit_per_lot = (
        (trade_tick_value / tick_size) * unit_size
        if tick_size > 0 and unit_size > 0 and trade_tick_value > 0
        else 0.0
    )

    return {
        "move_unit_label": unit_label,
        "move_unit_short": unit_short,
        "move_unit_size": unit_size,
        "move_value_ngn_per_lot": value_per_unit_per_lot,
        "trade_tick_size": tick_size,
    }


def build_account_snapshot(account) -> Optional[dict]:
    if not account:
        return None

    return {
        "login": getattr(account, "login", None),
        "currency": getattr(account, "currency", None),
        "balance": float(getattr(account, "balance", 0.0) or 0.0),
        "equity": float(getattr(account, "equity", 0.0) or 0.0),
        "margin_free": float(getattr(account, "margin_free", 0.0) or 0.0),
    }


def resolve_balance_details(requested_balance: Optional[float]) -> tuple[float, str, Optional[dict]]:
    account = mt5.account_info()
    snapshot = build_account_snapshot(account)

    if requested_balance is not None and requested_balance > 0:
        return requested_balance, "manual_override", snapshot

    if account and getattr(account, "balance", 0.0) and account.balance > 0:
        return float(account.balance), "mt5_balance", snapshot

    if account and getattr(account, "equity", 0.0) and account.equity > 0:
        return float(account.equity), "mt5_equity", snapshot

    if account is not None:
        return 0.0, "mt5_balance", snapshot

    return 0.0, "mt5_unavailable", snapshot


def resolve_balance(requested_balance: Optional[float]) -> float:
    balance, _, _ = resolve_balance_details(requested_balance)
    return balance


def resolve_request_balance_payload(requested_balance: Optional[float]) -> Optional[float]:
    if requested_balance is not None and requested_balance > 0:
        return requested_balance
    return None


def summarize_pairs(pairs: list[dict]) -> dict:
    return {
        "total": len(pairs),
        "safe": sum(1 for pair in pairs if pair["classification"] == "SAFE"),
        "moderate": sum(1 for pair in pairs if pair["classification"] == "MODERATE"),
        "risky": sum(1 for pair in pairs if pair["classification"] == "RISKY"),
    }


def score_watchlist(balance: float, daily_loss_pct: float, risk_pct: float) -> list[dict]:
    all_results = []

    for asset_class, symbols in WATCHLIST.items():
        class_results = []
        adx_gate = CLASS_ADX_GATES[asset_class]

        for symbol in symbols:
            result = score_symbol(
                symbol,
                balance,
                adx_gate=adx_gate,
                risk_pct=risk_pct,
                daily_loss_pct=daily_loss_pct,
            )
            if "error" not in result:
                class_results.append(result)

        class_results.sort(
            key=lambda item: (
                CLASSIFICATION_ORDER.get(item["classification"], 3),
                -item["score"],
            )
        )

        for index, result in enumerate(class_results, start=1):
            all_results.append(enrich(result, asset_class, index))

    return all_results


def select_planning_symbol(pairs: list[dict]) -> str:
    if not pairs:
        return DEFAULT_PLAN_SYMBOL

    ranked = sorted(
        pairs,
        key=lambda item: (
            CLASSIFICATION_ORDER.get(item.get("classification"), 3),
            -item.get("score", 0),
        ),
    )
    return ranked[0].get("symbol") or DEFAULT_PLAN_SYMBOL


def resolve_planning_symbol(requested_symbol: Optional[str], pairs: list[dict]) -> str:
    if requested_symbol:
        if any(pair.get("symbol") == requested_symbol for pair in pairs):
            return requested_symbol
        if ensure_symbol_info(requested_symbol) is not None:
            return requested_symbol

    return select_planning_symbol(pairs)


def ensure_symbol_info(symbol: str):
    info = mt5.symbol_info(symbol)
    if info is not None and info.visible:
        return info

    mt5.symbol_select(symbol, True)
    return mt5.symbol_info(symbol)


def get_symbol_atr(symbol: str, default: float = 15.0) -> float:
    raw = mt5.copy_rates_from_pos(symbol, TIMEFRAME, 0, BARS)
    if raw is None or len(raw) < 20:
        return default

    atr_series = calc_atr({
        "high": raw["high"],
        "low": raw["low"],
        "close": raw["close"],
    })
    if len(atr_series) == 0:
        return default

    return float(atr_series[-1])


def get_pair_info(symbol: str, asset_class: Optional[str] = None) -> dict:
    info = ensure_symbol_info(symbol)
    if info is None:
        move_unit = build_move_unit(symbol, asset_class, 0.01, 2, 160.0, 0.01)
        return {
            "symbol": symbol,
            "asset_class": asset_class,
            "volume_min": 0.1,
            "volume_step": 0.1,
            "volume_max": 100.0,
            "trade_tick_value": 160.0,
            "trade_tick_size": move_unit["trade_tick_size"],
            "point": 0.01,
            "digits": 2,
            "atr": 15.0,
            **move_unit,
        }

    volume_min = info.volume_min if info.volume_min and info.volume_min > 0 else 0.1
    volume_step = info.volume_step if info.volume_step and info.volume_step > 0 else volume_min
    volume_max = info.volume_max if info.volume_max and info.volume_max > 0 else 100.0
    trade_tick_value = (
        info.trade_tick_value
        if info.trade_tick_value and info.trade_tick_value > 0
        else 160.0
    )
    point = info.point if info.point and info.point > 0 else 0.01
    digits = int(info.digits) if getattr(info, "digits", None) is not None else 2
    trade_tick_size = info.trade_tick_size if getattr(info, "trade_tick_size", None) and info.trade_tick_size > 0 else point
    move_unit = build_move_unit(symbol, asset_class, point, digits, trade_tick_value, trade_tick_size)

    return {
        "symbol": symbol,
        "asset_class": asset_class,
        "volume_min": volume_min,
        "volume_step": volume_step,
        "volume_max": volume_max,
        "trade_tick_value": trade_tick_value,
        "trade_tick_size": trade_tick_size,
        "point": point,
        "digits": digits,
        "atr": get_symbol_atr(symbol),
        **move_unit,
    }


def normalize_deal(raw_deal) -> Optional[dict]:
    if raw_deal is None:
        return None

    deal = raw_deal._asdict() if hasattr(raw_deal, "_asdict") else raw_deal
    if not isinstance(deal, dict):
        return None

    timestamp = deal.get("time")
    profit = deal.get("profit")
    symbol = deal.get("symbol")

    if timestamp is None or profit is None or not symbol:
        return None

    try:
        return {
            "time": int(timestamp),
            "profit": float(profit),
            "volume": float(deal.get("volume", 0.0) or 0.0),
            "symbol": str(symbol),
        }
    except (TypeError, ValueError):
        return None


def normalize_position(raw_position) -> Optional[dict]:
    if raw_position is None:
        return None

    position = raw_position._asdict() if hasattr(raw_position, "_asdict") else raw_position
    if not isinstance(position, dict):
        return None

    symbol = position.get("symbol")
    ticket = position.get("ticket")
    if not symbol or ticket is None:
        return None

    try:
        position_type = int(position.get("type", -1))
        return {
            "ticket": int(ticket),
            "symbol": str(symbol),
            "type": position_type,
            "type_label": "BUY" if position_type == 0 else "SELL" if position_type == 1 else "UNKNOWN",
            "volume": float(position.get("volume", 0.0) or 0.0),
            "profit": float(position.get("profit", 0.0) or 0.0),
            "price_open": float(position.get("price_open", 0.0) or 0.0),
            "price_current": float(position.get("price_current", 0.0) or 0.0),
            "sl": float(position.get("sl", 0.0) or 0.0),
            "tp": float(position.get("tp", 0.0) or 0.0),
            "time": int(position.get("time", 0) or 0),
        }
    except (TypeError, ValueError):
        return None


def normalize_external_cash_flow(raw_deal) -> Optional[dict]:
    if raw_deal is None:
        return None

    deal = raw_deal._asdict() if hasattr(raw_deal, "_asdict") else raw_deal
    if not isinstance(deal, dict):
        return None

    deal_type = deal.get("type")
    timestamp = deal.get("time")
    amount = deal.get("profit")
    if deal_type not in EXTERNAL_CASHFLOW_TYPES or timestamp is None or amount is None:
        return None

    # Classify the cash flow type
    flow_category = "UNKNOWN"
    if deal_type in DEPOSIT_TYPES:
        flow_category = "DEPOSIT"
    elif deal_type in CHARGE_TYPES:
        flow_category = "CHARGE"
    elif deal_type in WITHDRAWAL_TYPES:
        flow_category = "WITHDRAWAL"

    try:
        return {
            "time": int(timestamp),
            "amount": float(amount),
            "type": int(deal_type),
            "category": flow_category,
            "comment": str(deal.get("comment") or ""),
        }
    except (TypeError, ValueError):
        return None


def get_history_deals(date_from: datetime, date_to: datetime) -> list[dict]:
    raw_deals = mt5.history_deals_get(date_from, date_to)
    if not raw_deals:
        return []

    deals = []
    for raw_deal in raw_deals:
        normalized = normalize_deal(raw_deal)
        if normalized is not None:
            deals.append(normalized)
    return deals


def get_open_positions(symbol: Optional[str] = None) -> list[dict]:
    raw_positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
    if not raw_positions:
        return []

    positions = []
    for raw_position in raw_positions:
        normalized = normalize_position(raw_position)
        if normalized is not None:
            positions.append(normalized)
    return positions


def get_external_cash_flows(date_from: datetime, date_to: datetime) -> list[dict]:
    raw_deals = mt5.history_deals_get(date_from, date_to)
    if not raw_deals:
        return []

    cash_flows = []
    for raw_deal in raw_deals:
        normalized = normalize_external_cash_flow(raw_deal)
        if normalized is not None:
            cash_flows.append(normalized)
    return cash_flows


def sanitize_overrides(overrides: Optional[dict]) -> dict:
    if not overrides:
        return {}

    clean = {}
    for key, value in overrides.items():
        if key not in ALLOWED_OVERRIDE_KEYS or value is None:
            continue
        try:
            clean[key] = float(value)
        except (TypeError, ValueError):
            continue
    return clean


def resolve_history_window(
    history_days: Optional[float],
    use_all_history: bool,
    date_to: datetime,
) -> tuple[datetime, Optional[int], str]:
    if use_all_history:
        return ALL_HISTORY_START, None, "All history"

    days = int(history_days) if history_days is not None else HISTORY_LOOKBACK_DAYS
    days = max(days, 1)
    return date_to - timedelta(days=days), days, f"Last {days} days"


@app.post("/scan")
def scan(req: Optional[ScanRequest] = None):
    req = req or ScanRequest()

    if not mt5.initialize():
        error_msg = f"MT5 connection failed: {mt5.last_error()}"
        logger.error(error_msg)
        return {"error": error_msg}

    try:
        balance, balance_source, account_snapshot = resolve_balance_details(req.balance)
        daily_loss_pct = resolve_ratio(req.daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(req.risk_pct, 0.01)
        pairs = score_watchlist(balance, daily_loss_pct, risk_pct)

        return {
            "balance_ngn": balance,
            "balance_source": balance_source,
            "account_snapshot": account_snapshot,
            "daily_limit_ngn": balance * daily_loss_pct,
            "risk_per_trade": balance * risk_pct,
            "daily_loss_pct": daily_loss_pct,
            "risk_pct": risk_pct,
            "pairs": pairs,
            "summary": summarize_pairs(pairs),
        }
    except Exception:
        logger.exception("MT5 scan failed")
        raise
    finally:
        mt5.shutdown()


@app.post("/plan")
def plan(req: PlanRequest):
    if not mt5.initialize():
        error_msg = f"MT5 connection failed: {mt5.last_error()}"
        logger.error(error_msg)
        return {"error": error_msg}

    try:
        balance, balance_source, account_snapshot = resolve_balance_details(req.balance)
        daily_loss_pct = resolve_ratio(req.daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(req.risk_pct, 0.01)
        date_to = datetime.now(tz=timezone.utc)
        date_from, history_window_days, history_window_label = resolve_history_window(
            req.history_days,
            req.use_all_history,
            date_to,
        )
        scored_pairs = score_watchlist(balance, daily_loss_pct, risk_pct)
        planning_symbol = resolve_planning_symbol(req.planning_symbol, scored_pairs)
        pair_info = get_pair_info(planning_symbol, infer_asset_class(planning_symbol, scored_pairs))
        all_deals = get_history_deals(date_from, date_to)
        deals = [deal for deal in all_deals if deal.get("symbol") == planning_symbol]
        history_stats = analyze_history(deals)
        overrides = sanitize_overrides(req.overrides)

        milestones = []
        if req.target_ngn > balance:
            milestones = compute_milestones(
                balance,
                req.target_ngn,
                history_stats,
                pair_info,
                overrides,
                risk_pct,
                daily_loss_pct,
            )

        return {
            "balance_ngn": balance,
            "balance_source": balance_source,
            "account_snapshot": account_snapshot,
            "target_ngn": req.target_ngn,
            "daily_loss_pct": daily_loss_pct,
            "risk_pct": risk_pct,
            "history_window_days": history_window_days,
            "history_window_label": history_window_label,
            "history_deals_count": len(deals),
            "history_total_deals_count": len(all_deals),
            "planning_symbol": planning_symbol,
            "history_stats": history_stats,
            "history_deals": deals,
            "pair_info": pair_info,
            "milestones": milestones,
        }
    except Exception:
        logger.exception("MT5 plan endpoint failed")
        raise
    finally:
        mt5.shutdown()


@app.get("/kpi/today")
def kpi_today(
    balance: Optional[float] = None,
    daily_loss_pct: Optional[float] = 0.02,
    risk_pct: Optional[float] = 0.01,
    target_ngn: float = 1_000_000,
    planning_symbol: Optional[str] = None,
    history_days: Optional[int] = HISTORY_LOOKBACK_DAYS,
    use_all_history: bool = False,
):
    if not mt5.initialize():
        error_msg = f"MT5 connection failed: {mt5.last_error()}"
        logger.error(error_msg)
        return {"error": error_msg}

    try:
        resolved_balance, balance_source, account_snapshot = resolve_balance_details(balance)
        daily_loss_pct = resolve_ratio(daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(risk_pct, 0.01)

        now_utc = datetime.now(tz=timezone.utc)
        history_start, history_window_days, history_window_label = resolve_history_window(
            history_days,
            use_all_history,
            now_utc,
        )
        scored_pairs = score_watchlist(resolved_balance, daily_loss_pct, risk_pct)
        active_symbol = resolve_planning_symbol(planning_symbol, scored_pairs)
        pair_info = get_pair_info(active_symbol, infer_asset_class(active_symbol, scored_pairs))
        all_history_deals = get_history_deals(history_start, now_utc)
        external_cash_flows = get_external_cash_flows(history_start, now_utc)
        history_deals = [deal for deal in all_history_deals if deal.get("symbol") == active_symbol]
        history_stats = analyze_history(history_deals)

        # Classify cash flows for milestone tracking
        # DEPOSITS: Add to capital base (advances progress)
        # CHARGES: Subtract from capital base (causes milestone setback)
        # WITHDRAWALS: Don't affect milestone position (profit taken out)
        deposits = sum(flow["amount"] for flow in external_cash_flows if flow.get("category") == "DEPOSIT" and flow["amount"] > 0)
        charges = sum(abs(flow["amount"]) for flow in external_cash_flows if flow.get("category") == "CHARGE")
        # net_external_funding represents net capital added (deposits - charges)
        net_external_funding = deposits - charges
        progress_balance = max(resolved_balance - net_external_funding, 0.0)

        milestones = []
        if target_ngn > progress_balance:
            milestones = compute_milestones(
                progress_balance,
                target_ngn,
                history_stats,
                pair_info,
                {},
                risk_pct,
                daily_loss_pct,
            )

        current_milestone = next(
            (milestone for milestone in milestones if milestone["capital_end"] > progress_balance),
            None,
        )

        kpi = {}
        open_position_alignment = {}
        if current_milestone:
            today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            # Filter today's deals from existing all_history_deals instead of fetching again
            deals_today = [
                deal for deal in all_history_deals
                if deal.get("symbol") == active_symbol and deal.get("time", 0) >= int(today_start.timestamp())
            ]
            # Filter today's external cash flows from existing external_cash_flows instead of fetching again
            today_external_cash_flows = [
                flow for flow in external_cash_flows
                if flow.get("time", 0) >= int(today_start.timestamp())
            ]
            open_positions = [
                position for position in get_open_positions(active_symbol)
                if position.get("symbol") == active_symbol
            ]
            move_value_ngn = float(pair_info.get("move_value_ngn_per_lot", 0.0) or 0.0) * current_milestone["lot_size"]
            if move_value_ngn <= 0 and pair_info["point"] > 0:
                move_value_ngn = (
                    pair_info["trade_tick_value"] / pair_info["point"]
                ) * current_milestone["lot_size"]

            today_trade_pnl = sum(float(deal.get("profit", 0.0) or 0.0) for deal in deals_today)
            today_external_funding = sum(flow["amount"] for flow in today_external_cash_flows)
            daily_limit_balance = max(resolved_balance - today_trade_pnl - today_external_funding, 0.0)

            kpi = get_kpi_today(
                deals_today,
                current_milestone,
                move_value_ngn,
                progress_balance,
                daily_loss_pct,
                daily_limit_balance,
            )
            open_position_alignment = get_open_position_alignment(
                open_positions,
                current_milestone,
                float(pair_info.get("move_value_ngn_per_lot", 0.0) or 0.0),
                len(deals_today),
                float(pair_info.get("volume_step", 0.01) or 0.01),
            )
            if kpi.get("status") == "DANGER" and open_position_alignment.get("positions_count", 0) > 0:
                open_position_alignment["status"] = "DANGER"
            closed_trades_taken = int(kpi.get("trades_taken", len(deals_today)) or 0)
            max_trades = int(kpi.get("max_trades", current_milestone.get("max_trades_per_day", 0)) or 0)
            kpi["closed_trades_taken"] = closed_trades_taken
            kpi["open_positions_count"] = len(open_positions)
            kpi["active_trades_taken"] = closed_trades_taken + len(open_positions)
            kpi["trades_remaining_including_open"] = max(
                max_trades - kpi["active_trades_taken"],
                0,
            )
            kpi["today_external_funding_ngn"] = round(today_external_funding, 2)

        return {
            "date": now_utc.date().isoformat(),
            "balance_ngn": resolved_balance,
            "progress_balance_ngn": round(progress_balance, 2),
            "net_external_funding_ngn": round(net_external_funding, 2),
            "deposits_ngn": round(deposits, 2),
            "charges_ngn": round(charges, 2),
            "balance_source": balance_source,
            "account_snapshot": account_snapshot,
            "history_window_days": history_window_days,
            "history_window_label": history_window_label,
            "history_deals_count": len(history_deals),
            "history_total_deals_count": len(all_history_deals),
            "planning_symbol": active_symbol,
            "current_milestone": current_milestone,
            "kpi": kpi,
            "open_position_alignment": open_position_alignment,
        }
    except Exception:
        logger.exception("MT5 kpi_today endpoint failed")
        raise
    finally:
        mt5.shutdown()


@app.get("/marginal")
def marginal(
    balance: Optional[float] = None,
    daily_loss_pct: Optional[float] = 0.02,
    risk_pct: Optional[float] = 0.01,
    symbol: Optional[str] = None,
    history_days: Optional[int] = HISTORY_LOOKBACK_DAYS,
    use_all_history: bool = False,
):
    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    try:
        balance_ngn, balance_source, account_snapshot = resolve_balance_details(balance)
        daily_loss_pct = resolve_ratio(daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(risk_pct, 0.01)
        date_to = datetime.now(tz=timezone.utc)
        date_from, history_window_days, history_window_label = resolve_history_window(
            history_days, use_all_history, date_to,
        )
        scored_pairs = score_watchlist(balance_ngn, daily_loss_pct, risk_pct)
        planning_symbol = resolve_planning_symbol(symbol, scored_pairs)
        pair_info = get_pair_info(planning_symbol, infer_asset_class(planning_symbol, scored_pairs))
        all_deals = get_history_deals(date_from, date_to)
        deals = [deal for deal in all_deals if deal.get("symbol") == planning_symbol]
        history_stats = analyze_history(deals)

        return {
            "balance_ngn": balance_ngn,
            "balance_source": balance_source,
            "account_snapshot": account_snapshot,
            "planning_symbol": planning_symbol,
            "history_window_days": history_window_days,
            "history_window_label": history_window_label,
            "history_deals_count": len(deals),
            "history_total_deals_count": len(all_deals),
            "history_deals": deals,
            "history_stats": history_stats,
            "pair_info": pair_info,
        }
    finally:
        mt5.shutdown()


@app.get("/health")
def health():
    return {"status": "ok"}


# =============================================================================
# Executive Arm API Endpoints
# =============================================================================

@app.get("/executive/settings")
def executive_settings(symbol: str = "BTCUSDm"):
    """
    Get current enforcement settings for a symbol.
    MT5 EA polls this endpoint to get lot limits and rules.
    """
    return get_settings(symbol)


@app.post("/executive/heartbeat")
def executive_heartbeat(ea_status: dict):
    """
    Receive heartbeat from MT5 EA.
    ea_status should contain: version, account, positions, errors
    """
    return get_controller().handle_heartbeat(ea_status)


@app.get("/executive/status")
def executive_status():
    """Get Executive Arm system status."""
    return get_controller().get_status()


@app.get("/executive/actions")
def executive_actions(limit: int = 50):
    """Get recent enforcement actions."""
    return {"actions": get_controller().get_action_history(limit)}


@app.post("/executive/enforce")
def executive_enforce(symbol: str, lot: float):
    """
    Check if a lot size is allowed.
    Used by MT5 EA before opening a position.
    """
    result = enforce_lot(symbol, lot)
    return {
        "allowed": result.allowed,
        "action": result.action,
        "reason": result.reason,
        "requested_lot": result.requested_lot,
        "max_lot": result.max_lot,
        "suggested_lot": result.suggested_lot,
    }


@app.post("/executive/check-close")
def executive_check_close(profit: float, positions: list[dict]):
    """
    Check if auto-close should be triggered.
    Called periodically by MT5 EA to monitor profit.
    """
    # Convert dict positions to PositionInfo objects
    pos_objects = [PositionInfo(**p) for p in positions]
    result = check_close(profit, pos_objects)
    return {
        "should_monitor": result.should_monitor,
        "should_close": result.should_close,
        "action": result.action,
        "reason": result.reason,
        "current_profit": result.current_profit,
        "target": result.target,
        "buffer_percent": result.buffer_percent,
    }


@app.post("/executive/configure")
def executive_configure(config: dict):
    """
    Update Executive Arm settings.
    Body should contain enforcement configuration.
    """
    controller = get_controller()
    
    # Parse settings from dict
    settings = EnforcementSettings(
        max_lot_per_symbol=config.get("max_lot_per_symbol", {}),
        default_max_lot=config.get("default_max_lot", 0.1),
        daily_profit_target=config.get("daily_profit_target", 0.0),
        points_budget=config.get("points_budget", 0.0),
        use_lot_normalizer=config.get("use_lot_normalizer", True),
        auto_close_buffer=config.get("auto_close_buffer", 1.10),
        auto_close_threshold=config.get("auto_close_threshold", 1.05),
        min_hold_seconds=config.get("min_hold_seconds", 300),
        enforcement_mode=config.get("enforcement_mode", "HARD"),
        emergency_override_password=config.get("emergency_override_password", ""),
    )
    
    controller.update_settings(settings)
    
    return {
        "status": "configured",
        "mode": settings.enforcement_mode,
        "daily_target": settings.daily_profit_target,
    }


@app.post("/executive/set-lot-limit")
def executive_set_lot_limit(symbol: str, max_lot: float):
    """Set max lot for a specific symbol."""
    controller = get_controller()
    controller.set_symbol_lot_limit(symbol, max_lot)
    return {"status": "updated", "symbol": symbol, "max_lot": max_lot}


@app.post("/executive/reset")
def executive_reset():
    """Reset daily limits (for day boundary)."""
    controller = get_controller()
    controller.reset_daily_limits()
    return {"status": "reset", "message": "Daily limits have been reset"}


# =============================================================================
# Graceful Shutdown Handling
# =============================================================================

server = None


def shutdown_handler(signum, frame):
    """Handle SIGTERM and SIGINT signals for graceful shutdown."""
    print(f"\n[Shutdown] Received signal {signum}, shutting down gracefully...")
    if mt5.initialize():
        mt5.shutdown()
        print("[Shutdown] MT5 connection closed")
    if server is not None:
        server.should_exit = True
        print("[Shutdown] Server exit flag set")


def cleanup():
    """Cleanup function registered with atexit."""
    print("[Cleanup] Performing cleanup on exit...")
    if mt5.initialize():
        mt5.shutdown()
        print("[Cleanup] MT5 connection closed")


# Register signal handlers
signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)

# Register atexit cleanup
atexit.register(cleanup)


# Run the server (if this file is executed directly)
if __name__ == "__main__":
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8000, reload=True))
    print("Starting server on http://0.0.0.0:8000")
    print("Press Ctrl+C to stop")
    print("Shutdown handlers registered for SIGTERM and SIGINT")
    print("-" * 50)
    server.run()
