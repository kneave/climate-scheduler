# Hotspot Guide: app.js

Target: custom_components/climate_scheduler/frontend/app.js

## Why It’s Risky

- Large orchestration surface: UI lifecycle, graph wiring, node settings, save pipeline.
- Shared state across active timeline and profile timeline.
- Dynamic DOM and event listeners can drift or duplicate.

## Key Functions

- initApp
- loadKeyframeTimeline
- editGroupSchedule
- showNodeSettingsPanel
- handleNodeSettings
- saveSchedule
- performSave
- setupEventListeners
- handleDefaultNodeSettings

## Critical State

- currentGroup, currentEntityId
- editingProfile
- currentDay, currentScheduleMode, currentSchedule
- graph, nodeSettingsTimeline
- isLoadingSchedule, isSaveInProgress, pendingSaveNeeded, saveTimeout
- SAVE_DEBOUNCE_MS (300)

## Common Regressions

- Node action applies to wrong timeline context.
- Non-active profile edits leak into active profile.
- Pending save dropped while save in progress.
- Node settings panel location/context mismatch after selection.
- Listener duplication after re-render/editor rebuild.

## Safe Edit Sequence

1) Identify active vs profile timeline path.
2) Confirm state source (timeline ref + currentSchedule/currentDay).
3) Make minimal change in one path.
4) Mirror if needed for default schedule path.
5) Verify no duplicated listeners.

## Minimal Verification

- Select/move/delete node in active timeline.
- Select/move/delete node in profile timeline.
- Confirm save persists and panel state is stable.
- Confirm mode/day/profile switch does not corrupt current schedule.

## Last Updated

- Date: 2026-02-15
- Updated by: Copilot (GPT-5.3-Codex)
