# KNOWLEDGE: switch.py

## Purpose
Implements the Switch platform for the Climate Scheduler integration. Exposes each schedule group as a SwitchEntity compatible with the scheduler-component format, providing attributes like `next_trigger`, `next_slot`, `actions`, and `weekdays` that external scheduler UIs can consume. The switch on/off state mirrors whether the group's schedule is enabled or disabled.

## Key Functions (alphabetical)

### ClimateSchedulerSwitch.__init__(hass, coordinator, storage, group_name, group_data) (line 80)
- **Signature**: `def __init__(self, hass: HomeAssistant, coordinator, storage, group_name: str, group_data: Dict[str, Any]) -> None`
- **Contract**: Initializes the switch with a stable 6-character hex token derived from `md5(group_name)`. For single-entity groups (prefixed `__entity_`), derives a cleaner name from the entity ID. Sets `should_poll = True` and initializes cached schedule attribute fields.
- **Mutates**: Sets `_attr_name`, `_attr_unique_id`, `_attr_has_entity_name`, `_attr_should_poll`, and cache fields.
- **Calls**: `hashlib.md5()`, `super().__init__(coordinator)`.
- **Called by**: `async_setup_entry()`.
- **Edge cases**:
  - The MD5 token (line 96) provides uniqueness but isn't crypto — just a stable hash. Two groups with identical names would collide, but `group_name` should be unique by contract.
  - `self._attr_should_poll = True` (line 108) — unusual for a `CoordinatorEntity`; polling is normally unnecessary since coordinator pushes updates.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch.async_turn_off(**kwargs) (line 406)
- **Signature**: `async def async_turn_off(self, **kwargs: Any) -> None`
- **Contract**: Disables the schedule via `storage.async_disable_schedule()`, requests coordinator refresh, and writes HA state.
- **Mutates**: Group enabled state in storage, HA state.
- **Calls**: `self.storage.async_disable_schedule()`, `self.coordinator.async_request_refresh()`, `self.async_write_ha_state()`.
- **Called by**: HA UI (switch toggle), services.
- **Edge cases**: None significant.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch.async_turn_on(**kwargs) (line 400)
- **Signature**: `async def async_turn_on(self, **kwargs: Any) -> None`
- **Contract**: Enables the schedule via `storage.async_enable_schedule()`, requests coordinator refresh, and writes HA state.
- **Mutates**: Group enabled state in storage, HA state.
- **Calls**: `self.storage.async_enable_schedule()`, `self.coordinator.async_request_refresh()`, `self.async_write_ha_state()`.
- **Called by**: HA UI (switch toggle), services.
- **Edge cases**: None significant.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch._async_refresh_group_data() (line 196)
- **Signature**: `async def _async_refresh_group_data(self) -> None`
- **Contract**: Fetches fresh group data from storage and updates `self._group_data` if found. Called asynchronously from `_handle_coordinator_update`.
- **Mutates**: `self._group_data`.
- **Calls**: `self.storage.async_get_group()`.
- **Called by**: `_handle_coordinator_update()`.
- **Edge cases**: If `async_get_group` returns `None`, `self._group_data` is not updated — stale data persists.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch._compute_schedule_attributes() (line 202)
- **Signature**: `def _compute_schedule_attributes(self) -> None`
- **Contract**: Computes `next_trigger`, `next_slot`, `actions`, and `next_entries` from the active profile's schedule. Handles all_days, 5/2, and individual schedule modes. For 5/2 and individual modes, finds next node after current time; if none found today, wraps to first node tomorrow. Builds action lists per node (climate.set_temperature service calls for each entity). Builds `next_entries` with absolute ISO datetimes.
- **Mutates**: `_cached_next_trigger`, `_cached_next_slot`, `_cached_actions`, `_cached_next_entries`.
- **Calls**: `self._get_schedule_for_day()`, `self._time_str_to_minutes()`.
- **Called by**: `extra_state_attributes` property.
- **Edge cases**:
  - Lines 247–249: When wrapping to tomorrow, sets base datetime to midnight + 1 day but then re-replaces with node time on line 256. The `next_trigger_dt` is first set to tomorrow midnight (line 247) then corrected with the actual node time (line 256). If the time parsing fails (line 257), `next_trigger_dt` stays at midnight tomorrow — potentially wrong.
  - Lines 268–270: If entities list is empty and group name starts with `__entity_`, derives entity from group name. This is a fallback for single-entity groups.
  - Lines 277–295: When entities is empty, creates actions with `entity_id: "unknown"` — consumed by scheduler-component UI which expects real entity IDs.
  - Lines 306–314: When a node has `preset_mode`, the action `service` is changed to `climate.set_preset_mode` and `data` is overwritten (losing the temperature). This means both temperature AND preset_mode can't be set in the same node action — a limitation.
  - Schedule data is read from `self._group_data["profiles"][active_profile]`, not the top-level `schedules` key. This is the profile-aware access path.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch._get_schedule_for_day(schedules, schedule_mode, current_day) (line 361)
- **Signature**: `def _get_schedule_for_day(self, schedules: Dict[str, List[Dict[str, Any]]], schedule_mode: str, current_day: str) -> List[Dict[str, Any]]`
- **Contract**: Returns the schedule node list for the current day based on schedule mode. `all_days` → `schedules["all_days"]`, `5/2` → weekday/weekend, `individual` → day-specific. Falls back to `all_days` for unknown modes.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `_compute_schedule_attributes()`.
- **Edge cases**: Unknown schedule modes fall through to `all_days` — silent failover.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch._get_weekdays_list(schedule_mode) (line 380)
- **Signature**: `def _get_weekdays_list(self, schedule_mode: str) -> List[str]`
- **Contract**: Converts internal schedule mode to scheduler-component compatible weekdays list. `all_days` → `["daily"]`, `5/2` → `["workday", "weekend"]`, `individual` → all 7 day abbreviations.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `extra_state_attributes`.
- **Edge cases**: Returns `["daily"]` for unknown modes — same failover as `_get_schedule_for_day`.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch._handle_coordinator_update() (line 188)
- **Signature**: `@callback def _handle_coordinator_update(self) -> None`
- **Contract**: On coordinator update, schedules async refresh of group data and writes HA state. Uses `loop.create_task()` if event loop is running.
- **Mutates**: None directly; `_async_refresh_group_data()` mutates `_group_data`.
- **Calls**: `self.hass.loop.create_task()`, `self._async_refresh_group_data()`, `self.async_write_ha_state()`.
- **Called by**: Coordinator update notification.
- **Edge cases**:
  - Line 192: Checks `loop.is_running()` — if loop isn't running, refresh task won't be created. State write still happens, potentially with stale data.
  - Fire-and-forget task: If `_async_refresh_group_data` raises, exception is logged by the event loop but not handled here.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch._refresh_group_data() (line 178)
- **Signature**: `def _refresh_group_data(self) -> None`
- **Contract**: Intended to refresh group data from storage. However, detects that `storage.async_get_group` is async and cannot be called from a sync property. Currently a no-op (passes silently).
- **Mutates**: None (intentionally does nothing).
- **Calls**: `asyncio.iscoroutinefunction()` (check only).
- **Called by**: `is_on`, `extra_state_attributes`.
- **Edge cases**: This is a stub — group data is only refreshed on coordinator updates, not on property access. If properties are read between coordinator updates, they use stale `_group_data`.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch._time_str_to_minutes(time_str) (line 391)
- **Signature**: `@staticmethod def _time_str_to_minutes(time_str: str) -> int`
- **Contract**: Converts "HH:MM" string to minutes since midnight. Returns 0 on parse failure.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `_compute_schedule_attributes()`.
- **Edge cases**: Invalid time strings like "25:00" would produce 1500 minutes — no range validation. Empty string or None → 0 (via `AttributeError` catch).
- **Test coverage**: Untested.

### ClimateSchedulerSwitch.device_info (property, line 412)
- **Signature**: `@property def device_info(self) -> Dict[str, Any]`
- **Contract**: Returns device info linking the switch to a per-group device. Uses `(DOMAIN, f"scheduler_{group_name}")` as device identifier.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: HA device registry.
- **Edge cases**: Each switch gets its own device (different from climate.py which uses a single shared device). This creates multiple devices in HA, one per group.
- **Test coverage**: Untested.

### ClimateSchedulerSwitch.extra_state_attributes (property, line 140)
- **Signature**: `@property def extra_state_attributes(self) -> Dict[str, Any]`
- **Contract**: Returns scheduler-component compatible attributes: `next_trigger`, `next_slot`, `actions`, `next_entries`, plus metadata (`schedule_mode`, `schedules`, `active_profile`, `profiles`, `entities`, `weekdays`, `timeslots`). Calls `_refresh_group_data()` (no-op) and `_compute_schedule_attributes()` on every access.
- **Mutates**: Cache fields via `_compute_schedule_attributes()`.
- **Calls**: `self._refresh_group_data()`, `self._compute_schedule_attributes()`, `self._get_weekdays_list()`.
- **Called by**: HA state machine.
- **Edge cases**:
  - Recomputes schedule attributes on every state read — no caching between reads. If called frequently, this is wasteful since `_compute_schedule_attributes` does time arithmetic and list building.
  - Returns raw `schedules` dict — could expose internal data structure to consumers.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch.is_on (property, line 117)
- **Signature**: `@property def is_on(self) -> bool`
- **Contract**: Returns `True` if the group's schedule is enabled. Calls `_refresh_group_data()` (no-op), so uses cached/stale data.
- **Mutates**: None.
- **Calls**: `self._refresh_group_data()`.
- **Called by**: HA switch state, `state` property.
- **Edge cases**: Depends on stale `_group_data` between coordinator updates.
- **Test coverage**: Partially tested.

### ClimateSchedulerSwitch.state (property, line 124)
- **Signature**: `@property def state(self) -> str`
- **Contract**: Returns "off" if disabled, "on" if enabled. Comment mentions a "triggered" state that's not yet implemented.
- **Mutates**: None.
- **Calls**: `self.is_on`.
- **Called by**: HA state machine.
- **Edge cases**: "triggered" state mentioned in docstring (line 131) but not implemented — always "on" or "off".
- **Test coverage**: Partially tested.

### async_setup_entry(hass, config_entry, async_add_entities) (line 19)
- **Signature**: `async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None`
- **Contract**: Creates one switch per non-ignored group. Before creating switches, cleans up old switch entities from before the unique_id token was added (pre-migration entities without 6-char hex suffix).
- **Mutates**: Entity registry (removes old entities), adds new switch entities.
- **Calls**: `er.async_get()`, `entity_registry.async_remove()`, `storage.async_get_groups()`, `async_add_entities()`.
- **Called by**: HA platform setup (forwarded by `__init__.py`).
- **Edge cases**:
  - Old entity cleanup (lines 33–51): Checks if unique_id ends with a 6-char hex token. If not, removes the entity from the registry. This migration runs on every setup — benign but redundant after first migration.
  - Line 47: `len(last_part) != 6 or not all(c in "0123456789abcdef" for c in last_part.lower())` — token validation: must be exactly 6 lowercase hex chars. Group names ending in a 6-letter hex-looking string could be falsely identified as new-format and not cleaned up.
  - Line 61: Skips groups with `ignored: True` flag — but this is a group-level ignored flag, different from entity-level `async_is_ignored`.
- **Test coverage**: Partially tested.

## Invariants
1. **One switch per non-ignored group**: Every group (including single-entity groups) gets a switch, unless the group is flagged as ignored. (Proven by `async_setup_entry`.)
2. **Stable unique_id with MD5 token**: `unique_id = f"{DOMAIN}_schedule_{group_name}_{md5_token}"` ensures stability across restarts despite group name changes. (Assumed; MD5 of group name is deterministic.)
3. **Switch state mirrors schedule enabled**: `is_on` returns group `enabled` flag. (Proven by `is_on` property.)
4. **Schedule attributes computed on read**: Every `extra_state_attributes` access recomputes from current time. No stale-cached attribute read. (Proven by `_compute_schedule_attributes` call in property.)

## Contract Connections
- **C-SCHEDULER-COMPAT**: Attributes format follows scheduler-component conventions (`next_trigger`, `next_slot`, `actions`, `weekdays`, `timeslots`).
- **C-SWITCH-ENABLE-DISABLE**: Turning the switch on/off calls `storage.async_enable_schedule`/`async_disable_schedule` and triggers coordinator refresh.
- **C-GROUP-IGNORED**: Groups with `ignored: True` are skipped during entity creation.

## Known Bugs / Gaps
1. **`_refresh_group_data` is a no-op**: The method intentionally does nothing because `async_get_group` is async but it's called from sync properties. Data is only refreshed on coordinator updates — stale reads between updates.
2. **`preset_mode` overwrites temperature action** (lines 310–313): A node with both `temp` and `preset_mode` will only set the preset, losing the temperature. Both should be settable in one node.
3. **Hard-coded `sw_version: "1.0"`** (line 420): Device info never updates with actual integration version.
4. **Per-group device vs climate's shared device**: Switch entities create separate devices per group, while climate entities share one device. This splits the device hierarchy in HA's UI.
5. **No "triggered" state**: The `state` property docstring mentions a "triggered" state that's never implemented.
6. **Duplicated schedule mode logic**: `_get_schedule_for_day` and `_get_weekdays_list` repeat logic also in `_compute_schedule_attributes`, `climate.py`, and likely `coordinator.py`. No shared utility.
7. **_time_str_to_minutes has no range validation**: "25:00" would produce 1500 minutes — no error.

## Cross-Module Dependencies
- **Imports from**: `.const` (DOMAIN), `homeassistant.components.switch.SwitchEntity`, `homeassistant.config_entries`, `homeassistant.core`, `homeassistant.helpers.entity_platform`, `homeassistant.helpers.update_coordinator`, `homeassistant.util.dt`, `hashlib`, `datetime`
- **Imported by**: Home Assistant switch platform (forwarded by `__init__.py`)
- **Depends on**: `storage` (via `hass.data[DOMAIN]`), `coordinator` (via `hass.data[DOMAIN]`), `entity_registry` (for migration cleanup)