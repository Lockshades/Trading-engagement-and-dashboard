# Multi-Account Sync Architecture

> Last Updated: 2026-03-28
> Status: Architecture Design

## 1. Problem Statement

PROP firms and serious traders manage multiple MT5 accounts simultaneously:
- Different funded accounts (e.g., $1k, $5k, $10k)
- Different strategies per account
- Need to replicate trades across accounts
- Must stay within per-account lot limits
- Need consolidated view of all accounts

## 2. System Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-ACCOUNT SYNC LAYER                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│  │  Account A   │    │  Account B   │    │  Account C   │                 │
│  │  (MT5 API)   │    │  (MT5 API)   │    │  (MT5 API)   │                 │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                 │
│         │                   │                   │                         │
│         ▼                   ▼                   ▼                         │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                     Account Manager                             │      │
│  │  • Account registry                                             │      │
│  │  • Connection pool                                              │      │
│  │  • State synchronization                                        │      │
│  └─────────────────────────────────────────────────────────────────┘      │
│                                │                                          │
│                                ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                     Sync Controller                             │      │
│  │  • Trade replication                                            │      │
│  │  • Lot allocation                                               │      │
│  │  • Risk distribution                                            │      │
│  └─────────────────────────────────────────────────────────────────┘      │
│                                │                                          │
│                                ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                     Dashboard UI                                │      │
│  │  • Consolidated view                                            │      │
│  │  • Per-account controls                                         │      │
│  │  • Sync status indicators                                       │      │
│  └─────────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
```

## 3. Core Components

### 3.1 Account Registry

```python
class AccountConfig(BaseModel):
    """Configuration for a single account"""
    account_id: str           # Unique identifier
    login: str               # MT5 login
    password: str            # MT5 password
    server: str              # MT5 server
    account_type: str        # "PROP" | "PERSONAL" | "FUNDED"
    initial_balance: float   # Starting balance
    max_lot: float           # Account-specific lot limit
    strategy: str            # Strategy name (e.g., "SCALP_M15")
    enabled: bool = True
    
class AccountRegistry:
    """Registry of all managed accounts"""
    
    def __init__(self, config_path: str = "accounts.json"):
        self.accounts: dict[str, AccountConfig] = {}
        self.load_config()
        
    def add_account(self, config: AccountConfig) -> None:
        """Add account to registry"""
        
    def remove_account(self, account_id: str) -> None:
        """Remove account from registry"""
        
    def get_account(self, account_id: str) -> AccountConfig:
        """Get account config"""
        
    def get_all_accounts(self) -> list[AccountConfig]:
        """Get all accounts"""
        
    def get_enabled_accounts(self) -> list[AccountConfig]:
        """Get only enabled accounts"""
```

### 3.2 Account Connection Pool

```python
class MT5ConnectionPool:
    """Manage MT5 connections for multiple accounts"""
    
    def __init__(self, max_connections: int = 10):
        self.connections: dict[str, mt5.Connection] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        
    async def connect(self, account: AccountConfig) -> bool:
        """Establish connection to account"""
        
    async def disconnect(self, account_id: str) -> None:
        """Disconnect from account"""
        
    async def get_positions(self, account_id: str) -> list[dict]:
        """Get open positions for account"""
        
    async def get_balance(self, account_id: str) -> float:
        """Get account balance"""
        
    async def send_order(self, account_id: str, order: Order) -> OrderResult:
        """Send order to account"""
        
    def is_connected(self, account_id: str) -> bool:
        """Check if connected"""
        
    async def reconnect_all(self) -> dict[str, bool]:
        """Reconnect all disconnected accounts"""
```

### 3.3 Sync Controller

```python
class SyncMode(str, Enum):
    """How trades are replicated across accounts"""
    DISABLED = "DISABLED"           # No sync
    MIRROR = "MIRROR"               # Exact same lot on all
    PROPORTIONAL = "PROPORTIONAL"   # Lot scaled by account size
    INDIVIDUAL = "INDIVIDUAL"       # Each account has own signals

class SyncController:
    """Control trade synchronization across accounts"""
    
    def __init__(self, registry: AccountRegistry, pool: MT5ConnectionPool):
        self.registry = registry
        self.pool = pool
        self.sync_mode = SyncMode.PROPORTIONAL
        self.signals: dict[str, TradeSignal] = {}  # Active signals
        
    async def process_signal(self, signal: TradeSignal) -> SyncResult:
        """
        Process incoming trade signal and distribute to accounts
        """
        results = {}
        
        for account in self.registry.get_enabled_accounts():
            if not self.should_trade(account, signal):
                continue
                
            lot = self.calculate_lot(account, signal)
            result = await self.pool.send_order(account, signal.to_order(lot))
            results[account.account_id] = result
            
        return SyncResult(
            signal_id=signal.id,
            results=results,
            success=all(r.success for r in results.values())
        )
    
    def calculate_lot(self, account: AccountConfig, signal: TradeSignal) -> float:
        """Calculate lot size based on sync mode"""
        base_lot = signal.lot
        
        if self.sync_mode == SyncMode.MIRROR:
            return min(base_lot, account.max_lot)
            
        elif self.sync_mode == SyncMode.PROPORTIONAL:
            # Scale lot relative to account size vs reference
            reference_balance = 5000.0  # Reference account
            scale = account.initial_balance / reference_balance
            scaled_lot = base_lot * scale
            return min(scaled_lot, account.max_lot)
            
        elif self.sync_mode == SyncMode.INDIVIDUAL:
            # Use account-specific lot from strategy
            return signal.get_strategy_lot(account.strategy)
            
        return base_lot
    
    def should_trade(self, account: AccountConfig, signal: TradeSignal) -> bool:
        """Check if account should trade this signal"""
        if not account.enabled:
            return False
        if signal.strategy not in account.strategy and self.sync_mode != SyncMode.MIRROR:
            return False
        return True
```

### 3.4 Trade Signal

```python
class TradeSignal(BaseModel):
    """Trade signal to be replicated"""
    id: str
    timestamp: datetime
    symbol: str
    direction: str  # "BUY" or "SELL"
    lot: float
    strategy: str
    reason: str
    stop_loss: float | None = None
    take_profit: float | None = None
    
class TradeSignalInput(BaseModel):
    """API input for trade signal"""
    symbol: str
    direction: str
    lot: float
    strategy: str
    reason: str
    stop_loss: float | None = None
    take_profit: float | None = None
```

## 4. API Endpoints

### 4.1 Account Management

```http
# Get all accounts
GET /multi-account/accounts

{
    "accounts": [
        {
            "account_id": "acc_001",
            "login": "123456",
            "server": "Propfirm-Server",
            "account_type": "PROP",
            "initial_balance": 5000.0,
            "max_lot": 0.5,
            "strategy": "SCALP_M15",
            "enabled": true,
            "connected": true,
            "current_balance": 5234.50
        }
    ]
}

# Add account
POST /multi-account/accounts

{
    "account_id": "acc_002",
    "login": "789012",
    "password": "secret",
    "server": "Propfirm-Server",
    "account_type": "PROP",
    "initial_balance": 10000.0,
    "max_lot": 1.0,
    "strategy": "SWING_H1"
}

# Remove account
DELETE /multi-account/accounts/{account_id}

# Enable/Disable account
PATCH /multi-account/accounts/{account_id}/enabled
{"enabled": false}
```

### 4.2 Sync Control

```http
# Get sync status
GET /multi-account/sync/status

{
    "sync_mode": "PROPORTIONAL",
    "active_signals": 2,
    "total_positions": 5,
    "accounts": {
        "acc_001": {"positions": 2, "sync_health": "OK"},
        "acc_002": {"positions": 3, "sync_health": "OK"}
    }
}

# Set sync mode
POST /multi-account/sync/mode

{
    "mode": "PROPORTIONAL"  # MIRROR, PROPORTIONAL, INDIVIDUAL, DISABLED
}

# Send trade signal
POST /multi-account/sync/signal

{
    "symbol": "BTCUSDm",
    "direction": "BUY",
    "lot": 0.1,
    "strategy": "SCALP_M15",
    "reason": "RSI oversold at support",
    "stop_loss": 42000.0,
    "take_profit": 45000.0
}

{
    "signal_id": "sig_abc123",
    "results": {
        "acc_001": {"success": true, "ticket": 12345, "lot": 0.1},
        "acc_002": {"success": true, "ticket": 67890, "lot": 0.2}
    },
    "success": true
}
```

### 4.3 Dashboard Data

```http
# Get consolidated portfolio
GET /multi-account/portfolio

{
    "total_equity": 25000.0,
    "total_pnl": 1500.0,
    "by_account": {
        "acc_001": {"equity": 5234.50, "pnl": 234.50, "positions": 2},
        "acc_002": {"equity": 10500.00, "pnl": 500.00, "positions": 3},
        "acc_003": {"equity": 9265.50, "pnl": 765.50, "positions": 0}
    },
    "consolidated_positions": [
        {
            "symbol": "BTCUSDm",
            "direction": "BUY",
            "total_lot": 0.5,
            "accounts": ["acc_001", "acc_002"],
            "avg_entry": 43500.0,
            "unrealized_pnl": 350.0
        }
    ]
}

# Close position across all accounts
POST /multi-account/positions/close-all

{
    "symbol": "BTCUSDm"
}

{
    "closed": [
        {"account": "acc_001", "ticket": 12345, "pnl": 150.0},
        {"account": "acc_002", "ticket": 67890, "pnl": 200.0}
    ],
    "total_pnl": 350.0
}
```

## 5. Implementation Phases

### Phase 1: Account Management (Day 1)
- [ ] AccountRegistry class
- [ ] AccountConfig model
- [ ] Add/Remove/Enable accounts endpoints

### Phase 2: Connection Pool (Day 2)
- [ ] MT5ConnectionPool class
- [ ] Connection management
- [ ] Get positions/balance per account

### Phase 3: Sync Logic (Day 3)
- [ ] SyncController class
- [ ] Sync modes (MIRROR, PROPORTIONAL, INDIVIDUAL)
- [ ] Trade signal processing

### Phase 4: Dashboard (Day 4)
- [ ] Portfolio consolidation
- [ ] Position tracking
- [ ] UI integration

## 6. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Multiple passwords | Use MT5 manager credentials, encrypted storage |
| Connection limits | Connection pooling with rate limiting |
| Over-trading | Per-account lot limits enforced |
| Sync conflicts | Optimistic locking with retry |
| Data consistency | Periodic state reconciliation |

## 7. Executive Arm Integration

```python
# Per-account Executive Arm settings
class AccountEnforcementSettings(BaseModel):
    account_id: str
    max_lot_per_symbol: dict[str, float]
    daily_profit_target: float
    auto_close_enabled: bool
    sleep_gap_protection: bool

# Sync controller coordinates with Executive Arm
class MultiAccountExecutiveArm:
    """Coordinate enforcement across accounts"""
    
    def get_account_settings(self, account_id: str) -> AccountEnforcementSettings:
        """Get enforcement settings for account"""
        
    def sync_limits(self, symbol: str, total_lot: float) -> dict[str, float]:
        """Distribute lot limit across accounts"""
        
    def aggregate_status(self) -> dict:
        """Get aggregated status from all accounts"""
```

---

*This architecture document will be updated as implementation progresses.*