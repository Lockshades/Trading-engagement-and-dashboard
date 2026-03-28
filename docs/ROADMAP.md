# Development Roadmap

> Last Updated: 2026-03-28

This document tracks the development progress toward production readiness. All features are classified by type.

## Legend: Feature Classifications

- **Core** - Essential functionality without which the product cannot function
- **UX** - User experience improvements, UI/visual enhancements  
- **Backend** - API, data processing, business logic
- **Risk Management** - Risk controls, position sizing, loss limits
- **Novel** - Unique competitive advantages
- **Infrastructure** - DevOps, testing, deployment

## Feature Progress

### Completed Features

| Feature | Classifications | Status | Notes |
|---------|-----------------|--------|-------|
| Risk Scanner | Core, UX, Backend | Done | Live MT5 pair scanning with ADX classification |
| Target Planner | Core, Backend, Novel | Done | Milestone-based capital growth planning |
| Daily KPI | Core, UX, Risk Management | Done | Real-time progress tracking against plan |
| History Analysis | Core, Backend | Done | Trade statistics, win rate, avg win/loss |
| Open Position Alignment | Core, UX, Risk Management | Done | Compares live positions to daily plan |
| Move Unit (Pips/Points) | Backend, Novel | Done | Asset-class-aware unit calculation |
| External Cash Flow | Backend, Risk Management | Done | Adjusts progress for deposits/withdrawals |
| Error Boundary | UX, Infrastructure | Done | Graceful error handling in React |

### In Progress - TIER 1 (Immediate)

| Feature | Classifications | Status | Notes |
|---------|-----------------|--------|-------|
| Executive Arm - Lot Size Cap | Core, Risk Management, Novel | Done | Enforce max lot per symbol from daily KPI |
| Executive Arm - Auto-Close | Core, Risk Management, Novel | Done | Auto-close at +10% buffer |
| Milestone Setback Logic | Core, Backend | Done | Better cashflow classification for milestone tracking |
| State Persistence | UX | Done | localStorage persistence for Target Planner |
| Sleep/Gap Protection | Core, Risk Management, Novel | In Progress | Prevent account destruction from weekend gaps |
| Multi-Account Sync | Core, Backend, Novel | Pending | PROP firm multi-account management |

### Backlog - TIER 2

| Feature | Classifications | Priority | Notes |
|---------|-----------------|----------|-------|
| Correlation-Aware Sizing | Core, Risk Management, Novel | P1 | Adjust lot by correlation matrix |
| Drawdown Recovery Sizing | Core, Risk Management | P1 | Reduce lot after drawdown |
| Session-Specific Risk | Risk Management | P2 | Adjust lot by trading session |
| Smart Breakeven | UX | P2 | Confirm before moving SL to BE |

## Progress Summary

- **Total Features**: 8 complete, 8 in progress/backlog
- **Completion**: 50% of identified features implemented
- **Tier 1 Priority**: 4 features in active development

## Next Steps

1. Complete Executive Arm Phase 1 (Lot Size Cap + Auto-Close)
2. Design Sleep/Gap Protection architecture
3. Design Multi-Account Sync architecture
4. Push to GitHub
