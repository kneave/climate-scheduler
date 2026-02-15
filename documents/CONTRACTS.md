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

## Schedule Contract

- schedule_mode: all_days | 5/2 | individual
- schedules keys:
  - all_days mode: all_days
  - 5/2 mode: weekday/weekend
  - individual mode: mon..sun
- profiles: { profile_name: { schedule_mode, schedules } }
- active_profile: string

Invariants:
- non-active profile save must not switch active_profile.
- group-level current schedule mirrors active profile.

## Group Contract

Core fields:
- entities
- enabled
- ignored
- schedule_mode
- schedules
- profiles
- active_profile
- _is_single_entity_group (internal)

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

## Event Contracts

HA bus event:
- climate_scheduler_node_activated
- Producers:
  - coordinator manual advance (trigger_type=manual_advance)
  - coordinator scheduled transition (trigger_type=scheduled)
  - services test_fire_event (trigger_type=test)
- Current payload includes entities, group_name, node, day, trigger_type
- Deprecated compatibility field still present in some paths: entity_id

Frontend timeline events:
- keyframe-selected: { index, keyframe }
- keyframe-moved: { index, keyframe }
- keyframe-deleted: { index, keyframe } or explicit dispatch

## Migration Notes

storage async_load migrations:
- day schedule migration
- profiles migration
- entity-to-single-group migration

## Last Updated

- Date: 2026-02-15
- Updated by: Copilot (GPT-5.3-Codex)
