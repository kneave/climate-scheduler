# KNOWLEDGE: coordinator.py

## Purpose
`HeatingSchedulerCoordinator` extends HA's `DataUpdateCoordinator` and is the runtime heart of Climate Scheduler. Every update cycle it resolves the active schedule node for each climate entity (respecting group membership, day-of-week, schedule mode, and advance overrides), then applies HVAC mode → temperature → fan/swing/preset in that order. It also owns the manual-advance lifecycle (advance, cancel, expiry, history), workday-integration detection, and event emission for both scheduled transitions and manual advances.

## Key Functions (alphabetical)

### __init__(line 85)
- **Signature**: `__init__(self, hass: HomeAssistant, storage: ScheduleStorage, update_interval: timedelta) -> None`
- **Contract**: Initialises coordinator with storage and update interval; sets up empty tracking dicts.
- **Mutates**: `self.last_node_states`, `self.last_node_times`, `self.override_until`, `self.advance_history`, `self._workday_available`
- **Calls**: `super().__init__`
- **Called by**: Integration setup (config_entry)
- **Edge cases**: None
- **Test coverage**: Tested (init path)

### _async_update_data(line 630)
- **Signature**: `async _async_update_data(self) -> Dict[str, Any]`
- **Contract**: Periodic update callback. For each entity in each enabled non-ignored group, resolves the active node for current time/day, applies settings (HVAC mode first, then temperature, then fan/swing/preset), fires `climate_scheduler_node_activated` events on time transitions. Returns dict of per-entity results. Raises `UpdateFailed` on unhandled exceptions.
- **Mutates**: `self.last_node_states`, `self.last_node_times`, `self.override_until` (clears expired), `self.advance_history` (marks expired as cancelled), groups data (migrates missing `enabled` field)
- **Calls**: `self.storage.async_get_settings`, `self.storage.async_get_groups`, `self.storage.async_get_group_schedule`, `self.storage._time_to_minutes`, `self.storage.get_active_node`, `self.storage.async_save`, `self.storage.async_save_advance_history`, `self.hass.services.async_call` (turn_off, set_hvac_mode, set_temperature, set_fan_mode, set_swing_mode, set_preset_mode), `self.hass.bus.async_fire`, `dt_util.now`
- **Called by**: HA DataUpdateCoordinator framework (periodic refresh)
- **Edge cases**:
  - **Day-boundary carryover (lines 676-703)**: In `individual` or `5/2` mode, if current time is before first node of today, prepends yesterday's last node as a carryover with `"time": "00:00"` and `"_from_previous_day": True`. Only the *last* node of the previous day is carried over.
  - **Virtual groups (lines 708-800)**: Groups with zero entities fire events only (no climate service calls). Virtual group keys are prefixed `_virtual_{group_name}`.
  - **Override expiry (lines 812-836)**: Expired overrides are detected and removed during the update cycle; the most recent uncompleted advance history entry is marked with `cancelled_at`.
  - **NO_CHANGE temperature (lines 861-936)**: If `noChange` flag is set, `clamped_temp` becomes `None`. For re-application, reads entity's current `temperature` attribute; for range entities (heat_cool/auto), reads `target_temp_high`/`target_temp_low` and skips temp.
  - **Re-application loop guard (lines 888-903)**: Skips applying settings if `last_node_states` matches the current node signature AND `last_node_times` matches node time. First run always applies.
  - **Apply order (lines 957-1081)**: `off` mode: `turn_off` → fallback `set_hvac_mode("off")` → temperature. Non-off: `set_hvac_mode` → `set_temperature` → `set_fan_mode` → `set_swing_mode` → `set_preset_mode`.
  - **Event fire condition (lines 1083-1115)**: Events only fired when `node_time_changed` is True; NOT on state-only changes (user edits) or first run.
  - **Group migration (lines 653-657)**: Adds missing `enabled` field to group data during update cycle.
  - **Clamping (lines 858-873)**: Temperature clamped to `[min_temp, max_temp]` ranges from settings BEFORE creating signature, preventing infinite update loops from unclamped-vs-clamped mismatch.
- **Test coverage**: Partially tested (main paths covered; day-boundary carryover and virtual groups may be undertested)

### _check_workday_integration(line 115)
- **Signature**: `def _check_workday_integration(self) -> bool`
- **Contract**: Checks HA state registry for `binary_sensor.workday_sensor`; caches result in `self._workday_available`. Returns cached value on subsequent calls.
- **Mutates**: `self._workday_available`
- **Calls**: `self.hass.states.get`
- **Called by**: `async_config_entry_first_refresh`, `is_workday_available`
- **Edge cases**: If sensor missing, caches `False` permanently (no re-check on sensor addition after startup).
- **Test coverage**: Partially tested

### advance_group_to_next_node(line 540)
- **Signature**: `async advance_group_to_next_node(self, group_name: str) -> Dict[str, Any]`
- **Contract**: Advances every entity in a group by calling `advance_to_next_node` per entity. Records a group-level advance history entry using the first successful entity's data. Mirrors override_until for the group_name. Returns aggregate success/error counts.
- **Mutates**: `self.advance_history[group_name]`, `self.override_until[group_name]`, plus per-entity state from `advance_to_next_node`
- **Calls**: `self.storage.async_get_groups`, `self.advance_to_next_node`, `self.storage.async_save_advance_history`
- **Called by**: `async_advance_group` (service wrapper)
- **Edge cases**:
  - Disabled or non-existent groups return error.
  - If no entities in group, returns error.
  - Group-level history/override uses first successful entity's data — if different entities advance to different nodes (different schedules), group-level record reflects only the first.
  - Errors on individual entities don't stop other entities from advancing.
- **Test coverage**: Partially tested

### advance_to_next_node(line 187)
- **Signature**: `async advance_to_next_node(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Manually advances entity to the next scheduled node after current time. Sets override_until to prevent auto-revert until next node's scheduled time. Creates node signature and updates last_node_states. Fires `climate_scheduler_node_activated` event with `trigger_type: "manual_advance"`. Returns success dict with next_node, next_node_day, applied_temp.
- **Mutates**: `self.override_until[entity_id]`, `self.advance_history[entity_id]`, `self.last_node_states[entity_id]`
- **Calls**: `self.storage.async_get_settings`, `self.storage.async_get_groups`, `self.storage.async_get_group_schedule`, `self.hass.services.async_call` (turn_off, set_hvac_mode, set_temperature, set_fan_mode, set_swing_mode, set_preset_mode), `self.hass.bus.async_fire`, `self.storage.async_save_advance_history`, `dt_util.now`
- **Called by**: `async_advance_schedule` (service wrapper), `advance_group_to_next_node`
- **Edge cases**:
  - **Day-boundary wrap (lines 254-278)**: Scans today's nodes first (by ascending time > current_minutes). If none found, wraps to tomorrow (next day) for `individual`/`5/2` modes, fetching tomorrow's first node. Fallback wraps to today's first node with `next_node_day = next_day` even if same-day schedule reused.
  - **Override time calculation (lines 287-292)**: `override_until` set to next node's HH:MM today. If that time is ≤ now, adds `timedelta(days=1)` — covers cross-midnight advance.
  - **Fan/swing/preset only applied when `is_no_change` is True AND `clamped_temp is None` (lines 408-433)** — these fall inside the `else` branch of the NO_CHANGE check, meaning they are applied when temperature is NOT being set due to NO_CHANGE. **BUG**: When temperature IS applied (non-NO_CHANGE), fan/swing/preset are NOT applied in this method. See Known Bugs.
  - **Off mode apply (lines 354-371)**: Tries `turn_off` first, falls back to `set_hvac_mode("off")`.
  - **Set_temperature failure handling (lines 395-402)**: If temp set fails and target_hvac_mode is "off", logs warning only; otherwise returns error.
  - **Entity not in any enabled/non-ignored group (line 223-227)**: Returns error.
  - **Preset-only entities (line 349/383-404)**: Temperature change skipped.
- **Test coverage**: Partially tested (day-boundary wrap and NO_CHANGE paths likely undertested)

### async_advance_group(line 27)
- **Signature**: `async async_advance_group(self, group_name: str) -> Dict[str, Any]`
- **Contract**: Backwards-compatible service wrapper; delegates to `advance_group_to_next_node`.
- **Mutates**: None (delegates)
- **Calls**: `self.advance_group_to_next_node`
- **Called by**: Service registration
- **Edge cases**: None
- **Test coverage**: Delegated

### async_advance_schedule(line 23)
- **Signature**: `async async_advance_schedule(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Backwards-compatible service wrapper; delegates to `advance_to_next_node`.
- **Mutates**: None (delegates)
- **Calls**: `self.advance_to_next_node`
- **Called by**: Service registration
- **Edge cases**: None
- **Test coverage**: Delegated

### async_cancel_advance(line 31)
- **Signature**: `async async_cancel_advance(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Backwards-compatible service wrapper; delegates to `cancel_advance`.
- **Mutates**: None (delegates)
- **Calls**: `self.cancel_advance`
- **Called by**: Service registration
- **Edge cases**: None
- **Test coverage**: Delegated

### async_config_entry_first_refresh(line 105)
- **Signature**: `async async_config_entry_first_refresh(self) -> None`
- **Contract**: Loads advance history from storage, checks workday integration, then delegates to parent first refresh.
- **Mutates**: `self.advance_history`
- **Calls**: `self.storage.async_get_advance_history`, `self._check_workday_integration`, `super().async_config_entry_first_refresh`
- **Called by**: HA config entry setup
- **Edge cases**: If storage load fails, advance_history remains empty (no error handling on storage read failure — exception propagates).
- **Test coverage**: Partially tested

### async_get_advance_status(line 35)
- **Signature**: `async async_get_advance_status(self, entity_id: str) -> dict`
- **Contract**: Returns advance override status for an entity or group schedule_id. For groups, aggregates member override_until to find the latest; for entities, checks own override and last advance history entry. Returns dict with entity_id, is_advanced, advance_time, original_node, advanced_node.
- **Mutates**: None (read-only)
- **Calls**: `self.storage.async_get_group`, `dt_util.now`
- **Called by**: Service / sensor platform
- **Edge cases**:
  - For groups, `original_node` and `advanced_node` are always `None` — not aggregated from members.
  - Uses `self.advance_history[entity_id][-1]` for entity path — assumes list is non-empty, but history could be empty if all entries pruned.
- **Test coverage**: Partially tested

### cancel_advance(line 470)
- **Signature**: `async cancel_advance(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Cancels active advance override. Supports both entity_id and group schedule_id. For groups, cancels all members plus group-level entry. Clears last_node_state to force immediate re-evaluation. Saves history. Triggers refresh.
- **Mutates**: `self.advance_history`, `self.override_until`, `self.last_node_states`
- **Calls**: `self.storage.async_get_group`, `self.storage.async_save_advance_history`, `self.async_request_refresh`
- **Called by**: `async_cancel_advance` (service wrapper)
- **Edge cases**:
  - If entity has no advance history, still proceeds (logs warning, clears override/last_node_state if present).
  - Group path: also cancels group-level entry (`_cancel_single(entity_id)` called with group_name).
  - Marks most recent history entry as cancelled only if `cancelled_at is None`.
- **Test coverage**: Partially tested

### clear_advance_history(line 513)
- **Signature**: `async clear_advance_history(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Deletes all advance history for an entity from in-memory dict and persists to storage.
- **Mutates**: `self.advance_history`
- **Calls**: `self.storage.async_save_advance_history`
- **Called by**: Service
- **Edge cases**: Silent no-op if entity has no history.
- **Test coverage**: Partially tested

### force_update_all(line 178)
- **Signature**: `async force_update_all(self) -> None`
- **Contract**: Clears all last_node_states and last_node_times, then requests immediate refresh, forcing every entity to be re-evaluated and settings reapplied.
- **Mutates**: `self.last_node_states`, `self.last_node_times`
- **Calls**: `self.async_request_refresh`
- **Called by**: Service / UI
- **Edge cases**: Clears ALL entities, not scoped to a single entity or group.
- **Test coverage**: Partially tested

### get_advance_history(line 525)
- **Signature**: `def get_advance_history(self, entity_id: str, hours: int = 24) -> List[Dict[str, Any]]`
- **Contract**: Returns advance events within the last N hours for an entity. Filters by `activated_at` timestamp.
- **Mutates**: None (read-only)
- **Calls**: `dt_util.now`, `datetime.fromisoformat`
- **Called by**: Service / UI
- **Edge cases**:
  - Uses `datetime.fromisoformat` (naive datetime) without timezone — may produce incorrect comparisons if storage contains timezone-aware ISO strings.
  - `hours` defaults to 24.
- **Test coverage**: Untested

### get_override_status(line 619)
- **Signature**: `def get_override_status(self, entity_id: str) -> Dict[str, Any]`
- **Contract**: Returns whether entity has an active (non-expired) override. Checks `override_until > now`.
- **Mutates**: None (read-only)
- **Calls**: `dt_util.now`
- **Called by**: Service / sensor platform
- **Edge cases**: If override time has passed but not yet cleaned up, returns `has_override: False` (correct).
- **Test coverage**: Untested

### get_workdays(line 146)
- **Signature**: `async get_workdays(self) -> List[str]`
- **Contract**: Returns list of workday abbreviations from settings; falls back to DEFAULT_WORKDAYS on error or invalid data.
- **Mutates**: None (read-only)
- **Calls**: `self.storage.async_get_settings`
- **Called by**: `is_workday`
- **Edge cases**: Validates that workdays is a non-empty list; falls back to defaults.
- **Test coverage**: Partially tested

### is_workday(line 160)
- **Signature**: `async is_workday(self, day: str) -> bool`
- **Contract**: Returns whether a 3-letter day abbreviation is configured as a workday.
- **Mutates**: None (read-only)
- **Calls**: `self.get_workdays`
- **Called by**: External (storage, services)
- **Edge cases**: Case-insensitive comparison.
- **Test coverage**: Partially tested

### is_workday_available(line 172)
- **Signature**: `def is_workday_available(self) -> bool`
- **Contract**: Returns cached workday integration availability. Triggers check if not yet cached.
- **Mutates**: `self._workday_available` (lazily)
- **Calls**: `self._check_workday_integration`
- **Called by**: `is_workday_enabled`
- **Edge cases**: Returns `False` if `_workday_available` is `None` and check fails (line 176: `self._workday_available or False`).
- **Test coverage**: Partially tested

### is_workday_enabled(line 131)
- **Signature**: `async is_workday_enabled(self) -> bool`
- **Contract**: Returns True only when workday integration is available AND user has enabled it in settings.
- **Mutates**: None (read-only)
- **Calls**: `self.is_workday_available`, `self.storage.async_get_settings`
- **Called by**: Storage (schedule resolution)
- **Edge cases**: Catches and logs all exceptions, returning False.
- **Test coverage**: Partially tested

## Invariants

### Proven
1. **Apply order is HVAC mode first, then temperature** (lines 957-1002). Off mode: turn_off first, then attempt temperature (lines 960-985).
2. **Re-application loops avoided via last-state signatures**: The coordinator checks `last_node_states` (signature dict) AND `last_node_times` against current node; if both match, settings are not re-applied (lines 888-903).
3. **Clamping before signature**: Temperature is clamped to `[min_temp, max_temp]` BEFORE the node signature is created, preventing infinite loops from clamping drift (lines 858-882).
4. **Override blocks scheduled updates**: While `override_until[entity] > now`, `_async_update_data` skips the entity entirely (lines 812-820).
5. **Events only fire on time transitions**: `node_time_changed` gates event emission in `_async_update_data` (lines 1083-1115). State-only changes (user edits) and first run do NOT fire events.
6. **Manual advance always fires event**: `advance_to_next_node` always fires `climate_scheduler_node_activated` with `trigger_type: "manual_advance"` (lines 435-461).

### Assumed
1. **Workday sensor availability is static after first check**: `_check_workday_integration` caches result and never re-checks. If workday integration is added after coordinator startup, it won't be detected.
2. **`storage._time_to_minutes` is reliable**: The coordinator calls `self.storage._time_to_minutes` (a private method of storage) for node time conversion (line 678, 680, 696). This is a cross-module coupling to an internal method.
3. **`storage.get_active_node` correctly resolves the active node for a given time and sorted node list**: The coordinator delegates active-node resolution entirely to storage.

## Contract Connections

| CONTRACTS.md Section | How coordinator.py enforces it |
|---|---|
| **Node Contract** — noChange means skip temperature apply but allow mode application | Lines 861-936: `is_no_change` flag causes `clamped_temp = None`; modes still applied. Line 918-936: `temp_to_apply` set from entity's current temperature for re-application; modes applied separately. |
| **Node Contract** — Mode no-change = omitted node fields | Coordinator uses `.get()` for all mode fields, naturally skipping omitted keys (lines 958-1081). |
| **Schedule Contract** — schedule_mode: all_days / 5/2 / individual | Used to determine day-specific schedule fetching and carryover logic (lines 673-703, 242-278). |
| **Coordinator Apply Order** — HVAC mode before temperature | Enforced in both `_async_update_data` (lines 957-1001) and `advance_to_next_node` (lines 352-406). Off: turn_off → attempt temp. Non-off: set_hvac_mode → set_temperature. |
| **Event Contract** — `climate_scheduler_node_activated` payload | Fired from three paths: scheduled (line 1090), manual advance (line 439), with `trigger_type` differentiator. Payload includes entities, group_name, node, day, trigger_type. Deprecated `entity_id` field still present (lines 443, 1094). |
| **Event Contract** — For manual advance wrap-around, `day` reflects target-node day | Line 457: `next_node_day` is set during day-boundary wrap logic (lines 262-278) and passed in event payload. |

## Known Bugs / Gaps

1. **Fan/swing/preset NOT applied during non-NO_CHANGE advance (lines 408-433)**: In `advance_to_next_node`, the fan_mode, swing_mode, and preset_mode service calls are nested inside the `else` branch of the NO_CHANGE check at line 406 (the `else: _LOGGER.info(f"Skipping temperature change... (NO_CHANGE set)")` block). This means these modes are ONLY applied when temperature is NO_CHANGE. When temperature IS set (non-NO_CHANGE), the code jumps from line 394 to past line 434, skipping fan/swing/preset application entirely. **This is a confirmed bug** — compare with `_async_update_data` where modes are always applied after temperature (lines 1038-1081).

2. **Cross-module coupling to private method**: `self.storage._time_to_minutes` is called at lines 678, 680, 696. This references a private method of the storage module, violating encapsulation. If storage renames or changes this method, coordinator breaks silently.

3. **Naive datetime in `get_advance_history`**: Line 534 uses `datetime.fromisoformat(event["activated_at"])`, producing a naive datetime. If `dt_util.now()` returns timezone-aware datetimes (which it does in HA), the comparison at line 535 may produce incorrect results due to tz-naive vs tz-aware mismatch.

4. **Workday integration not re-detected**: `_check_workday_integration` caches availability once and never re-checks. Adding the workday integration after coordinator startup requires a restart.

5. **Group-level advance history uses first-successful-entity data**: In `advance_group_to_next_node` (lines 592-602), the group-level advance history is recorded using only the first successful entity's `next_node`. If group members have different schedules (unlikely but possible with different schedule modes), the group record is misleading.

6. **Duplicate schedule data check (lines 229-233)**: After already checking `if not schedule_data` at line 223, the code re-checks `if not schedule_data or "nodes" not in schedule_data` at line 229. The first check returns on falsy schedule_data; the second check is partially redundant — it would only add the "nodes" check. Not a bug, but dead code path for the `not schedule_data` clause.

7. **`advance_history` entity list assumes non-empty (line 72-73)**: `async_get_advance_status` at line 71-75 does `self.advance_history.get(entity_id, [])` but then accesses `history[-1]` only after `if history:` — this is safe. However, `cancelled_at` field is set by `cancel_advance` only on the last entry — if `clear_advance_history` was called and history re-built, there may be un-cancellable orphan entries.

8. **Carryover node time set to "00:00" (line 701)**: When carrying over yesterday's last node, the time is overwritten to "00:00" with `_from_previous_day: True`. If `get_active_node` uses time for comparison, this carryover node is always active from midnight until the first real node. This is correct behavior but the `_from_previous_day` flag is not used anywhere downstream — it's informational only.

9. **`node_signature` in `advance_to_next_node` does NOT include node time (lines 322-328)**: Unlike `_async_update_data` which tracks both `last_node_states` (signature) and `last_node_times` separately, `advance_to_next_node` only updates `last_node_states` (not `last_node_times`). This means the subsequent `_async_update_data` cycle will see `last_node_time != node_time` and re-apply settings, which is likely intentional (forces re-evaluation after manual advance) but could cause a redundant apply.

10. **`set_temperature` error handling inconsistency**: In `advance_to_next_node` (lines 395-402), a set_temperature failure for non-off mode returns an error dict and aborts. In `_async_update_data` (lines 1020-1032), the same failure logs an error and stores in results, then continues. The manual advance path is stricter — it returns immediately, potentially leaving the entity with HVAC mode set but temperature not applied.

## Cross-Module Dependencies

| Module | Dependency | Nature |
|---|---|---|
| `const.py` | `DOMAIN`, `MIN_TEMP`, `MAX_TEMP`, `NO_CHANGE_TEMP`, `SETTING_USE_WORKDAY`, `SETTING_WORKDAYS`, `DEFAULT_WORKDAYS` | Constants |
| `storage.py` | `ScheduleStorage.async_get_settings`, `async_get_groups`, `async_get_group_schedule`, `async_get_advance_history`, `async_save_advance_history`, `async_save`, `get_active_node`, `_time_to_minutes` (private) | Core data layer — strongly coupled |
| `homeassistant.core` | `HomeAssistant` | HA framework |
| `homeassistant.helpers.update_coordinator` | `DataUpdateCoordinator`, `UpdateFailed` | HA framework base class |
| `homeassistant.const` | `ATTR_TEMPERATURE` | HA constant |
| `homeassistant.util.dt` | `dt_util.now()`, `dt_util.now` | HA timezone-aware datetime |
| `datetime` (stdlib) | `datetime`, `timedelta` | Time arithmetic |