# Marginal Viz — Real MT5 Data Validation Layer

**Date:** 2026-03-20
**Status:** Approved
**Goal:** Add real MT5 trade data to marginal_viz.jsx as second validation layer before live environment.

## Data Source

- 37 closed trades from Exness account 130965031 (NGN, BTCUSDm + 1 ETHUSDm)
- 10 trading days: 2026-01-14 to 2026-03-07
- 62.2% win rate, ₦104,442 gross profit
- 5 of 10 days hit 1% threshold, above-threshold positions +1 through +7

## Design Decisions

1. **Data source toggle** in header — switch between Synthetic (60 days) and Real MT5 (10 days). All analytics recompute on switch.
2. **Configurable threshold slider** — 0.5% to 5.0% of ₦150,000 capital, step 0.1%. Shows both % and ₦. Recomputes above/below classification dynamically.
3. **New "Economics" tab** — plots AC, MR, MC, TC curves by trade position:
   - MR = mean gross P&L at position N (pooled across days)
   - MC = opportunity cost: ₦0 below threshold, `locked_profit × loss_rate` above
   - TC = cumulative MC
   - AC = TC / N
   - Annotated MR/MC intersection = optimal stopping point
4. **Spread cost ignored** for now (B) — commission and swap are ₦0 on this account. MC is purely opportunity cost above threshold.
5. **Statistical warnings** — amber banner on real data noting limited sample size. Suggestions suppressed when n < 20.

## Implementation

- Embed real trade data as JS constant in the component
- Add data source toggle + threshold slider to header
- Recompute all analytics reactively when either control changes
- Add 5th tab "Economics" with AC/MR/MC/TC chart
- Real data uses close_time for day grouping and trade sequencing
