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
- Overrides expire exactly at intended target time.
- Re-application loops avoided via last-state signatures.
- Scheduled events fire on node-time transitions, not every value write.

## Common Regressions

- Off-by-one around period boundaries/midnight.
- Override not clearing or clearing early.
- Group and single-entity behavior divergence.
- Event payload drift across manual/scheduled/test triggers.

## Minimal Verification

- all_days, 5/2, individual mode transitions.
- Advance → cancel flow.
- Scheduled transition event payload.
- Virtual/no-entity group event-only behavior (if used).

## Last Updated

- Date: 2026-02-15
- Updated by: Copilot (GPT-5.3-Codex)
