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
