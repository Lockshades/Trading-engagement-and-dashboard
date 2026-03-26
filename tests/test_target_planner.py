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
    assert lots == sorted(lots)

def test_confidence_band_wider_on_low_data():
    low_stats  = {**SAMPLE_STATS, "low_data_warning": True,  "data_quality": "LOW"}
    high_stats = {**SAMPLE_STATS, "low_data_warning": False, "data_quality": "HIGH"}
    ms_low  = compute_milestones(100_000, 200_000, low_stats,  SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    ms_high = compute_milestones(100_000, 200_000, high_stats, SAMPLE_PAIR_INFO, {}, 0.01, 0.02)
    band_low  = ms_low[0]["est_days_high"]  - ms_low[0]["est_days_low"]
    band_high = ms_high[0]["est_days_high"] - ms_high[0]["est_days_low"]
    assert band_low > band_high

def test_override_win_rate_applied():
    ms_base     = compute_milestones(100_000, 200_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, {},                  0.01, 0.02)
    ms_override = compute_milestones(100_000, 200_000, SAMPLE_STATS, SAMPLE_PAIR_INFO, {"win_rate": 0.80}, 0.01, 0.02)
    assert ms_override[0]["est_days_mid"] < ms_base[0]["est_days_mid"]
