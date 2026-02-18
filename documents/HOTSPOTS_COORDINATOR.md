# Hotspot Guide: coordinator.py

Target: custom_components/climate_scheduler/coordinator.py

## Why It’s Risky

- Time-based logic and day boundaries are error-prone.
- Override lifecycle (advance/cancel/expiry) affects correctness.
- Event emission must match transition semantics.

## Key Methods

- advance_to_next_node
- advance_group_to_next_node
- cancel_advance
- async_get_advance_status
- is_workday_enabled / get_workdays / is_workday
- periodic update path (_async_update_data)

## Invariants

- Node application must be deterministic for current time/day.
- Manual advance must resolve next node across day boundaries (today-first, otherwise next valid day) and report target-node day.
- Overrides expire exactly at intended target time.
- Re-application loops avoided via last-state signatures.
- Scheduled events fire on node-time transitions, not every value write.
- Climate apply sequencing is mode-first then temperature.

## Common Regressions

- Off-by-one around period boundaries/midnight.
- Manual advance selects wrong next node when only earlier times remain today.
- Override not clearing or clearing early.
- Group and single-entity behavior divergence.
- Event payload drift across manual/scheduled/test triggers.
- Mode/temperature apply order drift (temperature before mode).

## Minimal Verification

- all_days, 5/2, individual mode transitions.
- Advance → cancel flow.
- Manual advance near day boundary where next node is on the following day.
- Scheduled transition event payload.
- Virtual/no-entity group event-only behavior (if used).
- Verify mode-off and non-off nodes apply mode first, then temperature.

## Last Updated

- Date: 2026-02-18
- Updated by: Copilot (GPT-5.3-Codex)
