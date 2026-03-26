"""
Risk Scanner API
----------------
Run: cd backend && uvicorn api:app --reload --port 8000
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import MetaTrader5 as mt5
from pydantic import BaseModel, Field

from data_fetcher import BARS, TIMEFRAME, calc_atr, score_symbol, FALLBACK_BALANCE_NGN
from target_planner import analyze_history, compute_milestones, get_kpi_today


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
ALLOWED_OVERRIDE_KEYS = {"win_rate", "avg_win_ngn", "avg_loss_ngn"}


class ScanRequest(BaseModel):
    balance: Optional[float] = None
    daily_loss_pct: Optional[float] = 0.02
    risk_pct: Optional[float] = 0.01


class PlanRequest(BaseModel):
    target_ngn: float
    balance: Optional[float] = None
    daily_loss_pct: Optional[float] = 0.02
    risk_pct: Optional[float] = 0.01
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


def resolve_balance(requested_balance: Optional[float]) -> float:
    if requested_balance is not None and requested_balance > 0:
        return requested_balance

    account = mt5.account_info()
    if account and account.balance and account.balance > 0:
        return account.balance

    return FALLBACK_BALANCE_NGN


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


def get_pair_info(symbol: str) -> dict:
    info = ensure_symbol_info(symbol)
    if info is None:
        return {
            "symbol": symbol,
            "volume_min": 0.1,
            "volume_step": 0.1,
            "volume_max": 100.0,
            "trade_tick_value": 160.0,
            "point": 0.01,
            "atr": 15.0,
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

    return {
        "symbol": symbol,
        "volume_min": volume_min,
        "volume_step": volume_step,
        "volume_max": volume_max,
        "trade_tick_value": trade_tick_value,
        "point": point,
        "atr": get_symbol_atr(symbol),
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


@app.post("/scan")
def scan(req: Optional[ScanRequest] = None):
    req = req or ScanRequest()

    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    try:
        balance = resolve_balance(req.balance)
        daily_loss_pct = resolve_ratio(req.daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(req.risk_pct, 0.01)
        pairs = score_watchlist(balance, daily_loss_pct, risk_pct)

        return {
            "balance_ngn": balance,
            "daily_limit_ngn": balance * daily_loss_pct,
            "risk_per_trade": balance * risk_pct,
            "daily_loss_pct": daily_loss_pct,
            "risk_pct": risk_pct,
            "pairs": pairs,
            "summary": summarize_pairs(pairs),
        }
    finally:
        mt5.shutdown()


@app.post("/plan")
def plan(req: PlanRequest):
    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    try:
        balance = resolve_balance(req.balance)
        daily_loss_pct = resolve_ratio(req.daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(req.risk_pct, 0.01)
        scored_pairs = score_watchlist(balance, daily_loss_pct, risk_pct)
        planning_symbol = select_planning_symbol(scored_pairs)
        pair_info = get_pair_info(planning_symbol)

        date_to = datetime.now(tz=timezone.utc)
        date_from = date_to - timedelta(days=HISTORY_LOOKBACK_DAYS)
        deals = get_history_deals(date_from, date_to)
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
            "target_ngn": req.target_ngn,
            "daily_loss_pct": daily_loss_pct,
            "risk_pct": risk_pct,
            "planning_symbol": planning_symbol,
            "history_stats": history_stats,
            "pair_info": pair_info,
            "milestones": milestones,
        }
    finally:
        mt5.shutdown()


@app.get("/kpi/today")
def kpi_today(
    balance: Optional[float] = None,
    daily_loss_pct: Optional[float] = 0.02,
    risk_pct: Optional[float] = 0.01,
    target_ngn: float = 1_000_000,
):
    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    try:
        resolved_balance = resolve_balance(balance)
        daily_loss_pct = resolve_ratio(daily_loss_pct, 0.02)
        risk_pct = resolve_ratio(risk_pct, 0.01)

        scored_pairs = score_watchlist(resolved_balance, daily_loss_pct, risk_pct)
        planning_symbol = select_planning_symbol(scored_pairs)
        pair_info = get_pair_info(planning_symbol)

        now_utc = datetime.now(tz=timezone.utc)
        history_start = now_utc - timedelta(days=HISTORY_LOOKBACK_DAYS)
        history_deals = get_history_deals(history_start, now_utc)
        history_stats = analyze_history(history_deals)

        milestones = []
        if target_ngn > resolved_balance:
            milestones = compute_milestones(
                resolved_balance,
                target_ngn,
                history_stats,
                pair_info,
                {},
                risk_pct,
                daily_loss_pct,
            )

        current_milestone = next(
            (milestone for milestone in milestones if milestone["capital_end"] > resolved_balance),
            None,
        )

        kpi = {}
        if current_milestone:
            today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            deals_today = get_history_deals(today_start, now_utc)
            pip_value_ngn = 0.0
            if pair_info["point"] > 0:
                pip_value_ngn = (
                    pair_info["trade_tick_value"] / pair_info["point"]
                ) * current_milestone["lot_size"]

            kpi = get_kpi_today(
                deals_today,
                current_milestone,
                pip_value_ngn,
                resolved_balance,
                daily_loss_pct,
            )

        return {
            "date": now_utc.date().isoformat(),
            "balance_ngn": resolved_balance,
            "planning_symbol": planning_symbol,
            "current_milestone": current_milestone,
            "kpi": kpi,
        }
    finally:
        mt5.shutdown()


@app.get("/health")
def health():
    return {"status": "ok"}
