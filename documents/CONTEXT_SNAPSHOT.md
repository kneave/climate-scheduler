# Context Snapshot

Purpose: compact handoff for future Copilot sessions.

## Architecture Reality

- Runtime orchestrator: custom_components/climate_scheduler/frontend/app.js
- Compiled TS components in src/*.ts (Rollup)
- Backend engine/storage/services:
  - custom_components/climate_scheduler/coordinator.py
  - custom_components/climate_scheduler/storage.py
  - custom_components/climate_scheduler/services.py

## Source-of-Truth Rules

- Edit TS source for compiled components.
- Avoid direct edits to compiled JS when TS exists.
- app.js is direct runtime source and is edited directly.

## Active Conventions

- Shared node settings panel works for active + profile timelines.
- Node actions are timeline-context aware.
- Delete uses trash icon; close uses X.
- Save pipeline is debounced and guarded by in-progress flags.
- While schedule loading is active, save requests are queued and flushed after load completes.
- Node-selection context switches in main timeline must not overwrite in-memory `currentSchedule` edits.
- Climate dialog dual-range sliders rely on `pointer-events: none` at input level and must explicitly enable thumb interaction for both WebKit and Firefox (`::-webkit-slider-thumb` and `::-moz-range-thumb`).
- Climate dialog slider steps are settings-driven: temperature uses `temperature_step` (default `0.5`) and humidity uses `humidity_step` (default `1`).
- New timeline nodes default non-temperature settings to no-change (mode fields omitted until user sets them).
- New profile creation seeds a single `all_days` schedule from configured default schedule.
- Enabling monitoring on entities/groups with empty schedules seeds a single `all_days` schedule from configured default schedule.

## High-Risk Areas

- app.js event wiring and shared state.
- coordinator.py time-boundary and override lifecycle logic.
- storage.py migration + schedule/profile normalization logic.
- services.py large service/schema surface.

## Open Risks

- Large-file regression risk in orchestration modules.
- Frontend/backend contract drift risk.
- Limited first-party automated tests for critical workflows.
- Search/review noise from local .venv-test unless scope is constrained.

## Minimal Regression Checklist

- Node select/move/delete on active timeline.
- Node select/move/delete on profile timeline.
- Profile save path does not mutate active profile unintentionally.
- all_days / 5/2 / individual transitions resolve correctly.
- advance/cancel and test event payloads behave as expected.
- Timeline drag and node-settings/climate-dialog temperature slider edits stay step-normalized (no float tails like `18.40000000002`).
- Climate dialog undo restores non-temperature node settings (HVAC/fan/swing/preset/range/humidity), not temperature only.

## Related Docs

- documents/ARCHITECTURE_MAP.md
- documents/CONTRACTS.md
- documents/HOTSPOTS_APP_JS.md
- documents/HOTSPOTS_COORDINATOR.md
- documents/adr/README.md

## Last Updated

- Date: 2026-02-19
- Updated by: Copilot (GPT-5.3-Codex)
