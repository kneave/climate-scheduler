# Codebase Action Plan

Date: 2026-02-15
Scope: frontend orchestration, schedule contracts, backend scheduling engine, and quality gates.

## Objective

Reduce regression risk and maintenance overhead while preserving current feature velocity.

## Top Priorities

1. Stabilize contracts between frontend node payloads and backend validators.
2. Add a small critical-path test suite for schedule/profile/day-mode behavior.
3. Reduce complexity in the biggest orchestration hotspot (app.js).
4. Improve review/search hygiene by scoping out local environment noise.

## Current Hotspots

- custom_components/climate_scheduler/frontend/app.js
- custom_components/climate_scheduler/coordinator.py
- custom_components/climate_scheduler/storage.py
- custom_components/climate_scheduler/services.py

## Execution Options

### Option A — Hardening (Fastest)

Deliverables:
- Shared payload validation + normalization checks.
- Critical-path tests for:
  - profile switching/save semantics
  - all_days/5-2/individual transitions
  - node add/move/delete invariants
  - advance/cancel lifecycle behavior
- Search/test hygiene updates to avoid .venv-test noise.

Effort: 1–2 weeks
Risk: Low
Best for: immediate reliability gains.

### Option B — Modular Refactor (Balanced)

Deliverables:
- Frontend separation of concerns in app.js:
  - state/context
  - schedule transforms
  - node settings controller
  - API side-effect layer
- Backend extraction:
  - schedule resolution engine
  - override/advance lifecycle helper
  - service mapping layer

Effort: 3–6 weeks
Risk: Medium
Best for: sustained development velocity.

### Option C — Domain + Contract Testing (Strategic)

Deliverables:
- Explicit versioned schemas for node/schedule/profile/group.
- Contract tests across frontend payload generation ↔ backend acceptance.
- Deterministic time simulation tests for coordinator transitions.
- CI quality gates (type-check + targeted tests + hygiene checks).

Effort: 6–10 weeks
Risk: Medium-high initial investment
Best for: long-term confidence and scale.

## Recommended Sequence

A → B (selected extractions) → C (contract/simulation layers)

Why:
- A quickly reduces incidents.
- B removes core maintainability bottlenecks.
- C then locks behavior with stronger guarantees.

## 30/60/90 Plan

### Days 1–30
- Implement Option A deliverables.
- Baseline metrics: defect count, regression count, time-to-fix.

### Days 31–60
- Extract frontend save/node-settings orchestration modules.
- Extract backend override/advance helper.

### Days 61–90
- Add contract tests + deterministic time simulation tests.
- Add CI gates and fail-fast checks.

## Success Metrics

- Fewer regressions in schedule/profile editing flows.
- Lower mean time to isolate frontend orchestration bugs.
- Reduced large-file churn in app.js/coordinator/services modules.
- Increased coverage of schedule invariants and override behavior.

## Related Docs

- documents/ARCHITECTURE_MAP.md
- documents/CONTRACTS.md
- documents/HOTSPOTS_APP_JS.md
- documents/HOTSPOTS_COORDINATOR.md
- documents/CONTEXT_SNAPSHOT.md
- documents/adr/README.md
