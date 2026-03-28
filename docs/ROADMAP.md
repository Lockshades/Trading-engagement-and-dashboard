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

### In Progress

| Feature | Classifications | Status | Notes |
|---------|-----------------|--------|-------|
| None currently | | |

### Backlog

| Feature | Classifications | Priority | Notes |
|---------|-----------------|----------|-------|
| Marginal Analysis | Core, Backend, Novel | P1 | Marginal trade cutoff optimization |
| AI Intelligence Layer | Novel | P2 | Context-aware advice generation |
| MT5 Diagnostics | Infrastructure | P2 | Connection reliability monitoring |
| Persistence/Audit | Backend, Infrastructure | P2 | Trade logging and session history |
| Data Export | UX | P3 | Export reports to CSV/PDF |

## Progress Summary

- **Total Features**: 8 complete, 5 in backlog
- **Completion**: 61.5% of identified features implemented
- **Classification Coverage**: All 6 classifications have at least 1 feature

## Next Steps

1. Complete Marginal Analysis (P1)
2. Add MT5 connection diagnostics (P2)
3. Begin AI Intelligence research spikes (P2)
