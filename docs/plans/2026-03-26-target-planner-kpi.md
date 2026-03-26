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
- `src/TargetPlanner.jsx`
  - Path tab for target planning
  - Daily KPI tab for live progress
  - Manual overrides for `win_rate`, `avg_win_ngn`, and `avg_loss_ngn`
- `src/RiskScanner.jsx`
  - `Target` tab added to the dashboard
  - Shared settings flow into the planner view
- `tests/test_target_planner.py`
  - Planner math coverage extended to KPI states and zero-pip handling

## Current behavior

- Planning pair selection is automatic in v1.
- The backend scores the live watchlist and picks the best available symbol using:
  - `SAFE` before `MODERATE` before `RISKY`
  - highest score within that class
- If no usable symbol is available, the planner falls back to `ETHUSDm`.
- Trade history lookback is 90 days.
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
- `planning_symbol`
- `current_milestone`
- `kpi`

## Verification

- `npm test`
- `npm run build`
- Manual MT5 check:
  - Start Vite and the FastAPI backend
  - Confirm `Scanner`, `Settings`, and `Target` tabs render
  - Confirm `/plan` and `/kpi/today` return data with MT5 open
