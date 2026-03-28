# Project Manifest

## Product Intent

Build a sellable trading product that helps users in ways the current market does not yet handle well.

The product should not become a disconnected pile of dashboards, indicators, or experiments. It should become a coherent decision-support system that helps traders:
- understand what happened
- understand what is happening now
- plan what should happen next
- eventually receive higher-quality guidance from an intelligence layer

Every serious feature, fix, refactor, or research spike should be aligned to that product goal.

## Core Product Goal

Create a trading discipline and decision-support product that combines live MT5 data, historical analysis, and forward planning into a workflow that is useful enough to pay for.

The product should help users:
- choose safer or more suitable instruments
- understand recent and historical trading behavior
- monitor live performance and open-position alignment
- plan realistic future actions and targets
- eventually receive context-aware intelligence and advice

## Major Feature Layers

These are the four major product layers. They are not the same thing as tabs. A single tab can use multiple layers.

### 1. Intelligence Layer

Purpose:
- bring in outside intelligence, advice, or interpretation that the local app cannot derive alone

Examples:
- AI-assisted web browsing for external market or contextual information
- advice generation based on live, historical, and projected state
- explanation systems that synthesize across the other layers

Current status:
- not implemented yet

Rule:
- intelligence should enrich the product, not replace the product's own data discipline

### 2. History Layer

Purpose:
- analyze past events, trading history, and historical patterns

Examples:
- trade history statistics
- win rate, average win, average loss
- marginal trade analysis
- history-window controls
- pattern extraction from prior deals or sessions

Rule:
- this layer explains what has happened and what has historically tended to happen

### 3. Live Layer

Purpose:
- handle ongoing state and current conditions

Examples:
- Scanner tab
- live MT5 account state
- open positions
- daily KPI with live closed/open trade state
- current pair selection and live alignment

Rule:
- this layer explains what is happening now

### 4. Projection / Prediction Layer

Purpose:
- use information from the other layers to plan or estimate future paths

Examples:
- milestone generation
- target path planning
- KPI thresholds as future-facing targets
- expected progression bands
- position or day-level forward planning

Rule:
- this layer explains what should happen next or what is expected to happen if current assumptions hold

## Layering Rules

### Primary Layer

Every serious work item should have one primary layer.

Ask:
- what is the main job of this feature or fix?
- which layer would still matter most if the rest were removed?

That answer defines the primary layer.

### Secondary Layers

A feature may touch multiple layers.

Examples:
- Daily KPI is primarily `Live`, but it also depends on `Projection / Prediction`
- Target planning is primarily `Projection / Prediction`, but it depends heavily on `History`
- future AI advice may be primarily `Intelligence`, but it will likely consume all three other layers

Use one primary layer and note secondary layers when relevant. Do not classify one issue into every layer just because it has dependencies.

## Feature Map Rules

The roadmap should behave like a tree, not a pile.

Every serious issue should identify:
- the main product goal it supports
- its primary layer
- any secondary layers
- the parent capability or nearest related branch
- what existing resources, code paths, or issues it should reuse
- what it unlocks next

Avoid:
- orphan features
- duplicate branches
- similar-but-unlinked issues
- speculative features with no tie to the sellable product path

## Capability Branches

Within the four layers, group work into reusable capability branches.

Initial branch examples:
- Pair Scanning
- Target Planning
- Daily KPI and Live Alignment
- Historical Performance Analysis
- Marginal Analysis
- MT5 Diagnostics and Reliability
- Persistence and Auditability
- Intelligence and Advice

New issues should attach to one of these branches or justify a new branch.

## Alignment Questions For New Work

Before serious implementation, answer:
1. What user problem does this solve?
2. How does it support the main sellable-product goal?
3. Which primary layer does it belong to?
4. Which existing branch is it part of?
5. What can it reuse?
6. What does it unlock or strengthen next?
7. Is this a feature, bug, or improvement?
8. Would this still look valuable if the product were sold today?

If those answers are weak, the work probably needs to be reframed before coding.

## Current Product Mapping

Based on the current repo:

- `Scanner` tab
  - Primary layer: `Live`
  - Branch: `Pair Scanning`

- `Target` Path tab
  - Primary layer: `Projection / Prediction`
  - Secondary layer: `History`
  - Branch: `Target Planning`

- `Target` Analysis tab
  - Primary layer: `History`
  - Secondary layer: `Projection / Prediction`
  - Branch: `Historical Performance Analysis` and `Marginal Analysis`

- `Target` Daily KPI tab
  - Primary layer: `Live`
  - Secondary layer: `Projection / Prediction`
  - Branch: `Daily KPI and Live Alignment`

- future AI advice / browsing work
  - Primary layer: `Intelligence`
  - Secondary layers: likely all others
  - Branch: `Intelligence and Advice`

## Governance Rule

Linear is the operational tracker.

This manifest is the product-structure guide.

Use both together:
- Linear tracks execution and status
- this manifest tracks alignment, layering, and branch structure

If a planned feature cannot be mapped cleanly in this manifest, it should not move forward without clarification.
