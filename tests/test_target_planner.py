from datetime import date, datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from target_planner import (  # noqa: E402
    DEFAULTS,
    analyze_history,
    compute_milestones,
    get_kpi_today,
)


SAMPLE_DEALS = [
    {"time": 1705190400, "symbol": "BTCUSDm", "profit": 14992.0, "volume": 0.02},
    {"time": 1705190400, "symbol": "BTCUSDm", "profit": 6242.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": 3701.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": -5117.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": 18625.0, "volume": 0.01},
    {"time": 1705276800, "symbol": "BTCUSDm", "profit": -5067.0, "volume": 0.01},
    {"time": 1705363200, "symbol": "BTCUSDm", "profit": -504.0, "volume": 0.01},
    {"time": 1705363200, "symbol": "BTCUSDm", "profit": 102.0, "volume": 0.01},
]


def test_analyze_history_win_rate():
    stats = analyze_history(SAMPLE_DEALS)
    assert stats["win_rate"] == pytest.approx(2 / 3, rel=0.01)


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
        {"time": 1705363200, "profit": 800.0, "volume": 0.01, "symbol": "BTCUSDm"},
    ]
    stats = analyze_history(deals)
    assert stats["max_consecutive_losses"] == 2


SAMPLE_STATS = {
    "win_rate": 0.60,
    "avg_win_ngn": 3000.0,
    "avg_loss_ngn": 1500.0,
    "std_win": 500.0,
    "std_loss": 400.0,
    "avg_trades_per_day": 3.0,
    "marginal_cutoff": 4,
    "max_consecutive_losses": 2,
    "avg_volume": 0.01,
    "total_trading_days": 20,
    "low_data_warning": False,
    "data_quality": "MEDIUM",
    "no_history": False,
}

SAMPLE_PAIR_INFO = {
    "symbol": "ETHUSDm",
    "volume_min": 0.1,
    "volume_step": 0.1,
    "volume_max": 100.0,
    "trade_tick_value": 160.0,
    "point": 0.01,
    "atr": 15.0,
}


def test_milestones_start_below_target():
    milestones = compute_milestones(
        100_000,
        200_000,
        SAMPLE_STATS,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    assert len(milestones) >= 1
    assert milestones[-1]["capital_end"] >= 200_000


def test_milestone_lot_increases_with_capital():
    milestones = compute_milestones(
        100_000,
        500_000,
        SAMPLE_STATS,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    lots = [milestone["lot_size"] for milestone in milestones]
    assert lots == sorted(lots)


def test_confidence_band_wider_on_low_data():
    low_stats = {**SAMPLE_STATS, "low_data_warning": True, "data_quality": "LOW"}
    high_stats = {**SAMPLE_STATS, "low_data_warning": False, "data_quality": "HIGH"}
    low_milestones = compute_milestones(
        100_000,
        200_000,
        low_stats,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    high_milestones = compute_milestones(
        100_000,
        200_000,
        high_stats,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    low_band = low_milestones[0]["est_days_high"] - low_milestones[0]["est_days_low"]
    high_band = high_milestones[0]["est_days_high"] - high_milestones[0]["est_days_low"]
    assert low_band > high_band


def test_override_win_rate_applied():
    base_milestones = compute_milestones(
        100_000,
        200_000,
        SAMPLE_STATS,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    override_milestones = compute_milestones(
        100_000,
        200_000,
        SAMPLE_STATS,
        SAMPLE_PAIR_INFO,
        {"win_rate": 0.80},
        0.01,
        0.02,
    )
    assert override_milestones[0]["est_days_mid"] < base_milestones[0]["est_days_mid"]


def test_milestones_use_checkpoint_progression_for_large_targets():
    pair_info = {
        "symbol": "US500m",
        "volume_min": 0.09,
        "volume_step": 0.01,
        "volume_max": 100.0,
        "trade_tick_value": 1.0,
        "point": 0.01,
        "atr": 99.399,
    }
    milestones = compute_milestones(
        100_000,
        500_000,
        SAMPLE_STATS,
        pair_info,
        {},
        0.0001,
        0.02,
    )
    assert len(milestones) >= 4
    assert milestones[-1]["capital_end"] == 500_000
    assert all(milestone["capital_end"] > milestone["capital_start"] for milestone in milestones)


def test_milestones_flag_review_when_expectancy_is_not_positive():
    negative_stats = {
        **SAMPLE_STATS,
        "win_rate": 0.35,
        "avg_win_ngn": 1000.0,
        "avg_loss_ngn": 2200.0,
    }
    milestones = compute_milestones(
        100_000,
        200_000,
        negative_stats,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    assert milestones[0]["estimation_mode"] == "review"
    assert milestones[0]["est_days_mid"] is None


def _make_deals(profits):
    today_ts = int(datetime.combine(date.today(), datetime.min.time()).timestamp())
    return [
        {"time": today_ts, "profit": profit, "volume": 0.1, "symbol": "ETHUSDm"}
        for profit in profits
    ]


def test_kpi_ahead():
    kpi = get_kpi_today(
        _make_deals([3500]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
    )
    assert kpi["status"] == "AHEAD"
    assert kpi["actual_ngn"] == 3500


def test_kpi_complete_once_target_and_min_trades_hit():
    kpi = get_kpi_today(
        _make_deals([1200, 900]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
    )
    assert kpi["status"] == "COMPLETE"


def test_kpi_behind_when_negative_but_not_at_daily_limit():
    kpi = get_kpi_today(
        _make_deals([-500]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
        balance=100_000,
        daily_loss_pct=0.02,
    )
    assert kpi["status"] == "BEHIND"


def test_kpi_danger_daily_limit_hit():
    kpi = get_kpi_today(
        _make_deals([-5000]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
        balance=100_000,
        daily_loss_pct=0.02,
    )
    assert kpi["status"] == "DANGER"


def test_kpi_trades_remaining():
    kpi = get_kpi_today(
        _make_deals([1000]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
    )
    assert kpi["trades_remaining"] == 3


def test_kpi_zero_pip_value_returns_zero_pips():
    kpi = get_kpi_today(
        _make_deals([1000]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        0.0,
    )
    assert kpi["actual_pips"] == 0.0
