# Sleep/Gap Protection Architecture

> Last Updated: 2026-03-28
> Status: Architecture Design

## 1. Problem Statement

Weekend gaps and holiday price movements can cause significant account damage:
- Friday close to Monday open can have large price gaps
- News events during market close can cause slippage
- Weekend crypto movements can be extreme
- Holiday closures create similar risks

## 2. System Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    SLEEP/GAP PROTECTION LAYER                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Market State Detector ──► Risk Calculator ──► Protection Controller     │
│         │                        │                      │                  │
│         ▼                        ▼                      ▼                  │
│  • Trading hours          • Gap risk score        • Auto-reduce lot     │
│  • Weekend detection      • Volatility analysis    • Auto-close positions │
│  • Holiday calendar       • News risk             • Send alerts          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## 3. Core Components

### 3.1 Market State Detector

```python
class MarketState:
    OPEN = "OPEN"           # Normal trading
    CLOSED = "CLOSED"       # Market closed (night hours)
    WEEKEND = "WEEKEND"     # Saturday/Sunday
    HOLIDAY = "HOLIDAY"     # Public holiday
    GAP_RISK = "GAP_RISK"   # High gap risk detected

class MarketStateDetector:
    """Detect current market state for each symbol"""
    
    # Trading hours by asset class
    FOREX_HOURS = {"open": "21:00", "close": "21:00"}  # UTC, Mon-Fri
    CRYPTO_HOURS = {"open": "00:00", "close": "23:59"}  # 24/7
    METALS_HOURS = {"open": "22:00", "close": "20:00"}
    INDICES_HOURS = {"open": "22:00", "close": "21:00"}
    
    def get_state(self, symbol: str) -> tuple[MarketState, dict]:
        """Returns (state, metadata)"""
        
    def is_weekend(self) -> bool:
        """Check if current UTC time is weekend"""
        
    def is_trading_hours(self, symbol: str) -> bool:
        """Check if symbol is in trading hours"""
```

### 3.2 Gap Risk Calculator

```python
class GapRiskCalculator:
    """Calculate gap risk score based on historical data"""
    
    def calculate_gap_risk(self, symbol: str) -> GapRiskResult:
        """
        Returns:
        {
            "risk_level": "LOW" | "MEDIUM" | "HIGH" | "EXTREME",
            "gap_score": 0-100,
            "historical_gaps": [...],
            "volatility_factor": 1.5,
            "recommended_action": "NONE" | "REDUCE" | "CLOSE" | "ALERT"
        }
        """
    
    def analyze_weekend_gaps(self, symbol: str, lookback_days=30) -> dict:
        """Analyze historical weekend gap behavior"""
    
    def estimate_max_gap(self, symbol: str, confidence=0.95) -> float:
        """Estimated maximum gap at given confidence level"""
```

### 3.3 Protection Controller

```python
class SleepGapProtection:
    """Main controller for sleep/gap protection"""
    
    def __init__(self, settings: ProtectionSettings):
        self.state_detector = MarketStateDetector()
        self.risk_calculator = GapRiskCalculator()
        self.settings = settings
        
    def get_protection_status(self, symbol: str) -> ProtectionStatus:
        """
        Returns current protection status for a symbol:
        {
            "market_state": "OPEN",
            "gap_risk": "LOW",
            "protection_level": "ACTIVE",
            "positions_at_risk": 3,
            "recommended_actions": [],
            "auto_actions_taken": []
        }
        """
    
    def evaluate_positions(self, positions: list) -> list[Action]:
        """
        Evaluate open positions and recommend actions:
        - CLOSE_POSITION: Close immediately
        - REDUCE_LOT: Reduce position size
        - SET_TRAILING_SL: Set trailing stop
        - WATCH_ONLY: Monitor but don't act
        """
    
    def should_activate(self, symbol: str) -> bool:
        """Check if protection should be active"""
    
    def calculate_safe_lot(self, normal_lot: float, risk_factor: float) -> float:
        """Calculate reduced lot size based on risk"""
```

### 3.4 Protection Settings

```python
class ProtectionSettings(BaseModel):
    # Activation thresholds
    gap_risk_threshold: float = 50.0  # 0-100 score, activate above this
    
    # Auto-action settings
    auto_reduce_on_weekend: bool = True
    reduce_lot_pct: float = 0.5  # Reduce to 50% on weekend
    
    auto_close_on_gap_risk: bool = True
    close_risk_threshold: float = 80.0  # Close all above this
    
    # Position management
    max_positions_on_weekend: int = 0  # 0 = close all
    trailing_sl_distance: float = 0.0  # pips
    
    # Alerts
    send_alerts: bool = True
    alert_channels: list[str] = ["UI", "PUSH"]
    
    # Protection windows (UTC)
    weekend_protection_start: str = "20:00"  # Friday
    weekend_protection_end: str = "22:00"    # Sunday
    
    # Excluded symbols (e.g., crypto 24/7)
    excluded_symbols: list[str] = []
```

## 4. Detection Logic

### 4.1 Market State Flow

```
Get Current Time (UTC)
       │
       ▼
Is Weekend? ──YES──► State = WEEKEND
       │NO
       ▼
Is Holiday? ──YES──► State = HOLIDAY
       │NO
       ▼
Is Trading Hours? ──NO──► State = CLOSED
       │YES
       ▼
State = OPEN
```

### 4.2 Gap Risk Calculation

```
Get Symbol Historical Data (30 days)
       │
       ▼
Calculate Weekend Gap Distribution
       │
       ▼
Current Weekend Day + Time
       │
       ▼
Calculate Gap Risk Score:
  - Historical gap size (40%)
  - Current volatility (30%)
  - Time until market open (20%)
  - News calendar proximity (10%)
       │
       ▼
Risk Level:
  - 0-30: LOW
  - 31-50: MEDIUM  
  - 51-80: HIGH
  - 81-100: EXTREME
```

## 5. API Endpoints

### 5.1 Get Protection Status

```http
GET /protection/status?symbol=BTCUSDm

{
    "symbol": "BTCUSDm",
    "market_state": "WEEKEND",
    "gap_risk": "MEDIUM",
    "gap_score": 45,
    "protection_active": true,
    "recommended_actions": [
        {
            "action": "REDUCE_LOT",
            "current_lot": 0.13,
            "recommended_lot": 0.07,
            "reason": "Weekend protection active"
        }
    ],
    "next_market_open": "2026-03-30T22:00:00Z"
}
```

### 5.2 Get Risk Analysis

```http
GET /protection/risk?symbol=BTCUSDm&lookback_days=30

{
    "symbol": "BTCUSDm",
    "historical_gaps": [
        {"date": "2026-03-22", "gap_pips": 125, "direction": "UP"},
        {"date": "2026-03-15", "gap_pips": 89, "direction": "DOWN"}
    ],
    "avg_weekend_gap": 95.5,
    "max_gap_95conf": 180.0,
    "volatility_factor": 1.3,
    "risk_level": "MEDIUM",
    "risk_score": 45
}
```

### 5.3 Configure Protection

```http
POST /protection/configure

{
    "gap_risk_threshold": 50.0,
    "auto_reduce_on_weekend": true,
    "reduce_lot_pct": 0.5,
    "max_positions_on_weekend": 0
}

{
    "status": "configured",
    "active": true
}
```

## 6. Implementation Phases

### Phase 1: Market State Detection (Day 1)
- [ ] MarketStateDetector class
- [ ] Trading hours configuration
- [ ] Weekend/Holiday detection

### Phase 2: Risk Calculation (Day 2)
- [ ] GapRiskCalculator class
- [ ] Historical gap analysis
- [ ] Risk scoring algorithm

### Phase 3: Protection Actions (Day 3)
- [ ] SleepGapProtection controller
- [ ] Auto-reduce lot logic
- [ ] Auto-close logic

### Phase 4: Integration (Day 4)
- [ ] API endpoints
- [ ] UI indicators
- [ ] Executive Arm integration

## 7. Executive Arm Integration

The Sleep/Gap Protection integrates with Executive Arm:

```python
# In ExecutiveArmController
def get_protection_settings(self, symbol: str) -> dict:
    """Get sleep/gap protection settings for a symbol"""
    
def calculate_safe_lot(self, symbol: str, requested_lot: float) -> float:
    """Apply sleep/gap protection to lot calculation"""
    
def check_gap_risk(self, positions: list) -> list[Action]:
    """Check positions for gap risk and recommend actions"""
```

## 8. UI Indicators

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ WEEKEND PROTECTION ACTIVE                                  │
│  Market: Closed (Opens Sunday 22:00 UTC)                       │
│  Gap Risk: MEDIUM (45/100)                                      │
│                                                                 │
│  Your positions:                                                │
│  - BTCUSDm 0.13 lot → Recommend 0.07 lot (Reduce by 50%)        │
│                                                                 │
│  [Reduce Positions] [Set Trailing SL] [Dismiss]                │
└─────────────────────────────────────────────────────────────────┘
```

---

*This architecture document will be updated as implementation progresses.*