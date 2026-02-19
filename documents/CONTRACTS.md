# Contracts

Purpose: concise contract reference for payloads/events likely to drift.

## Node Contract

Canonical runtime shape:

{
  "time": "HH:MM",
  "temp": 20.5,
  "noChange": false,
  "hvac_mode": "heat",
  "fan_mode": "auto",
  "swing_mode": "off",
  "preset_mode": "none",
  "A": null,
  "B": null,
  "C": null
}

Required:
- time (HH:MM)
- temp (numeric in validation path)

Invariants:
- storage validate_node enforces time format and numeric temp.
- 24:00 is normalized to 23:59 in storage validation.
- UI keeps at least one node (delete guard in node settings).
- noChange means skip temperature apply but allow mode application.
- Frontend no-temperature-change toggle locks node temperature to previous-node value with wrap-around; single-node schedules retain their own value.
- Frontend mode selectors expose `-- No Change --` as empty string; save path removes mode field when empty.
- Mode no-change is represented by omitted node fields (`hvac_mode`, `fan_mode`, `swing_mode`, `preset_mode`) rather than a sentinel string.
- Newly added timeline nodes default non-temperature settings to no-change by omitting mode fields until explicitly set.

Frontend dialog-state contract (runtime → climate dialog):
- `stateObj.attributes.temperature_step` (optional number; defaults to `0.5` in dialog)
- `stateObj.attributes.humidity_step` (optional number; defaults to `1` in dialog)
- These are UI precision controls only and do not alter backend node schema.
- Frontend timeline and slider edit paths must be step-normalized before persistence (no float tails like `18.40000000002`).

## Schedule Contract

- schedule_mode: all_days | 5/2 | individual
- schedules keys:
  - all_days mode: all_days
  - 5/2 mode: weekday/weekend
  - individual mode: mon..sun
- global profiles: { profile_name: { schedule_mode, schedules } }
- active_profile: string

Invariants:
- non-active profile save must not switch active_profile.
- group-level current schedule mirrors the selected global active profile.
- profiles are shared globally across all schedules; each group stores only `active_profile` selection.
- creating a new profile seeds from the selected schedule's current mode/schedules.
- enabling monitoring for an entity/group with empty schedules seeds a single `all_days` schedule from configured settings default schedule.

## Group Contract

Core fields:
- entities
- enabled
- ignored
- schedule_mode
- schedules
- active_profile
- _is_single_entity_group (internal)

Global storage field:
- profiles

Legacy preservation fields (migration compatibility):
- group `profiles` remains in-place and is retagged as `<profile> [legacy]`
- active_profile_legacy

Naming:
- single-entity groups: __entity_<entity_id>

## Service Contract (high-use)

- set_group_schedule:
  - schedule_id, nodes, optional day/schedule_mode/profile_name
  - validated in services.py, persisted in storage.py
- set_schedule:
  - schedule_id, nodes, optional day/schedule_mode
- test_fire_event:
  - schedule_id, node, optional day
  - emits event only; does not apply climate changes

`schedule_id` target type matrix (selected high-use services):
- entity-only: set_schedule, get_schedule, clear_schedule, set_ignored, cancel_advance, get_advance_status, clear_advance_history
- group-only: set_group_schedule, enable_group, disable_group, create_profile, delete_profile, rename_profile, set_active_profile, get_profiles
- entity-or-group: enable_schedule, disable_schedule, advance_schedule, test_fire_event

Note:
- Runtime storage is group-backed (including single-entity groups), but service input compatibility is intentionally mixed.

## Event Contracts

HA bus event:
- climate_scheduler_node_activated
- Producers:
  - coordinator manual advance (trigger_type=manual_advance)
  - coordinator scheduled transition (trigger_type=scheduled)
  - services test_fire_event (trigger_type=test)
- Current payload includes entities, group_name, node, day, trigger_type
- For manual advance wrap-around (next node occurs on next day), `day` reflects the target node day.
- Deprecated compatibility field still present in some paths: entity_id

## Coordinator Apply Order

- Coordinator applies HVAC/off mode before temperature.
- For `hvac_mode: off`, coordinator turns off first, then attempts temperature apply.
- For non-`off` HVAC modes, coordinator sets HVAC mode first, then temperature.
- Fan/swing/preset are still applied only when specified and supported.

## Save Pipeline Contract (frontend runtime)

- Save requests are debounced and serialized via `isSaveInProgress`.
- If save is requested while schedule is loading, frontend sets `pendingSaveNeeded` and re-runs save after loading completes.
- Missing schedule-enabled UI element must not block schedule persistence.

Frontend timeline events:
- keyframe-selected: { index, keyframe }
- keyframe-moved: { index, keyframe }
- keyframe-deleted: { index, keyframe } or explicit dispatch

## Migration Notes

storage async_load migrations:
- day schedule migration
- profiles migration
- per-group profiles to global profiles migration (`<schedule name> - <profile name>`)
- per-group originals preserved as tagged legacy copies (`<profile name> [legacy]`)
- entity-to-single-group migration

## Last Updated

- Date: 2026-02-19
- Updated by: Copilot (GPT-5.3-Codex)
