# Architecture Map

Purpose: minimal index for where to change code safely.

## Core Modules

- Frontend orchestrator: custom_components/climate_scheduler/frontend/app.js
- TS components (compiled):
  - src/keyframe-timeline.ts
  - src/climate-dialog.ts
  - src/panel.ts
  - src/climate-scheduler-card.ts
- Backend runtime:
  - custom_components/climate_scheduler/coordinator.py
  - custom_components/climate_scheduler/storage.py
  - custom_components/climate_scheduler/services.py

## Source-of-Truth Rules

- Edit src/*.ts for compiled frontend components.
- Do not hand-edit compiled JS when TS source exists.
- app.js is direct runtime source and can be edited directly.

## Build Path

- Rollup config: rollup.config.mjs
- TS source: src/*.ts
- Compiled output: custom_components/climate_scheduler/frontend/*.js

## Runtime Flow

1) User edits graph/node/profile in UI.
2) app.js updates state and dispatches API calls.
3) services.py validates/maps service payloads.
4) storage.py persists group/profile/schedule.
5) coordinator.py resolves/apply active node and emits events.

## Where To Change X

- Node model fields:
  - src/keyframe-timeline.ts
  - src/climate-dialog.ts
  - custom_components/climate_scheduler/frontend/app.js
  - custom_components/climate_scheduler/storage.py
  - custom_components/climate_scheduler/services.py
  - custom_components/climate_scheduler/coordinator.py
- Node settings behavior:
  - custom_components/climate_scheduler/frontend/app.js
- Save/debounce behavior:
  - custom_components/climate_scheduler/frontend/app.js (saveSchedule, performSave)
- Tooltip behavior:
  - src/keyframe-timeline.ts
  - custom_components/climate_scheduler/frontend/app.js (mode selector)
- Climate dialog dual-range slider browser compatibility:
  - src/climate-dialog.ts (thumb pointer-events for `::-webkit-slider-thumb` and `::-moz-range-thumb`)
- Day/mode mapping:
  - custom_components/climate_scheduler/storage.py
  - custom_components/climate_scheduler/frontend/app.js

## Stable Event/Service Surface

- Frontend events: keyframe-selected, keyframe-moved, keyframe-deleted
- HA bus event: climate_scheduler_node_activated
- High-use services:
  - set_group_schedule
  - set_schedule
  - test_fire_event
  - advance_schedule / advance_group / cancel_advance
  - create_profile / delete_profile

## Hotspots

- custom_components/climate_scheduler/frontend/app.js
- custom_components/climate_scheduler/coordinator.py
- custom_components/climate_scheduler/storage.py
- custom_components/climate_scheduler/services.py

## Last Updated

- Date: 2026-02-18
- Updated by: Copilot (GPT-5.3-Codex)
