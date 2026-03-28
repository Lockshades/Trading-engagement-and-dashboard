"""
Executive Arm - Risk Enforcement Controller
=============================================
The "Brain" of the enforcement system.
Calculates daily limits, enforces lot caps, monitors profit targets,
and provides settings to the MT5 EA.

Usage:
    from executive_arm import ExecutiveArmController
    controller = ExecutiveArmController()
    settings = controller.get_enforcement_settings("BTCUSDm")
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class EnforcementSettings(BaseModel):
    """Main enforcement configuration"""
    # Account Validation
    tracked_account_login: Optional[int] = Field(
        default=None,
        description="MT5 account login number that this controller should manage"
    )
    account_validation_enabled: bool = Field(
        default=True,
        description="Enable account validation handshake"
    )
    
    # Lot Size Enforcement
    max_lot_per_symbol: dict[str, float] = Field(
        default_factory=dict,
        description="Max lot allowed per symbol. Key = symbol, Value = max lot"
    )
    default_max_lot: float = Field(
        default=0.1,
        gt=0,
        le=10.0,
        description="Default max lot when symbol not in max_lot_per_symbol"
    )
    
    # Profit/Points Budget
    daily_profit_target: float = Field(
        default=0.0,
        ge=0,
        description="NGN profit target for the day"
    )
    points_budget: float = Field(
        default=0.0,
        ge=0,
        description="Max points allowed (normalized by lot size)"
    )
    use_lot_normalizer: bool = Field(
        default=True,
        description="Scale points by lot size ratio"
    )
    
    # Auto-close Rules
    auto_close_buffer: float = Field(
        default=1.10,
        ge=1.0,
        le=2.0,
        description="Close if profit > target * this value (1.10 = 10% above)"
    )
    auto_close_threshold: float = Field(
        default=1.05,
        ge=1.0,
        le=1.5,
        description="Trigger close if profit drops below target * this"
    )
    min_hold_seconds: int = Field(
        default=300,
        ge=0,
        le=3600,
        description="Minimum seconds to hold after entering monitoring zone"
    )
    
    # Enforcement Mode
    enforcement_mode: str = Field(
        default="HARD",
        pattern="^(HARD|SOFT)$",
        description="HARD=reject, SOFT=warn"
    )
    emergency_override_password: str = Field(
        default="",
        description="Password to bypass all enforcement"
    )
    
    # Time Settings
    day_reset_hour: int = Field(
        default=0,
        ge=0,
        le=23,
        description="UTC hour to reset daily limits"
    )
    timezone: str = Field(
        default="UTC",
        description="Timezone for day boundaries"
    )


class EnforcerResult(BaseModel):
    """Result of an enforcement check"""
    allowed: bool = Field(description="Was the action allowed?")
    action: str = Field(description="APPROVED, REJECTED, WARNED, CLOSE_ALL")
    reason: str = Field(default="", description="Human-readable reason")
    requested_lot: Optional[float] = Field(default=None, description="Requested lot size")
    suggested_lot: Optional[float] = Field(default=None, description="Suggested lot if rejected")
    max_lot: Optional[float] = Field(default=None, description="Max allowed lot")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AutoCloseResult(BaseModel):
    """Result of auto-close check"""
    should_monitor: bool = Field(default=False, description="Enter monitoring zone")
    should_close: bool = Field(default=False, description="Trigger auto-close")
    action: str = Field(default="HOLD", description="HOLD, MONITOR, CLOSE_ALL")
    reason: str = Field(default="", description="Reason for decision")
    current_profit: float = Field(default=0.0, description="Current profit in NGN")
    target: float = Field(default=0.0, description="Daily target")
    buffer_percent: float = Field(default=0.0, description="Current buffer %")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PositionInfo(BaseModel):
    """Position information from MT5"""
    ticket: int
    symbol: str
    type: str  # "BUY" or "SELL"
    volume: float
    profit: float
    price_open: float = 0.0
    price_current: float = 0.0
    time: int = 0


class EnforcementAction(BaseModel):
    """Log entry for enforcement actions"""
    action: str
    symbol: Optional[str] = None
    details: dict = Field(default_factory=dict)
    result: str = "SUCCESS"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# =============================================================================
# ENFORCEMENT CONTROLLER
# =============================================================================

class ExecutiveArmController:
    """
    Central controller for Executive Arm enforcement rules.
    This is the "Brain" that calculates limits and provides settings to the MT5 EA.
    """
    
    def __init__(self):
        self.settings = EnforcementSettings()
        self._monitoring_since: Optional[datetime] = None
        self._last_heartbeat: Optional[datetime] = None
        self._action_history: list[EnforcementAction] = []
        self._cached_settings: Optional[dict] = None
        self._cache_expiry: Optional[datetime] = None
        
        logger.info("ExecutiveArmController initialized")
    
    # -------------------------------------------------------------------------
    # SETTINGS MANAGEMENT
    # -------------------------------------------------------------------------
    
    def update_settings(self, new_settings: EnforcementSettings) -> None:
        """Update enforcement settings"""
        self.settings = new_settings
        # Invalidate cache
        self._cached_settings = None
        logger.info(f"Settings updated: mode={new_settings.enforcement_mode}, "
                   f"daily_target={new_settings.daily_profit_target}")
    
    def get_enforcement_settings(self, symbol: str) -> dict:
        """
        Get current enforcement settings for a symbol (for MT5 EA polling).
        Returns dict format for JSON API response.
        """
        # Check cache
        if self._cached_settings and self._cache_expiry:
            if datetime.now(timezone.utc) < self._cache_expiry:
                return self._cached_settings
        
        max_lot = self.settings.max_lot_per_symbol.get(
            symbol,
            self.settings.default_max_lot
        )
        
        settings_dict = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "settings": {
                "max_lot": max_lot,
                "default_max_lot": self.settings.default_max_lot,
                "daily_profit_target": self.settings.daily_profit_target,
                "points_budget": self.settings.points_budget,
                "use_lot_normalizer": self.settings.use_lot_normalizer,
                "auto_close_buffer": self.settings.auto_close_buffer,
                "auto_close_threshold": self.settings.auto_close_threshold,
                "min_hold_seconds": self.settings.min_hold_seconds,
                "enforcement_mode": self.settings.enforcement_mode,
                "day_reset_hour": self.settings.day_reset_hour,
            },
            "status": "ACTIVE",
            "cache_until": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
        }
        
        # Cache for 1 minute
        self._cached_settings = settings_dict
        self._cache_expiry = datetime.now(timezone.utc) + timedelta(minutes=1)
        
        return settings_dict
    
    def set_symbol_lot_limit(self, symbol: str, max_lot: float) -> None:
        """Set max lot for a specific symbol"""
        self.settings.max_lot_per_symbol[symbol] = max_lot
        self._cached_settings = None  # Invalidate cache
        logger.info(f"Set lot limit for {symbol}: {max_lot}")
    
    # -------------------------------------------------------------------------
    # ACCOUNT VALIDATION / HANDSHAKE
    # -------------------------------------------------------------------------
    
    def set_tracked_account(self, login: int) -> None:
        """Set the MT5 account login that this controller manages"""
        self.settings.tracked_account_login = login
        self._cached_settings = None
        logger.info(f"Controller tracking account login: {login}")
    
    def validate_account(self, ea_status: dict) -> tuple[bool, str]:
        """
        Validate that the EA is connected to the correct account.
        Returns (is_valid, reason).
        """
        if not self.settings.account_validation_enabled:
            return True, "Account validation disabled"
        
        tracked_login = self.settings.tracked_account_login
        if tracked_login is None:
            return True, "No tracked account configured"
        
        ea_account = ea_status.get("account")
        if ea_account is None:
            return False, "No account info in heartbeat"
        
        ea_login = ea_account.get("login")
        if ea_login is None:
            return False, "No login in account info"
        
        if ea_login != tracked_login:
            return False, f"Account mismatch: EA on {ea_login}, controller expects {tracked_login}"
        
        return True, f"Account validated: {tracked_login}"
    
    # -------------------------------------------------------------------------
    # LOT SIZE ENFORCEMENT
    # -------------------------------------------------------------------------
    
    def enforce_lot_size(self, symbol: str, requested_lot: float) -> EnforcerResult:
        """
        Check if requested lot size is allowed.
        Returns EnforcerResult with approval/rejection details.
        """
        max_lot = self.settings.max_lot_per_symbol.get(
            symbol,
            self.settings.default_max_lot
        )
        
        if requested_lot > max_lot:
            if self.settings.enforcement_mode == "HARD":
                self._log_action("LOT_REJECTED", symbol, {
                    "requested": requested_lot,
                    "max_allowed": max_lot,
                    "mode": "HARD"
                })
                return EnforcerResult(
                    allowed=False,
                    action="REJECTED",
                    reason=f"Requested {requested_lot} exceeds max {max_lot}",
                    requested_lot=requested_lot,
                    suggested_lot=None,
                    max_lot=max_lot
                )
            else:  # SOFT mode
                self._log_action("LOT_WARNED", symbol, {
                    "requested": requested_lot,
                    "max_allowed": max_lot,
                    "mode": "SOFT"
                })
                return EnforcerResult(
                    allowed=True,
                    action="WARNED",
                    reason=f"Requested {requested_lot} exceeds max {max_lot} (warned)",
                    requested_lot=requested_lot,
                    suggested_lot=max_lot,
                    max_lot=max_lot
                )
        
        # Within limits
        self._log_action("LOT_APPROVED", symbol, {
            "requested": requested_lot,
            "max_allowed": max_lot
        })
        return EnforcerResult(
            allowed=True,
            action="APPROVED",
            reason="Within lot limits",
            requested_lot=requested_lot,
            max_lot=max_lot
        )
    
    # -------------------------------------------------------------------------
    # POINTS BUDGET NORMALIZER
    # -------------------------------------------------------------------------
    
    def calculate_points_consumed(
        self,
        positions: list[PositionInfo],
        recommended_lot: float = 0.13,
        move_unit_size: float = 0.01
    ) -> float:
        """
        Calculate total points consumed by open positions.
        Normalizes by lot size ratio.
        
        Example:
        - Position A: 0.13 lot at 0.13 target = 1x points
        - Position B: 0.26 lot at 0.13 target = 2x points
        """
        if not self.settings.use_lot_normalizer or recommended_lot <= 0:
            return len(positions) * self.settings.points_budget
        
        total_consumption = 0.0
        for pos in positions:
            lot_ratio = pos.volume / recommended_lot
            # More lot = more points needed for same profit
            point_consumption = lot_ratio  # 1.0 = 100% of budget at target lot
            total_consumption += point_consumption
        
        return total_consumption
    
    def can_open_lot(
        self,
        symbol: str,
        new_lot: float,
        current_positions: list[PositionInfo],
        recommended_lot: float = 0.13
    ) -> tuple[bool, str]:
        """
        Check if new position can be opened based on points budget.
        Returns (allowed, reason).
        """
        if self.settings.points_budget <= 0:
            return True, "No points budget limit"
        
        current_consumption = self.calculate_points_consumed(
            current_positions,
            recommended_lot
        )
        
        # Calculate what this new lot would add
        lot_ratio = new_lot / recommended_lot if recommended_lot > 0 else 1.0
        new_consumption = current_consumption + lot_ratio
        
        # Convert to actual points
        available_points = self.settings.points_budget
        if new_consumption > 1.0:  # 1.0 = 100% of budget
            return False, f"Insufficient points budget: {new_consumption*100:.0f}% > 100%"
        
        remaining = (1.0 - new_consumption) * 100
        return True, f"Available: {remaining:.0f}% of points budget"
    
    # -------------------------------------------------------------------------
    # AUTO-CLOSE LOGIC
    # -------------------------------------------------------------------------
    
    def check_auto_close(
        self,
        current_profit: float,
        positions: list[PositionInfo]
    ) -> AutoCloseResult:
        """
        Check if auto-close should be triggered.
        Monitors profit and auto-closes if it was above buffer but dropped below threshold.
        """
        target = self.settings.daily_profit_target
        buffer = self.settings.auto_close_buffer
        threshold = self.settings.auto_close_threshold
        
        if target <= 0:
            return AutoCloseResult(
                action="HOLD",
                reason="No daily target set",
                current_profit=current_profit,
                target=target
            )
        
        buffer_level = target * buffer  # e.g., 3000 * 1.10 = 3300
        threshold_level = target * threshold  # e.g., 3000 * 1.05 = 3150
        
        buffer_percent = (current_profit / target - 1) * 100 if target > 0 else 0
        
        # If currently monitoring or just entered
        if self._monitoring_since is not None:
            # We're in monitoring - check if we should close
            if current_profit < threshold_level:
                time_in_monitor = (datetime.now(timezone.utc) - self._monitoring_since).seconds
                min_hold = self.settings.min_hold_seconds
                
                if time_in_monitor >= min_hold:
                    self._log_action("AUTO_CLOSE", None, {
                        "profit_at_close": current_profit,
                        "target": target,
                        "buffer_percent": buffer_percent,
                        "positions_closed": len(positions)
                    })
                    self._monitoring_since = None  # Reset
                    return AutoCloseResult(
                        should_monitor=False,
                        should_close=True,
                        action="CLOSE_ALL",
                        reason=f"Profit dropped below {threshold*100}% of target",
                        current_profit=current_profit,
                        target=target,
                        buffer_percent=buffer_percent
                    )
                else:
                    # Still in min hold period
                    return AutoCloseResult(
                        should_monitor=True,
                        should_close=False,
                        action="MONITOR",
                        reason=f"In monitoring zone - holding (min {min_hold}s, elapsed {time_in_monitor}s)",
                        current_profit=current_profit,
                        target=target,
                        buffer_percent=buffer_percent
                    )
            else:
                # Profit is above threshold - remain in monitoring if above buffer, else check exit
                if current_profit >= buffer_level:
                    # Still above buffer - normal monitoring
                    return AutoCloseResult(
                        should_monitor=True,
                        should_close=False,
                        action="MONITOR",
                        reason="In monitoring zone - profit above buffer",
                        current_profit=current_profit,
                        target=target,
                        buffer_percent=buffer_percent
                    )
                else:
                    # Between buffer and threshold - remains in monitoring
                    return AutoCloseResult(
                        should_monitor=True,
                        should_close=False,
                        action="MONITOR",
                        reason="In monitoring zone - profit between buffer and threshold",
                        current_profit=current_profit,
                        target=target,
                        buffer_percent=buffer_percent
                    )
        
        # Not currently monitoring - check if we should enter
        if current_profit >= buffer_level:
            self._monitoring_since = datetime.now(timezone.utc)
            self._log_action("MONITOR_ENTER", None, {
                "profit": current_profit,
                "target": target,
                "buffer_percent": buffer_percent
            })
            
            return AutoCloseResult(
                should_monitor=True,
                should_close=False,
                action="MONITOR",
                reason="Entered monitoring zone - above buffer",
                current_profit=current_profit,
                target=target,
                buffer_percent=buffer_percent
            )
        
        # Normal operation - no monitoring needed
        return AutoCloseResult(
            should_monitor=False,
            should_close=False,
            action="HOLD",
            reason="Normal operation",
            current_profit=current_profit,
            target=target,
            buffer_percent=buffer_percent
        )
    
    def reset_daily_limits(self) -> None:
        """Reset daily monitoring state (called at day boundary)"""
        self._monitoring_since = None
        logger.info("Daily limits reset")
    
    # -------------------------------------------------------------------------
    # HEARTBEAT & LOGGING
    # -------------------------------------------------------------------------
    
    def handle_heartbeat(self, ea_status: dict) -> dict:
        """
        Process heartbeat from MT5 EA with account validation.
        ea_status should contain: version, account, positions, errors
        """
        # Validate account first
        is_valid, reason = self.validate_account(ea_status)
        if not is_valid:
            self._log_action("ACCOUNT_MISMATCH", None, {
                "reason": reason,
                "ea_status": ea_status.get("account", {})
            })
            return {
                "error": "ACCOUNT_MISMATCH",
                "reason": reason,
                "status": "ERROR"
            }
        
        self._last_heartbeat = datetime.now(timezone.utc)
        
        # Log any errors from EA
        errors = ea_status.get("errors", [])
        for error in errors:
            self._log_action("EA_ERROR", None, error)
        
        # Return current settings
        return self.get_enforcement_settings(ea_status.get("symbol", ""))
    
    def get_status(self) -> dict:
        """Get current system status"""
        return {
            "controller_status": "ACTIVE",
            "last_heartbeat": self._last_heartbeat.isoformat() if self._last_heartbeat else None,
            "monitoring_since": self._monitoring_since.isoformat() if self._monitoring_since else None,
            "actions_today": len(self._action_history),
            "settings_mode": self.settings.enforcement_mode,
            "daily_target": self.settings.daily_profit_target,
            "points_budget": self.settings.points_budget
        }
    
    def _log_action(self, action: str, symbol: Optional[str], details: dict) -> None:
        """Log an enforcement action"""
        log_entry = EnforcementAction(
            action=action,
            symbol=symbol,
            details=details
        )
        self._action_history.append(log_entry)
        logger.info(f"Enforcement action: {action} | {symbol or 'ALL'} | {details}")
    
    def get_action_history(self, limit: int = 50) -> list[dict]:
        """Get recent enforcement actions"""
        return [
            {
                "timestamp": a.timestamp.isoformat(),
                "action": a.action,
                "symbol": a.symbol,
                "details": a.details
            }
            for a in self._action_history[-limit:]
        ]


# =============================================================================
# DEFAULT FACTORY
# =============================================================================

def create_default_controller() -> ExecutiveArmController:
    """Create controller with sensible defaults"""
    controller = ExecutiveArmController()
    
    # Set reasonable defaults for common symbols
    controller.settings.max_lot_per_symbol = {
        "BTCUSDm": 0.15,
        "ETHUSDm": 0.25,
        "XAUUSDm": 0.10,
        "EURUSDm": 0.50,
        "GBPUSDm": 0.50,
    }
    controller.settings.default_max_lot = 0.10
    controller.settings.daily_profit_target = 3000.0  # NGN
    controller.settings.points_budget = 10000.0
    controller.settings.enforcement_mode = "HARD"
    controller.settings.auto_close_buffer = 1.10
    controller.settings.auto_close_threshold = 1.05
    controller.settings.min_hold_seconds = 300
    
    return controller


# =============================================================================
# STANDALONE FUNCTIONS (for API endpoints)
# =============================================================================

# Global controller instance
_controller: Optional[ExecutiveArmController] = None


def get_controller() -> ExecutiveArmController:
    """Get or create global controller instance"""
    global _controller
    if _controller is None:
        _controller = create_default_controller()
    return _controller


def enforce_lot(symbol: str, lot: float) -> EnforcerResult:
    """Convenience function for lot enforcement"""
    return get_controller().enforce_lot_size(symbol, lot)


def check_close(profit: float, positions: list[PositionInfo]) -> AutoCloseResult:
    """Convenience function for auto-close check"""
    return get_controller().check_auto_close(profit, positions)


def get_settings(symbol: str) -> dict:
    """Convenience function to get settings for a symbol"""
    return get_controller().get_enforcement_settings(symbol)