# KNOWLEDGE: climate.py

## Purpose
Implements the Climate entity platform for the Climate Scheduler integration. Each schedule group (single-entity or multi-entity) is exposed as a `ClimateEntity` that aggregates member states, shows the scheduled setpoint as target temperature, and allows the user to change temperature/mode/profile from HA's climate card UI.

## Key Functions (alphabetical)

### ClimateSchedulerGroupEntity.__init__(coordinator, storage, group_name, group_data) (line 89)
- **Signature**: `def __init__(self, coordinator: HeatingSchedulerCoordinator, storage: ScheduleStorage, group_name: str, group_data: Dict[str, Any]) -> None`
- **Contract**: Initializes the climate entity with group metadata, member entity list, profiles/presets, enabled state, and temperature bounds. Sets `unique_id` from `group_name` (lowered, spaces→underscores). Default HVAC mode is AUTO if enabled, OFF if disabled.
- **Mutates**: Sets all `_attr_*` fields on self.
- **Calls**: `super().__init__(coordinator)` (CoordinatorEntity).
- **Called by**: `async_setup_entry()`.
- **Edge cases**:
  - `_attr_min_temp = 5.0, _attr_max_temp = 35.0` — does NOT import MIN_TEMP/MAX_TEMP from `const.py` (which is 30.0 for max). Mismatch: climate card allows up to 35°C but const says 30°C.
  - `_attr_target_temp_step = 0.5` is a default; overridden in `async_added_to_hass` from first member entity if available.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.async_added_to_hass() (line 143)
- **Signature**: `async def async_added_to_hass(self) -> None`
- **Contract**: Called when entity is added to HA. Sets temperature unit from system config (`self.hass.config.units.temperature_unit`), copies `target_temp_step` from first member entity, and performs initial state update via `_update_state()`.
- **Mutates**: `_attr_temperature_unit`, `_attr_target_temp_step`, state attributes.
- **Calls**: `super().async_added_to_hass()`, `self.hass.states.get()`, `self._update_state()`.
- **Called by**: Home Assistant entity lifecycle.
- **Edge cases**:
  - If `_member_entities` is empty, skips temp step lookup — keeps default 0.5.
  - If first member entity has no state in HA, `first_member` is None and step stays 0.5.
- **Test coverage**: Untested.

### ClimateSchedulerGroupEntity.async_set_hvac_mode(hvac_mode) (line 441)
- **Signature**: `async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None`
- **Contract**: Sets the group to AUTO (active/schedule-following) or OFF (idle). Logs warning for unsupported modes. Delegates to `async_turn_on()` / `async_turn_off()`.
- **Mutates**: `_enabled`, HVAC mode, member entity states.
- **Calls**: `self.async_turn_off()`, `self.async_turn_on()`.
- **Called by**: Home Assistant climate UI.
- **Edge cases**: Unsupported modes (HEAT, COOL, etc.) are silently rejected with a warning log.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.async_set_preset_mode(preset_mode) (line 452)
- **Signature**: `async def async_set_preset_mode(self, preset_mode: str) -> None`
- **Contract**: Switches the active profile for the group. Calls storage to persist, then forces a coordinator refresh. If the profile doesn't exist, storage raises `ValueError` which is caught and logged.
- **Mutates**: Active profile in storage, triggers coordinator refresh.
- **Calls**: `self._storage.async_set_active_profile()`, `self.coordinator.async_request_refresh()`.
- **Called by**: Home Assistant climate UI (preset mode selector).
- **Edge cases**: If `async_set_active_profile` raises `ValueError`, function returns early without refreshing coordinator — schedule stays on old profile.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.async_set_temperature(**kwargs) (line 373)
- **Signature**: `async def async_set_temperature(self, **kwargs) -> None`
- **Contract**: Sets a manual temperature override for all member entities by calling `climate.set_temperature` service on each. Calculates override expiry at next schedule node time and stores it in `coordinator.override_until`. Updates target temperature immediately, then schedules a delayed state update after 2s.
- **Mutates**: Member entity temperatures, `coordinator.override_until[entity_id]`, `_attr_target_temperature`.
- **Calls**: `hass.services.async_call("climate", "set_temperature", ...)`, `self._storage.get_next_node()`, `self._update_state()`, `self.async_write_ha_state()`.
- **Called by**: Home Assistant climate UI (temperature slider).
- **Edge cases**:
  - **Schedule access assumes old format** (lines 402–404): Accesses `schedules[current_day]["nodes"]` but `_update_state` uses `schedules[current_day]` as a list directly (no nested "nodes" key). This is likely a **bug** — `get_next_node` may receive wrong data shape or `schedule_data` may be None.
  - **Hardcoded `asyncio.sleep(2)`** (line 434) — fragile delay for member entities to react.
  - Override time calculation (lines 418–419): If next node is earlier today, adds 1 day — correct but doesn't account for crossing midnight in multi-day scenarios.
  - Uses `blocking=True` for service calls (line 390) — could be slow for large groups.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.async_turn_off() (line 474)
- **Signature**: `async def async_turn_off(self) -> None`
- **Contract**: Disables the schedule for all member entities via storage. Sets `_enabled = False`. Writes HA state.
- **Mutates**: `_enabled`, storage enabled flags for each member.
- **Calls**: `self._storage.async_set_enabled(entity_id, False)`, `self.async_write_ha_state()`.
- **Called by**: `async_set_hvac_mode()`, Home Assistant UI.
- **Edge cases**: If storage call fails for one entity, others still get disabled (no transaction rollback).
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.async_turn_on() (line 465)
- **Signature**: `async def async_turn_on(self) -> None`
- **Contract**: Enables the schedule for all member entities via storage. Sets `_enabled = True`. Writes HA state.
- **Mutates**: `_enabled`, storage enabled flags for each member.
- **Calls**: `self._storage.async_set_enabled(entity_id, True)`, `self.async_write_ha_state()`.
- **Called by**: `async_set_hvac_mode()`, Home Assistant UI.
- **Edge cases**: Same as `async_turn_off` — no atomicity.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity._handle_coordinator_update() (line 181)
- **Signature**: `@callback def _handle_coordinator_update(self) -> None`
- **Contract**: Called by CoordinatorEntity when coordinator data changes. Refreshes enabled state, profiles, preset modes, and HVAC mode from storage. Then calls `_update_state()` and writes HA state.
- **Mutates**: `_enabled`, `_attr_preset_modes`, `_attr_preset_mode`, `_attr_hvac_mode`, state attributes.
- **Calls**: `self._update_state()`, `self.async_write_ha_state()`.
- **Called by**: Home Assistant coordinator framework.
- **Edge cases**: Accesses `self._storage._data` directly (line 184) — breaks encapsulation; uses internal `_data` attribute of storage.
- **Test coverage**: Untested.

### ClimateSchedulerGroupEntity._map_hvac_mode(mode_str) (line 329)
- **Signature**: `def _map_hvac_mode(self, mode_str: str) -> HVACMode`
- **Contract**: Maps string HVAC mode names to `HVACMode` enum values. Defaults to `HVACMode.HEAT` for unknown modes.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: Currently unused — appears to be dead code. `_update_state` sets HVAC action directly, not via this mapper.
- **Edge cases**: The method exists but is never called in the current codebase.
- **Test coverage**: Untested.

### ClimateSchedulerGroupEntity._update_state() (line 195)
- **Signature**: `def _update_state(self) -> None`
- **Contract**: Synchronous state update. Computes: (1) average current temperature from member entities, (2) aggregate HVAC action (heating/cooling/idle/off), (3) target temperature from active schedule node or fallback to member average / 20°C default. Handles day-wraparound for 5/2 and individual schedule modes (carries over previous day's last node if before first node today).
- **Mutates**: `_attr_current_temperature`, `_member_temps`, `_attr_hvac_action`, `_attr_target_temperature`, `_active_node`, `_next_node`.
- **Calls**: `self.hass.states.get()`, `self._storage._data.get()`, `self._storage._time_to_minutes()`, `self._storage.get_active_node()`.
- **Called by**: `_handle_coordinator_update()`, `async_added_to_hass()`, `async_set_temperature()` (delayed).
- **Edge cases**:
  - Directly accesses `self._storage._data` (lines 246, 400) — breaks storage encapsulation.
  - Schedule mode logic (lines 251–259) duplicates logic in `switch.py` and likely `coordinator.py`.
  - Day wraparound (lines 263–288): If previous day has no nodes, no carryover happens — temperature setpoint may be `None` and fall to default 20°C.
  - Lines 326–327: Sets `self._active_node = None` and `self._next_node = None` at the end, making those always None — the active/next node info is never populated in `extra_state_attributes`. This is a **bug**: the computation on lines 292–298 finds `active_node` but it's a local variable, not assigned to `self._active_node`.
  - Temperature is stored in native unit (no conversion). The climate card will display in the system-configured unit.
- **Test coverage**: Partially tested.

### async_setup_entry(hass, config_entry, async_add_entities) (line 29)
- **Signature**: `async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None`
- **Contract**: Creates one `ClimateSchedulerGroupEntity` per group that has at least one entity. Normalizes the `_is_single_entity_group` flag if it's inconsistent with actual entity count. Skips virtual groups (0 entities). Saves normalized data to storage.
- **Mutates**: Group data in storage (`_is_single_entity_group` flag), adds entities to HA platform.
- **Calls**: `storage.async_get_groups()`, `storage.async_save()`, `async_add_entities()`.
- **Called by**: Home Assistant platform setup (forwarded by `__init__.py`).
- **Edge cases**:
  - Normalizes `_is_single_entity_group` based on entity count, not an explicit user setting. This auto-correction is logged but could surprise if the flag was intentionally set differently.
  - Line 80: `async_add_entities(entities, True)` — the `True` arg means `update_before_add`, which triggers an initial state update.
- **Test coverage**: Partially tested.

### ClimateSchedulerGroupEntity.extra_state_attributes (property, line 342)
- **Signature**: `@property def extra_state_attributes(self) -> Dict[str, Any]`
- **Contract**: Returns dict with `member_entities`, `member_count`, `group_name`, `schedule_enabled`, `member_temperatures`, and placeholder `active_node`/`next_node` info.
- **Mutates**: None (read-only).
- **Calls**: None.
- **Called by**: HA state machine when reading entity state.
- **Edge cases**: `active_node` and `next_node` are always None due to the bug in `_update_state` — these keys are never populated.
- **Test coverage**: Untested.

## Invariants
1. **One climate entity per non-empty group**: Every group with ≥1 entity gets a climate entity; empty groups are skipped. (Proven by `async_setup_entry` logic.)
2. **HVAC mode mirrors enabled state**: `HVACMode.AUTO` ↔ enabled, `HVACMode.OFF` ↔ disabled. (Proven by `_handle_coordinator_update` and `async_set_hvac_mode`.)
3. **Target temperature = schedule setpoint or fallback**: Active node temp → member average → 20°C. (Assumed; `_update_state` implements this.)
4. **Current temperature = average of members**: Simple arithmetic mean, no weighting. (Proven by `_update_state`.)
5. **Member temp step = first member's step**: Only the first member entity's `target_temp_step` is used. (Assumed; may not match other members.)

## Contract Connections
- **C-CLIMATE-ENTITY**: Each group exposes a HA climate entity with AUTO/OFF HVAC modes and preset (profile) support.
- **C-TEMP-BOUNDS-MISMATCH**: `max_temp=35.0` here vs `MAX_TEMP=30.0` in const.py — violates C-TEMP-BOUNDS.
- **C-OVERRIDE-UNTIL-NEXT-NODE**: Manual temperature changes expire at the next scheduled node time.

## Known Bugs / Gaps
1. **`_active_node` / `_next_node` always None** (line 326–327): The `_update_state` method computes the active node locally but never assigns to `self._active_node`. The attributes in `extra_state_attributes` are always empty.
2. **Schedule data access mismatch in `async_set_temperature`** (lines 402–404): Accesses `schedules[current_day]["nodes"]` but the schedule is stored as flat lists, not `{"nodes": [...]}` dicts. This will likely raise `KeyError` or `TypeError`.
3. **Direct `_storage._data` access** (lines 184, 246, 400): Breaks `ScheduleStorage` encapsulation. Should use public accessor methods.
4. **`_map_hvac_mode` is dead code**: Defined but never called.
5. **`max_temp` mismatch**: 35.0 here vs 30.0 in `const.py`.
6. **Duplicated schedule mode logic**: The day→schedule lookup (all_days/5/2/individual) is repeated in `_update_state`, `switch.py`, and likely `coordinator.py`. Should be a shared utility.
7. **No temperature unit conversion**: Temperatures are stored/applied in native units. If the system is °F but schedule nodes are in °C (or vice versa), incorrect temperatures will be applied.

## Cross-Module Dependencies
- **Imports from**: `.const` (DOMAIN), `.coordinator` (HeatingSchedulerCoordinator), `.storage` (ScheduleStorage), `homeassistant.components.climate.*`, `homeassistant.config_entries`, `homeassistant.const`, `homeassistant.core`, `homeassistant.helpers.entity_platform`, `homeassistant.helpers.update_coordinator`, `homeassistant.util.unit_conversion`
- **Imported by**: Home Assistant climate platform (forwarded by `__init__.py`)