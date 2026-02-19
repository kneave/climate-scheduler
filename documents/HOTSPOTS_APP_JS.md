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
- Pending save dropped while schedule is loading (`isLoadingSchedule`) and never flushed.
- `currentSchedule` overwritten from cached group data during node selection, dropping unsaved edits.
- Node settings panel location/context mismatch after selection.
- Listener duplication after re-render/editor rebuild.
- Dialog settings drift where temperature/humidity slider step in settings is not propagated into climate dialog state.

## Safe Edit Sequence

1) Identify active vs profile timeline path.
2) Confirm state source (timeline ref + currentSchedule/currentDay).
3) Make minimal change in one path.
4) Mirror if needed for default schedule path.
5) Verify no duplicated listeners.

## Minimal Verification

- Select/move/delete node in active timeline.
- Select/move/delete node in profile timeline.
- Edit existing node settings (mode/temp/noChange), then select another node and confirm edits persist/save.
- Confirm save persists and panel state is stable.
- Trigger an edit while schedule is loading; confirm save runs after load completes.
- Confirm mode/day/profile switch does not corrupt current schedule.
- Change temperature and humidity slider-step settings, open node dialog, and confirm slider increments match configured step.
- Drag timeline nodes and adjust node-settings temperature controls repeatedly; confirm saved/displayed values are step-normalized (no float tails like `18.40000000002`).
- In climate dialog, change HVAC/fan/swing/preset/range/humidity settings and verify undo restores those non-temperature settings as well as temperature.

## Last Updated

- Date: 2026-02-19
- Updated by: Copilot (GPT-5.3-Codex)
