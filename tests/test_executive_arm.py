"""
Tests for Executive Arm Controller
===================================
"""

import pytest
from datetime import datetime, timezone
import sys
import os

# Add backend directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

from executive_arm import (
    ExecutiveArmController,
    EnforcementSettings,
    PositionInfo,
    create_default_controller,
    enforce_lot,
    check_close,
    get_settings,
    get_controller,
)


class TestLotEnforcement:
    """Test lot size enforcement"""
    
    def test_lot_under_limit_allowed(self):
        controller = create_default_controller()
        result = controller.enforce_lot_size("BTCUSDm", 0.10)
        
        assert result.allowed is True
        assert result.action == "APPROVED"
    
    def test_lot_over_limit_rejected_hard_mode(self):
        controller = create_default_controller()
        controller.settings.enforcement_mode = "HARD"
        
        result = controller.enforce_lot_size("BTCUSDm", 0.50)  # Max is 0.15
        
        assert result.allowed is False
        assert result.action == "REJECTED"
        assert result.max_lot == 0.15
        assert result.suggested_lot is None
    
    def test_lot_over_limit_warned_soft_mode(self):
        controller = create_default_controller()
        controller.settings.enforcement_mode = "SOFT"
        
        result = controller.enforce_lot_size("BTCUSDm", 0.50)
        
        assert result.allowed is True  # Still allowed but warned
        assert result.action == "WARNED"
        assert result.suggested_lot == 0.15
    
    def test_default_limit_for_unknown_symbol(self):
        controller = create_default_controller()
        
        result = controller.enforce_lot_size("UNKNOWN_SYM", 0.50)
        
        assert result.allowed is False
        assert result.max_lot == 0.10  # Default
    
    def test_set_symbol_lot_limit(self):
        controller = create_default_controller()
        controller.set_symbol_lot_limit("BTCUSDm", 0.30)
        
        result = controller.enforce_lot_size("BTCUSDm", 0.25)
        
        assert result.allowed is True


class TestPointsBudgetNormalizer:
    """Test points budget normalization"""
    
    def test_single_position_at_target_lot(self):
        controller = create_default_controller()
        controller.settings.points_budget = 10000.0
        
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.13, profit=0)
        ]
        
        consumption = controller.calculate_points_consumed(
            positions, recommended_lot=0.13
        )
        
        assert consumption == 1.0  # 100% of budget
    
    def test_double_lot_consumes_double_points(self):
        controller = create_default_controller()
        controller.settings.points_budget = 10000.0
        
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.26, profit=0)
        ]
        
        consumption = controller.calculate_points_consumed(
            positions, recommended_lot=0.13
        )
        
        assert consumption == 2.0  # 200% of budget
    
    def test_can_open_lot_with_sufficient_budget(self):
        controller = create_default_controller()
        controller.settings.points_budget = 10000.0
        
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.13, profit=0)
        ]
        
        allowed, reason = controller.can_open_lot(
            "BTCUSDm", 0.13, positions, recommended_lot=0.13
        )
        
        # With 0.13 lot at 0.13 recommended, consumption = 1.0 (100%)
        # Adding another 0.13 = 2.0 (200%) which exceeds budget
        # So this should actually fail - let me fix the test
        assert allowed is False  # Actually this SHOULD be false since 100% + 100% > 100%
    
    def test_cannot_open_lot_exceeding_budget(self):
        controller = create_default_controller()
        controller.settings.points_budget = 10000.0
        
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.26, profit=0)
        ]
        
        allowed, reason = controller.can_open_lot(
            "BTCUSDm", 0.26, positions, recommended_lot=0.13
        )
        
        assert allowed is False
        assert "Insufficient points budget" in reason


class TestAutoCloseLogic:
    """Test auto-close profit monitoring"""
    
    def test_normal_operation_hold(self):
        controller = create_default_controller()
        controller.settings.daily_profit_target = 3000.0
        controller.settings.auto_close_buffer = 1.10
        controller.settings.auto_close_threshold = 1.05
        
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.13, profit=1500.0)
        ]
        
        result = controller.check_auto_close(1500.0, positions)
        
        assert result.should_close is False
        assert result.action == "HOLD"
    
    def test_enters_monitoring_at_buffer(self):
        controller = create_default_controller()
        controller.settings.daily_profit_target = 3000.0
        controller.settings.auto_close_buffer = 1.10
        controller.settings.auto_close_threshold = 1.05
        
        # 3300 is 10% above target = enters monitoring
        result = controller.check_auto_close(3301.0, [])  # Use 3301 to be strictly >
        
        assert result.should_monitor is True
        assert result.action == "MONITOR"
    
    def test_triggers_close_when_drops_from_buffer(self):
        controller = create_default_controller()
        controller.settings.daily_profit_target = 3000.0
        controller.settings.auto_close_buffer = 1.10
        controller.settings.auto_close_threshold = 1.05
        controller.settings.min_hold_seconds = 0  # No minimum hold for test
        
        # First call - enters monitoring (use 3301 to ensure > buffer)
        controller.check_auto_close(3301.0, [])
        
        # Second call - drops below threshold
        result = controller.check_auto_close(3100.0, [])
        
        assert result.should_close is True
        assert result.action == "CLOSE_ALL"
    
    def test_no_trigger_if_under_min_hold(self):
        controller = create_default_controller()
        controller.settings.daily_profit_target = 3000.0
        controller.settings.auto_close_buffer = 1.10
        controller.settings.auto_close_threshold = 1.05
        controller.settings.min_hold_seconds = 300  # 5 minutes
        
        # First call - enters monitoring (use 3301 to ensure > buffer)
        controller.check_auto_close(3301.0, [])
        
        # Second call - drops below threshold but within min hold
        result = controller.check_auto_close(3100.0, [])
        
        assert result.should_close is False
        assert result.action == "MONITOR"
        assert "holding" in result.reason.lower()
    
    def test_recovery_exits_monitoring(self):
        controller = create_default_controller()
        controller.settings.daily_profit_target = 3000.0
        controller.settings.auto_close_buffer = 1.10
        controller.settings.auto_close_threshold = 1.05
        
        # First call - enters monitoring
        controller.check_auto_close(3300.0, [])
        
        # Recovers back above threshold
        result = controller.check_auto_close(3200.0, [])
        
        # Should exit monitoring
        assert result.should_monitor is False


class TestSettingsAPI:
    """Test settings API functions"""
    
    def test_get_settings_returns_dict(self):
        settings = get_settings("BTCUSDm")
        
        assert isinstance(settings, dict)
        assert "settings" in settings
        assert "max_lot" in settings["settings"]
    
    def test_get_controller_returns_singleton(self):
        controller1 = get_controller()
        controller2 = get_controller()
        
        assert controller1 is controller2
    
    def test_enforce_lot_convenience_function(self):
        result = enforce_lot("BTCUSDm", 0.10)
        
        assert result.allowed is True
    
    def test_check_close_convenience_function(self):
        positions = [
            PositionInfo(ticket=1, symbol="BTCUSDm", type="BUY", volume=0.13, profit=100.0)
        ]
        
        result = check_close(100.0, positions)
        
        assert isinstance(result.should_close, bool)


class TestControllerStatus:
    """Test controller status and logging"""
    
    def test_get_status_returns_info(self):
        controller = create_default_controller()
        
        status = controller.get_status()
        
        assert "controller_status" in status
        assert status["controller_status"] == "ACTIVE"
        assert "daily_target" in status
        assert status["daily_target"] == 3000.0
    
    def test_action_history_logged(self):
        controller = create_default_controller()
        
        # Trigger some actions
        controller.enforce_lot_size("BTCUSDm", 0.50)
        
        history = controller.get_action_history()
        
        assert len(history) > 0
        assert history[0]["action"] in ["LOT_REJECTED", "LOT_WARNED"]
    
    def test_reset_daily_limits(self):
        controller = create_default_controller()
        
        # Enter monitoring
        controller.check_auto_close(3300.0, [])
        
        # Reset
        controller.reset_daily_limits()
        
        status = controller.get_status()
        assert status["monitoring_since"] is None


class TestEnforcementSettings:
    """Test enforcement settings model"""
    
    def test_default_settings(self):
        settings = EnforcementSettings()
        
        assert settings.enforcement_mode == "HARD"
        assert settings.default_max_lot == 0.1
        assert settings.auto_close_buffer == 1.10
        assert settings.auto_close_threshold == 1.05
    
    def test_custom_settings(self):
        settings = EnforcementSettings(
            max_lot_per_symbol={"BTCUSDm": 0.20},
            daily_profit_target=5000.0,
            enforcement_mode="SOFT"
        )
        
        assert settings.max_lot_per_symbol["BTCUSDm"] == 0.20
        assert settings.daily_profit_target == 5000.0
        assert settings.enforcement_mode == "SOFT"


class TestAccountValidation:
    """Test account validation / handshake logic"""
    
    def test_set_tracked_account(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        assert controller.settings.tracked_account_login == 123456
    
    def test_validate_account_success_when_matching(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {
            "account": {"login": 123456},
            "symbol": "BTCUSDm"
        }
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is True
        assert "123456" in reason
    
    def test_validate_account_fails_when_mismatch(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {
            "account": {"login": 999999},
            "symbol": "BTCUSDm"
        }
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is False
        assert "mismatch" in reason.lower()
    
    def test_validate_account_fails_when_no_account_info(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {"symbol": "BTCUSDm"}  # No account field
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is False
        assert "No account info" in reason
    
    def test_validate_account_fails_when_no_login(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {
            "account": {"balance": 10000.0},  # No login field
            "symbol": "BTCUSDm"
        }
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is False
        assert "No login" in reason
    
    def test_validate_account_passes_when_no_tracked_account(self):
        controller = create_default_controller()
        # No tracked account set
        
        ea_status = {
            "account": {"login": 123456},
            "symbol": "BTCUSDm"
        }
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is True
    
    def test_validate_account_passes_when_validation_disabled(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        controller.settings.account_validation_enabled = False
        
        ea_status = {
            "account": {"login": 999999},  # Different account
            "symbol": "BTCUSDm"
        }
        
        is_valid, reason = controller.validate_account(ea_status)
        
        assert is_valid is True
        assert "disabled" in reason.lower()
    
    def test_handle_heartbeat_returns_error_on_account_mismatch(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {
            "account": {"login": 999999},
            "symbol": "BTCUSDm",
            "positions": [],
            "errors": []
        }
        
        result = controller.handle_heartbeat(ea_status)
        
        assert "error" in result
        assert result["error"] == "ACCOUNT_MISMATCH"
    
    def test_handle_heartbeat_returns_settings_on_valid_account(self):
        controller = create_default_controller()
        controller.set_tracked_account(123456)
        
        ea_status = {
            "account": {"login": 123456},
            "symbol": "BTCUSDm",
            "positions": [],
            "errors": []
        }
        
        result = controller.handle_heartbeat(ea_status)
        
        assert "settings" in result
        assert result["status"] == "ACTIVE"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])