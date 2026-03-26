# Target Planner + KPI Tracker

## Status

Implemented in the repo.

## Overall Task List

1. History analysis engine - done
2. Milestone generator - done
3. Daily KPI calculator - done
4. API endpoints (`/plan`, `/kpi/today`) - done
5. Frontend `TargetPlanner` component - done
6. Dashboard integration (`Target` tab in `RiskScanner`) - done

## Validation Status

- Automated planner math coverage is in place.
- Automated API route and helper coverage is being extended to make breakage easier to localize.
- Manual MT5/browser smoke validation is still recommended before relying on live trading decisions.

## What shipped

- `backend/target_planner.py`
  - `analyze_history(deals)` for trade-history statistics
  - `compute_milestones(...)` for compounding path generation
  - `get_kpi_today(...)` for daily KPI status and counters
- `backend/api.py`
  - `POST /scan` preserved for the existing scanner
  - `POST /plan` added for planner generation
  - `GET /kpi/today` added for daily KPI snapshots
  - MT5 account balance resolution with manual override support
- `src/TargetPlanner.jsx`
  - Path tab for target planning
  - Daily KPI tab for live progress
  - Manual overrides for `win_rate`, `avg_win_ngn`, and `avg_loss_ngn`
- `src/RiskScanner.jsx`
  - `Target` tab added to the dashboard
  - Shared settings flow into the planner view
  - Balance source toggle: MT5 by default, manual when explicitly selected
- `tests/test_target_planner.py`
  - Planner math coverage extended to KPI states and zero-pip handling
- `tests/test_api.py`
  - API and balance-resolution coverage for scan, plan, KPI, and MT5/manual balance edge cases

## Current behavior

- Planning pair selection is automatic in v1.
- The backend scores the live watchlist and picks the best available symbol using:
  - `SAFE` before `MODERATE` before `RISKY`
  - highest score within that class
- If no usable symbol is available, the planner falls back to `ETHUSDm`.
- Trade history lookback is 90 days.
- Balance uses MT5 account data by default.
- Manual balance is now an explicit override from the Settings tab.
- If MT5 account balance is zero but equity is available, the backend falls back to equity.
- If neither a manual override nor usable MT5 funds are available, the backend falls back to the local default balance.
- If the requested target is less than or equal to current balance, `/plan` returns an empty milestone list.
- If there is no active milestone for the current target, `/kpi/today` returns `current_milestone: null` and `kpi: {}`.
- Very thin history opens the override panel by default in the UI.

## API shapes

### `POST /plan`

Request body:

```json
{
  "target_ngn": 1000000,
  "balance": 150000,
  "daily_loss_pct": 0.02,
  "risk_pct": 0.01,
  "overrides": {
    "win_rate": 0.55,
    "avg_win_ngn": 2500,
    "avg_loss_ngn": 1400
  }
}
```

Response fields:

- `balance_ngn`
- `balance_source`
- `account_snapshot`
- `target_ngn`
- `daily_loss_pct`
- `risk_pct`
- `planning_symbol`
- `history_stats`
- `pair_info`
- `milestones`

### `GET /kpi/today`

Query params:

- `balance`
- `daily_loss_pct`
- `risk_pct`
- `target_ngn`

Response fields:

- `date`
- `balance_ngn`
- `balance_source`
- `account_snapshot`
- `planning_symbol`
- `current_milestone`
- `kpi`

### `POST /scan`

Response fields now also include:

- `balance_ngn`
- `balance_source`
- `account_snapshot`

## Verification

- `npm test`
- `npm run build`
- Balance resolution coverage in automated tests:
  - manual override wins when provided
  - MT5 balance is used when no manual value is supplied
  - MT5 equity is used when balance is zero
- Manual MT5 check:
  - Start Vite and the FastAPI backend
  - Confirm the Settings tab defaults to `Use MT5`
  - Confirm scanner summary shows the active balance source
  - Confirm `Scanner`, `Settings`, and `Target` tabs render
  - Confirm `/plan` and `/kpi/today` return data with MT5 open
