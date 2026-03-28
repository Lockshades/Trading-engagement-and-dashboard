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
    get_open_position_alignment,
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


def test_analyze_history_uses_trade_average_fallback_for_thin_history():
    deals = [
        {"time": 1705190400, "profit": 1000.0, "volume": 0.01, "symbol": "BTCUSDm"},
        {"time": 1705190500, "profit": -400.0, "volume": 0.01, "symbol": "BTCUSDm"},
        {"time": 1705190600, "profit": 500.0, "volume": 0.01, "symbol": "BTCUSDm"},
    ]
    stats = analyze_history(deals)
    assert stats["total_trading_days"] == 1
    assert stats["total_deals"] == 3
    assert stats["planner_baseline_source"] == "trade_average_fallback"
    assert stats["planning_win_rate"] == pytest.approx(2 / 3, rel=0.001)
    assert stats["planning_avg_win_ngn"] == pytest.approx(750.0, rel=0.001)
    assert stats["planning_avg_loss_ngn"] == pytest.approx(400.0, rel=0.001)


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


def test_milestones_use_planner_baseline_stats_when_overrides_absent():
    daily_stats = {
        **SAMPLE_STATS,
        "win_rate": 0.20,
        "avg_win_ngn": 500.0,
        "avg_loss_ngn": 1800.0,
        "planning_win_rate": 0.75,
        "planning_avg_win_ngn": 3200.0,
        "planning_avg_loss_ngn": 900.0,
        "planner_baseline_source": "trade_average_fallback",
    }
    baseline_milestones = compute_milestones(
        100_000,
        200_000,
        daily_stats,
        SAMPLE_PAIR_INFO,
        {},
        0.01,
        0.02,
    )
    explicit_override_milestones = compute_milestones(
        100_000,
        200_000,
        daily_stats,
        SAMPLE_PAIR_INFO,
        {
            "win_rate": daily_stats["planning_win_rate"],
            "avg_win_ngn": daily_stats["planning_avg_win_ngn"],
            "avg_loss_ngn": daily_stats["planning_avg_loss_ngn"],
        },
        0.01,
        0.02,
    )
    assert baseline_milestones[0]["est_days_mid"] == explicit_override_milestones[0]["est_days_mid"]


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


def test_milestones_preserve_move_unit_for_crypto_pairs():
    crypto_pair = {
        **SAMPLE_PAIR_INFO,
        "symbol": "BTCUSDm",
        "move_unit_label": "Points",
        "move_unit_short": "pt",
        "move_value_ngn_per_lot": 160.0,
    }
    milestones = compute_milestones(
        100_000,
        200_000,
        SAMPLE_STATS,
        crypto_pair,
        {},
        0.01,
        0.02,
    )
    assert milestones[0]["move_unit_label"] == "Points"
    assert milestones[0]["move_unit_short"] == "pt"
    assert "daily_target_units" in milestones[0]


def test_kpi_returns_unit_metadata_for_non_forex_pairs():
    kpi = get_kpi_today(
        _make_deals([320]),
        {
            "daily_target_ngn": 2000,
            "daily_target_units": 12.5,
            "move_unit_label": "Points",
            "move_unit_short": "pt",
            "min_trades_per_day": 2,
            "max_trades_per_day": 4,
        },
        160.0,
    )
    assert kpi["move_unit_label"] == "Points"
    assert kpi["move_unit_short"] == "pt"
    assert kpi["actual_units"] == 2.0


def test_kpi_uses_explicit_daily_limit_balance():
    kpi = get_kpi_today(
        _make_deals([-3000]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        160.0,
        balance=150_000,
        daily_loss_pct=0.02,
        daily_limit_balance=100_000,
    )
    assert kpi["daily_limit_balance_ngn"] == 100_000
    assert kpi["daily_limit_ngn"] == 2_000
    assert kpi["status"] == "DANGER"


def test_open_position_alignment_uses_trade_slots_for_daily_plan():
    alignment = get_open_position_alignment(
        [
            {
                "ticket": 1,
                "symbol": "BTCUSDm",
                "type": 0,
                "type_label": "BUY",
                "volume": 0.1,
                "profit": 500.0,
            }
        ],
        {
            "daily_target_ngn": 2000.0,
            "daily_target_units": 20.0,
            "move_unit_label": "Points",
            "move_unit_short": "pt",
            "lot_size": 0.1,
            "min_trades_per_day": 2,
            "max_trades_per_day": 4,
        },
        1000.0,
        closed_trades_count=0,
        volume_step=0.01,
    )
    assert alignment["planned_trade_slots"] == 2
    assert alignment["target_ngn_per_trade"] == 1000.0
    assert alignment["target_units_per_trade"] == 10.0
    assert alignment["positions"][0]["pct_of_slot_target"] == 50.0
    assert alignment["positions"][0]["settings_status"] == "MATCH"
    assert alignment["positions"][0]["lot_matches_plan"] is True
    assert alignment["status"] == "ON_TRACK"


def test_open_position_alignment_flags_lot_and_trade_limit_mismatches():
    alignment = get_open_position_alignment(
        [
            {
                "ticket": 1,
                "symbol": "BTCUSDm",
                "type": 0,
                "type_label": "BUY",
                "volume": 0.2,
                "profit": 500.0,
            },
            {
                "ticket": 2,
                "symbol": "BTCUSDm",
                "type": 0,
                "type_label": "BUY",
                "volume": 0.1,
                "profit": 200.0,
            },
        ],
        {
            "daily_target_ngn": 2000.0,
            "daily_target_units": 20.0,
            "move_unit_label": "Points",
            "move_unit_short": "pt",
            "lot_size": 0.1,
            "min_trades_per_day": 1,
            "max_trades_per_day": 1,
        },
        1000.0,
        closed_trades_count=0,
        volume_step=0.01,
    )
    assert alignment["matching_positions_count"] == 0
    assert alignment["remaining_trade_slots"] == 0
    assert alignment["positions"][0]["settings_status"] == "REVIEW"
    assert alignment["positions"][1]["within_trade_limit"] is False
    assert alignment["status"] == "REVIEW"


def test_kpi_zero_pip_value_returns_zero_pips():
    kpi = get_kpi_today(
        _make_deals([1000]),
        {"daily_target_ngn": 2000, "daily_target_pips": 12.5, "min_trades_per_day": 2, "max_trades_per_day": 4},
        0.0,
    )
    assert kpi["actual_pips"] == 0.0
