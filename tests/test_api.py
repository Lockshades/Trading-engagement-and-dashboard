import asyncio
import os
import sys
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import api  # noqa: E402


def request_json(method: str, path: str, payload=None):
    async def _request():
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            if method == "GET":
                response = await client.get(path)
            else:
                response = await client.post(path, json=payload)
        return response

    response = asyncio.run(_request())
    return response.status_code, response.json()


@pytest.fixture
def stub_mt5_ok(monkeypatch):
    monkeypatch.setattr(api.mt5, "initialize", lambda: True)
    monkeypatch.setattr(api.mt5, "shutdown", lambda: None)
    monkeypatch.setattr(api.mt5, "last_error", lambda: (0, "ok"))
    monkeypatch.setattr(api.mt5, "account_info", lambda: SimpleNamespace(balance=200_000))


def test_resolve_balance_prefers_explicit_value(monkeypatch):
    monkeypatch.setattr(api.mt5, "account_info", lambda: SimpleNamespace(balance=500_000))
    assert api.resolve_balance(150_000) == 150_000


def test_select_planning_symbol_prefers_safer_classification():
    pairs = [
        {"symbol": "RISKY_HIGH", "classification": "RISKY", "score": 99},
        {"symbol": "SAFE_LOWER", "classification": "SAFE", "score": 60},
    ]
    assert api.select_planning_symbol(pairs) == "SAFE_LOWER"


def test_select_planning_symbol_falls_back_when_no_pairs():
    assert api.select_planning_symbol([]) == api.DEFAULT_PLAN_SYMBOL


def test_sanitize_overrides_keeps_only_supported_numeric_values():
    clean = api.sanitize_overrides({
        "win_rate": "0.65",
        "avg_win_ngn": 2500,
        "avg_loss_ngn": None,
        "unexpected": 123,
        "bad_number": "oops",
    })
    assert clean == {"win_rate": 0.65, "avg_win_ngn": 2500.0}


def test_normalize_deal_requires_symbol_and_profit():
    valid = api.normalize_deal({"time": 1, "profit": 50, "volume": 0.1, "symbol": "ETHUSDm"})
    invalid = api.normalize_deal({"time": 1, "profit": 50, "volume": 0.1, "symbol": ""})
    assert valid == {"time": 1, "profit": 50.0, "volume": 0.1, "symbol": "ETHUSDm"}
    assert invalid is None


def test_scan_returns_mt5_error_payload_when_initialize_fails(monkeypatch):
    monkeypatch.setattr(api.mt5, "initialize", lambda: False)
    monkeypatch.setattr(api.mt5, "last_error", lambda: (500, "mt5 down"))

    status, body = request_json("POST", "/scan", {"balance": 150_000, "daily_loss_pct": 0.02, "risk_pct": 0.01})
    assert status == 200
    assert "MT5 connection failed" in body["error"]


def test_scan_endpoint_returns_summary_counts(stub_mt5_ok, monkeypatch):
    pairs = [
        {"symbol": "ETHUSDm", "classification": "SAFE", "score": 88},
        {"symbol": "XAUUSDm", "classification": "MODERATE", "score": 64},
        {"symbol": "BTCUSDm", "classification": "RISKY", "score": 20},
    ]
    monkeypatch.setattr(api, "score_watchlist", lambda balance, daily_loss_pct, risk_pct: pairs)

    status, body = request_json("POST", "/scan", {"balance": 150_000, "daily_loss_pct": 0.02, "risk_pct": 0.01})
    assert status == 200
    assert body["summary"] == {"total": 3, "safe": 1, "moderate": 1, "risky": 1}


def test_plan_endpoint_returns_empty_milestones_when_target_not_above_balance(stub_mt5_ok, monkeypatch):
    monkeypatch.setattr(api, "score_watchlist", lambda balance, daily_loss_pct, risk_pct: [
        {"symbol": "ETHUSDm", "classification": "SAFE", "score": 88}
    ])
    monkeypatch.setattr(api, "get_pair_info", lambda symbol: {
        "symbol": symbol,
        "volume_min": 0.1,
        "volume_step": 0.1,
        "volume_max": 100.0,
        "trade_tick_value": 160.0,
        "point": 0.01,
        "atr": 15.0,
    })
    monkeypatch.setattr(api, "get_history_deals", lambda date_from, date_to: [])

    status, body = request_json("POST", "/plan", {
        "target_ngn": 100_000,
        "balance": 150_000,
        "daily_loss_pct": 0.02,
        "risk_pct": 0.01,
        "overrides": {},
    })
    assert status == 200
    assert body["planning_symbol"] == "ETHUSDm"
    assert body["milestones"] == []
    assert body["history_stats"]["no_history"] is True


def test_plan_endpoint_sanitizes_overrides_before_milestone_compute(stub_mt5_ok, monkeypatch):
    captured = {}

    monkeypatch.setattr(api, "score_watchlist", lambda balance, daily_loss_pct, risk_pct: [
        {"symbol": "ETHUSDm", "classification": "SAFE", "score": 88}
    ])
    monkeypatch.setattr(api, "get_pair_info", lambda symbol: {
        "symbol": symbol,
        "volume_min": 0.1,
        "volume_step": 0.1,
        "volume_max": 100.0,
        "trade_tick_value": 160.0,
        "point": 0.01,
        "atr": 15.0,
    })
    monkeypatch.setattr(api, "get_history_deals", lambda date_from, date_to: [])
    monkeypatch.setattr(api, "analyze_history", lambda deals: {
        "win_rate": 0.6,
        "avg_win_ngn": 3000.0,
        "avg_loss_ngn": 1500.0,
        "std_win": 500.0,
        "std_loss": 400.0,
        "avg_trades_per_day": 3.0,
        "marginal_cutoff": 4,
        "max_consecutive_losses": 2,
        "total_trading_days": 20,
        "low_data_warning": False,
        "data_quality": "MEDIUM",
        "no_history": False,
    })

    def fake_compute(start, target, stats, pair_info, overrides, risk_pct, daily_loss_pct):
        captured["overrides"] = overrides
        return [{"capital_start": start, "capital_end": target, "lot_size": 0.1}]

    monkeypatch.setattr(api, "compute_milestones", fake_compute)

    status, body = request_json("POST", "/plan", {
        "target_ngn": 300_000,
        "balance": 150_000,
        "daily_loss_pct": 0.02,
        "risk_pct": 0.01,
        "overrides": {
            "win_rate": 0.72,
            "avg_win_ngn": 3500,
            "unexpected": 999,
        },
    })
    assert status == 200
    assert captured["overrides"] == {"win_rate": 0.72, "avg_win_ngn": 3500.0}
    assert body["milestones"][0]["capital_end"] == 300_000


def test_kpi_endpoint_returns_empty_payload_without_active_milestone(stub_mt5_ok, monkeypatch):
    monkeypatch.setattr(api, "score_watchlist", lambda balance, daily_loss_pct, risk_pct: [
        {"symbol": "ETHUSDm", "classification": "SAFE", "score": 88}
    ])
    monkeypatch.setattr(api, "get_pair_info", lambda symbol: {
        "symbol": symbol,
        "volume_min": 0.1,
        "volume_step": 0.1,
        "volume_max": 100.0,
        "trade_tick_value": 160.0,
        "point": 0.01,
        "atr": 15.0,
    })
    monkeypatch.setattr(api, "get_history_deals", lambda date_from, date_to: [])

    status, body = request_json("GET", "/kpi/today?balance=150000&daily_loss_pct=0.02&risk_pct=0.01&target_ngn=100000")
    assert status == 200
    assert body["current_milestone"] is None
    assert body["kpi"] == {}


def test_kpi_endpoint_passes_current_lot_pip_value_to_kpi_math(stub_mt5_ok, monkeypatch):
    captured = {}

    monkeypatch.setattr(api, "score_watchlist", lambda balance, daily_loss_pct, risk_pct: [
        {"symbol": "ETHUSDm", "classification": "SAFE", "score": 88}
    ])
    monkeypatch.setattr(api, "get_pair_info", lambda symbol: {
        "symbol": symbol,
        "volume_min": 0.1,
        "volume_step": 0.1,
        "volume_max": 100.0,
        "trade_tick_value": 160.0,
        "point": 0.01,
        "atr": 15.0,
    })
    monkeypatch.setattr(api, "get_history_deals", lambda date_from, date_to: [])
    monkeypatch.setattr(api, "analyze_history", lambda deals: {
        "win_rate": 0.6,
        "avg_win_ngn": 3000.0,
        "avg_loss_ngn": 1500.0,
        "std_win": 500.0,
        "std_loss": 400.0,
        "avg_trades_per_day": 3.0,
        "marginal_cutoff": 4,
        "max_consecutive_losses": 2,
        "total_trading_days": 20,
        "low_data_warning": False,
        "data_quality": "MEDIUM",
        "no_history": False,
    })
    monkeypatch.setattr(api, "compute_milestones", lambda balance, target, stats, pair_info, overrides, risk_pct, daily_loss_pct: [
        {
            "capital_start": balance,
            "capital_end": target,
            "lot_size": 0.2,
            "daily_target_ngn": 2000,
            "daily_target_pips": 12.5,
            "min_trades_per_day": 2,
            "max_trades_per_day": 4,
        }
    ])

    def fake_get_kpi_today(deals_today, milestone, pip_value_ngn, balance, daily_loss_pct):
        captured["pip_value_ngn"] = pip_value_ngn
        return {"status": "ON_TRACK", "actual_ngn": 0, "target_ngn": milestone["daily_target_ngn"]}

    monkeypatch.setattr(api, "get_kpi_today", fake_get_kpi_today)

    status, body = request_json("GET", "/kpi/today?balance=150000&daily_loss_pct=0.02&risk_pct=0.01&target_ngn=300000")
    assert status == 200
    assert captured["pip_value_ngn"] == 3200.0
    assert body["planning_symbol"] == "ETHUSDm"
    assert body["kpi"]["status"] == "ON_TRACK"
