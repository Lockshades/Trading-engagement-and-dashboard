# Executive Arm Architecture

> Last Updated: 2026-03-28
> Status: Architecture Design

## 1. System Overview

The Executive Arm is a two-layer risk enforcement system:

```
┌────────────────────────────────────────────────────────────────────────────┐
│              CONTROL CENTER (Python - This Project)           │
│                    "The Brain"                           │
│  • Daily KPI Calculation                                   │
│  • Lot Size Caps (per symbol)                            │
│  • Point/Profit Budget Engine                            │
│  • Auto-close Rule Engine                                │
│  • Settings API (REST + WebSocket)                       │
└───────────────────────┬────────────────────────────────────┘
                        │ JSON over HTTPS/WSS
                        │ Pushes enforcement rules
                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              ENFORCEMENT LAYER (MT5 EA - MQL5)           │
│                    "The Muscle"                          │
│  • Tick/Trade Event Handlers                             │
│  • Lot Size Guard (reject/adjust > max)                    │
│  • Profit Monitor + Auto-closer                         │
│  • Heartbeat Reporter                                  │
└─────────────────────────────────────────────────────────────┘
```

## 2. Core Components

### 2.1 Control Center (Python)

**File:** `backend/executive_arm.py` (new file)

```python
class ExecutiveArmController:
    """Central controller for enforcement rules"""
    
    def __init__(self):
        self.settings = EnforcementSettings()
        self.position_tracker = PositionTracker()
        self.history_log = EnforcementHistory()
    
    def compute_daily_limits(self, account_balance, target_ngn, pair_info):
        """Calculate enforcement limits for the day"""
        # Returns: max_lot, points_budget, profit_target
    
    def get_enforcement_settings(self, symbol: str) -> dict:
        """Current enforcement settings for a symbol"""
    
    def log_enforcement_action(self, action: EnforcementAction):
        """Log all enforcement decisions"""
    
    def get_heartbeat_status(self) -> dict:
        """Current system status from EA"""
```

### 2.2 Enforcement Settings Model

```python
class EnforcementSettings(BaseModel):
    # Lot Size Enforcement
    max_lot_per_symbol: dict[str, float]  # {"BTCUSDm": 0.5, "ETHUSDm": 0.13}
    default_max_lot: float = 0.1
    
    # Profit/Points Budget
    daily_profit_target: float  # NGN target for the day
    points_budget: float  # Max points allowed (normalized by lot size)
    use_lot_normalizer: bool = True
    
    # Auto-close Rules
    auto_close_buffer: float = 1.10  # 10% above target triggers monitoring
    auto_close_threshold: float = 1.05  # Close if drops below this
    min_hold_seconds: int = 300  # 5 minutes minimum hold after +10%
    
    # Enforcement Mode
    enforcement_mode: str = "HARD"  # HARD=reject, SOFT=warn
    emergency_override_password: str = ""  # Bypass all enforcement
    
    # Time Settings
    day_reset_hour: int = 0  # UTC hour to reset (0 = midnight)
    timezone: str = "UTC"
```

### 2.3 Position Tracker

```python
class PositionTracker:
    """Tracks positions and calculates budget consumption"""
    
    def get_open_positions(self) -> list[dict]:
        """Current open positions from MT5"""
    
    def get_symbol_positions(self, symbol: str) -> list[dict]:
        """Positions for a specific symbol"""
    
    def calculate_points_used(self, positions, pair_info) -> float:
        """Normalize points consumption by lot size"""
        # Example: 0.26 lot at 0.13 lot target = 2x points consumption
    
    def calculate_profit_exposure(self, positions) -> float:
        """Current profit/loss in NGN"""
    
    def can_open_position(self, symbol: str, lot: float) -> tuple[bool, str]:
        """Check if new position can be opened"""
```

### 2.4 Enforcement Layer (MT5 EA)

**File:** `MT5/ExecutveArmEA.mq5` (new file in a new MT5 folder)

```mql5
// Executive Arm EA - MQL5
// Attaches to charts and enforces rules

input string ConfigServer = "http://localhost:8000";
input string ApiKey = "";  // Optional API key
input int HeartbeatSeconds = 30;

int OnInit() {
    // Load settings from Python
    LoadEnforcementSettings();
    return INIT_SUCCEEDED;
}

void OnTick() {
    // Check every tick (every price movement)
    CheckLotSizeLimits();
    MonitorProfitTargets();
}

void OnTrade() {
    // Check on every trade event
    CheckLotSizeLimits();
}

void CheckLotSizeLimits() {
    // Reject/adjust positions exceeding max lot
}

void MonitorProfitTargets() {
    // Check auto-close conditions
    double currentProfit = AccountProfit();
    double target = DailyTarget * BufferPercent;
    
    if (currentProfit > target) {
        monitorMode = true;
        monitorStart = TimeCurrent();
    }
    
    if (monitorMode && currentProfit < DailyTarget * ThresholdPercent) {
        // Auto-close all positions
        CloseAllPositions();
        LogEnforcementAction("AUTO_CLOSE", currentProfit);
    }
}
```

## 3. Communication Protocol

### 3.1 Python → EA (Push Settings)

**Endpoint:** `GET /executive/settings` (polled by EA)

```json
{
    "timestamp": "2026-03-28T12:00:00Z",
    "account": "130965031",
    "settings": {
        "max_lot_per_symbol": {
            "BTCUSDm": 0.15,
            "ETHUSDm": 0.25
        },
        "daily_profit_target": 3000.0,
        "points_budget": 12500.0,
        "auto_close_buffer": 1.10,
        "auto_close_threshold": 1.05,
        "enforcement_mode": "HARD"
    },
    "status": "ACTIVE",
    "cache_until": "2026-03-28T12:01:00Z"
}
```

### 3.2 EA → Python (Heartbeat/Reports)

**Endpoint:** `POST /executive/heartbeat`

```json
{
    "timestamp": "2026-03-28T12:00:05Z",
    "ea_version": "1.0.0",
    "account": "130965031",
    "status": "OK",
    "positions": [
        {
            "ticket": 12345,
            "symbol": "BTCUSDm",
            "type": "BUY",
            "lot": 0.13,
            "profit_ngn": 450.0,
            "points_used": 2812.5
        }
    ],
    "enforcement_actions": [
        {
            "action": "LOT_REJECTED",
            "symbol": "BTCUSDm",
            "requested_lot": 0.50,
            "max_allowed": 0.15,
            "timestamp": "2026-03-28T11:45:22Z"
        }
    ],
    "errors": []
}
```

### 3.3 WebSocket for Real-Time (Optional)

**Channel:** `ws://localhost:8000/ws/executive`

```json
{
    "type": "ENFORCE_SETTINGS",
    "payload": {
        "max_lot_per_symbol": {"BTCUSDm": 0.10}
    }
}
```

## 4. Enforcement Rules

### 4.1 Lot Size Cap

```python
def enforce_lot_size(symbol: str, requested_lot: float) -> EnforcerResult:
    max_lot = settings.max_lot_per_symbol.get(
        symbol, 
        settings.default_max_lot
    )
    
    if requested_lot > max_lot:
        if settings.enforcement_mode == "HARD":
            return EnforcerResult(
                allowed=False,
                action="REJECTED",
                reason=f"Requested {requested_lot} > max {max_lot}",
                suggested_lot=None
            )
        else:  # SOFT
            return EnforcerResult(
                allowed=True,
                action="WARNED",
                reason=f"Requested {requested_lot} exceeds max {max_lot}",
                suggested_lot=max_lot  # Suggest reduction
            )
    
    return EnforcerResult(allowed=True, action="APPROVED")
```

### 4.2 Points Budget Normalizer

```python
def calculate_points_consumed(positions: list, pair_info: dict) -> float:
    """Normalize point consumption by lot size"""
    recommended_lot = pair_info.get("lot_size", 0.13)
    move_value = pair_info.get("move_value_ngn_per_lot", 160.0)
    point_value = move_value / pair_info.get("move_unit_size", 0.01)
    
    total_points = 0.0
    for pos in positions:
        lot = pos["volume"]
        # More lot = more points needed for same profit
        lot_ratio = lot / recommended_lot
        point_consumption = lot_ratio * settings.points_budget
        total_points += point_consumption
    
    return total_points


def can_open_lot(symbol: str, new_lot: float) -> tuple[bool, str]:
    points_used = calculate_points_consumed(get_symbol_positions(symbol))
    points_needed = calculate_points_consumed_for_lot(new_lot, symbol)
    
    if (points_used + points_needed) > settings.points_budget:
        return False, f"Insufficient points budget: {points_used}/{settings.points_budget}"
    
    return True, "OK"
```

### 4.3 Auto-Close Logic

```python
def check_auto_close(positions: list, current_profit: float) -> AutoCloseResult:
    target = settings.daily_profit_target
    
    # Enter monitoring zone?
    if current_profit >= target * settings.auto_close_buffer:
        return AutoCloseResult(
            should_monitor=True,
            action="MONITOR",
            enter_time=datetime.utcnow()
        )
    
    # Trigger auto-close?
    if current_profit < target * settings.auto_close_threshold:
        # Check minimum hold time
        time_in_monitor = (datetime.utcnow() - monitor_enter_time).seconds
        if time_in_monitor >= settings.min_hold_seconds:
            return AutoCloseResult(
                should_close=True,
                action="CLOSE_ALL",
                reason=f"Profit {current_profit} < {target * settings.auto_close_threshold}"
            )
    
    return AutoCloseResult(should_close=False, action="HOLD")
```

## 5. Fallback Behavior

### 5.1 Connection Loss

| Scenario | Behavior |
|----------|----------|
| EA can't reach Python | Use cached settings, continue trading with last known limits |
| Python can't reach MT5 | Alert user, log error, continue monitoring |
| Both disconnected | EA uses cached defaults (conservative: 0.01 lot max) |

### 5.2 Cached Settings

```python
# Default conservative settings when disconnected
DEFAULT_FALLBACK = {
    "max_lot_per_symbol": {"DEFAULT": 0.01},  # Very conservative
    "enforcement_mode": "HARD",
    "auto_close_buffer": 1.05,  # Tighter buffer
    "emergency_override": True  # Allow user override only
}
```

### 5.3 Emergency Override

```python
def handle_override(password: str) -> bool:
    """Emergency override - disables all enforcement"""
    if password == settings.emergency_override_password:
        logoverride("EMERGENCY_OVERRIDE_ENABLED")
        return True
    return False
```

## 6. Logging & Audit

### 6.1 Enforcement Log

```python
class EnforcementLog:
    """All enforcement actions logged"""
    
    def log_action(self, action: str, details: dict):
        """Log to database and file"""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "action": action,
            "details": details,
            "account": self.account,
            "result": details.get("result", "UNKNOWN")
        }
```

### 6.2 Audit Report

```json
{
    "report_date": "2026-03-28",
    "account": "130965031",
    "enforcement_actions": [
        {
            "timestamp": "2026-03-28T14:32:05Z",
            "action": "LOT_REJECTED",
            "symbol": "BTCUSDm",
            "requested": 0.50,
            "max_allowed": 0.15,
            "mode": "HARD"
        },
        {
            "timestamp": "2026-03-28T15:45:22Z",
            "action": "AUTO_CLOSE",
            "positions_closed": 3,
            "profit_at_close": 3150.00,
            "target": 3000.00,
            "reason": "Buffer breach - profit dropped from +10%"
        }
    ],
    "statistics": {
        "total_rejections": 5,
        "total_warnings": 12,
        "total_auto_closes": 1
    }
}
```

## 7. Implementation Phases

### Phase 1: Core (Week 1)
- [ ] ExecutiveArmController class
- [ ] Settings model + API endpoints
- [ ] Basic lot cap enforcement

### Phase 2: Advanced (Week 2)
- [ ] Points budget normalizer
- [ ] Auto-close logic
- [ ] Logging system

### Phase 3: Integration (Week 3)
- [ ] MT5 EA skeleton
- [ ] Heartbeat communication
- [ ] WebSocket for real-time

### Phase 4: Polish (Week 4)
- [ ] Caching + fallbacks
- [ ] Emergency override
- [ ] Audit reports

## 8. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Unauthorized access | API key authentication |
| EA manipulation | Sign enforcement commands |
| Connection spoofing | TLS/WSS encryption |
| User override abuse | Password + logging |
| Data loss | Redundant logging + file backup |

## 9. File Structure

```
backend/
    executive_arm.py       # Main controller
    enforcement_models.py  # Data models
    enforcement_api.py     # REST endpoints
    settings_manager.py    # Settings persistence

MT5/
    ExecutiveArmEA.mq5     # MT5 EA
    Include/
        ExecutiveArmLib.mqh  # Shared library
```

## 10. Open Questions

1. **How to handle partial closes?** Should we track net lot or per-ticket?
2. **Should we support multiple accounts?** Single EA per MT5 account initially?
3. **What spread assumptions?** Should we subtract spread from profit targets?
4. **Minimum hold time?** 5 minutes too aggressive? 15 minutes better?
5. **HARD vs SOFT default?** Recommend HARD for production?

---

*This architecture document will be updated as implementation progresses.*