# KNOWLEDGE: sensor.py

## Purpose
Implements the Sensor platform for the Climate Scheduler integration. Creates three types of sensors: (1) `ClimateSchedulerRateSensor` — derivative sensors tracking the rate of temperature change (°C/h) for each climate entity and its floor sensors; (2) `ColdestEntitySensor` — identifies the coldest climate entity across all groups; (3) `WarmestEntitySensor` — identifies the warmest entity. The derivative sensors are used by the coordinator to make proactive heating decisions.

## Key Functions (alphabetical)

### ClimateSchedulerRateSensor.__init__(hass, climate_entity_id, source_entity_id, temperature_attribute, device_id) (line 106)
- **Signature**: `def __init__(self, hass: HomeAssistant, climate_entity_id: str, source_entity_id: str, temperature_attribute: str = "current_temperature", device_id: str = None) -> None`
- **Contract**: Initializes a rate-of-change sensor. For direct climate entity tracking, `source_entity_id == climate_entity_id` and `temperature_attribute == "current_temperature"`. For floor sensors, `source_entity_id` is the floor sensor entity and `temperature_attribute == "state"`. Derives `unique_id` and `name` from entity IDs with deduplication logic to prevent recursive naming.
- **Mutates**: Sets `_attr_name`, `_attr_unique_id`, `_attr_device_class`, `_attr_state_class`, `_attr_native_unit_of_measurement`, `_attr_icon`, `_samples`, `_attr_native_value`, `_attr_device_info`.
- **Calls**: `dr.async_get(hass)`, `device_registry.async_get()`.
- **Called by**: `async_setup_entry()`.
- **Edge cases**:
  - Lines 132–136: Strips `climate_scheduler_` prefix and `_rate` suffix from floor sensor names to avoid recursive naming like `climate_scheduler_climate_scheduler_x_rate_rate`. Needed because previous sensor creation could produce such names.
  - Lines 139–142: Prevents duplicated segments like `front_room_front_room_...` when floor sensor name starts with climate entity name.
  - Line 177: `_attr_native_unit_of_measurement = "°C/h"` — hard-coded Celsius; not converted for Fahrenheit systems.
  - If `device_id` is provided but device not found in registry, logs error and sensor has no device link.
- **Test coverage**: Partially tested.

### ClimateSchedulerRateSensor._async_source_state_changed(event) (line 208)
- **Signature**: `@callback def _async_source_state_changed(self, event) -> None`
- **Contract**: Called when the source entity's state changes. Reads temperature from state (for floor sensors) or `current_temperature` attribute (for climate entities). Appends a `(timestamp, temperature)` sample, trims to `SAMPLE_SIZE` (10), and recalculates rate if ≥2 samples exist. Writes HA state.
- **Mutates**: `_samples`, `_attr_native_value`.
- **Calls**: `self._calculate_rate()`, `self.async_write_ha_state()`.
- **Called by**: HA state change event bus (via `async_track_state_change_event`).
- **Edge cases**:
  - If `new_state` is None (entity removed), returns immediately — no rate update.
  - If temperature can't be parsed as float, silently skips.
  - Samples are trimmed to last `SAMPLE_SIZE` entries — older data is discarded, which means the rate is computed over a sliding window.
- **Test coverage**: Partially tested.

### ClimateSchedulerRateSensor._calculate_rate() (line 241)
- **Signature**: `def _calculate_rate(self) -> None`
- **Contract**: Computes rate of temperature change as `(newest_temp - oldest_temp) / time_diff_hours`. Uses only first and last samples in the window (not a regression). If fewer than 2 samples, rate is 0.0. If time diff is 0 (samples at same timestamp), rate is 0.0. Rounds to 2 decimal places.
- **Mutates**: `_attr_native_value`.
- **Calls**: None.
- **Called by**: `_async_source_state_changed()`.
- **Edge cases**:
  - Uses only first and last sample, ignoring intermediate data points — effectively a two-point derivative, not a best-fit regression. This is noisy for rapidly fluctuating temperatures.
  - If samples span exactly 0 time (e.g., two HA state changes in the same second), returns 0.0 to avoid division by zero.
  - No smoothing or outlier filtering — a single bad reading can skew the rate significantly.
- **Test coverage**: Partially tested.

### ClimateSchedulerRateSensor.async_added_to_hass() (line 179)
- **Signature**: `async def async_added_to_hass(self) -> None`
- **Contract**: Registers a state change listener for the source entity via `async_track_state_change_event`. Populates initial sample from current entity state.
- **Mutates**: `_samples`.
- **Calls**: `async_track_state_change_event()`, `self.hass.states.get()`.
- **Called by**: HA entity lifecycle.
- **Edge cases**: If source entity has no state at init, no initial sample is added — rate stays 0.0 until first change.
- **Test coverage**: Untested.

### ClimateSchedulerRateSensor.extra_state_attributes (property, line 266)
- **Signature**: `@property def extra_state_attributes(self) -> dict[str, Any]`
- **Contract**: Returns `climate_entity`, `source_entity`, `temperature_attribute`, `sample_count`, and hard-coded `time_window_minutes: 5`.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: HA state machine.
- **Edge cases**: `time_window_minutes: 5` is hard-coded and doesn't reflect the actual sample window. Inconsistent with `SAMPLE_SIZE = 10` which depends on state change frequency.
- **Test coverage**: Untested.

### ColdestEntitySensor.__init__(hass, storage, coordinator) (line 280)
- **Signature**: `def __init__(self, hass: HomeAssistant, storage, coordinator) -> None`
- **Contract**: Creates a sensor that tracks the coldest climate entity by `current_temperature`. Uses coordinator listener for updates. Unit is Celsius.
- **Mutates**: Sets all `_attr_*` fields.
- **Called by**: `async_setup_entry()`.
- **Edge cases**: `_attr_native_value = None` initially — sensor shows "unavailable" until first update.
- **Test coverage**: Partially tested.

### ColdestEntitySensor._async_update() (line 320)
- **Signature**: `async def _async_update(self) -> None`
- **Contract**: Iterates all entities from all groups, skips ignored ones, finds the one with lowest `current_temperature`. Sets `native_value`, `_coldest_entity_id`, and `_coldest_friendly_name`. Writes HA state.
- **Mutates**: `_attr_native_value`, `_coldest_entity_id`, `_coldest_friendly_name`.
- **Calls**: `self._storage.async_get_all_entities()`, `self._storage.async_is_ignored()`, `self.hass.states.get()`, `self.async_write_ha_state()`.
- **Called by**: `async_added_to_hass()`, `_handle_coordinator_update()`.
- **Edge cases**: If all entities are ignored or have no `current_temperature`, `native_value` stays `None`.
- **Test coverage**: Partially tested.

### ColdestEntitySensor._handle_coordinator_update() (line 316)
- **Signature**: `@callback def _handle_coordinator_update(self) -> None`
- **Contract**: Schedules `_async_update()` as an async task when coordinator data changes.
- **Mutates**: None (delegates to `_async_update`).
- **Calls**: `self.hass.async_create_task(self._async_update())`.
- **Called by**: Coordinator listener.
- **Edge cases**: Creates a new task on every coordinator update — could lead to multiple concurrent `_async_update` calls if coordinator fires rapidly. No deduplication.
- **Test coverage**: Untested.

### WarmestEntitySensor.__init__(hass, storage, coordinator) (line 369)
- **Signature**: `def __init__(self, hass: HomeAssistant, storage, coordinator) -> None`
- **Contract**: Mirror of `ColdestEntitySensor.__init__` but tracks the warmest entity.
- **Mutates**: Same pattern as ColdestEntitySensor.
- **Called by**: `async_setup_entry()`.
- **Edge cases**: Same as ColdestEntitySensor.
- **Test coverage**: Partially tested.

### WarmestEntitySensor._async_update() (line 409)
- **Signature**: `async def _async_update(self) -> None`
- **Contract**: Same as `ColdestEntitySensor._async_update` but uses `>` comparison to find the highest temperature.
- **Mutates**: `_attr_native_value`, `_warmest_entity_id`, `_warmest_friendly_name`.
- **Calls**: Same as coldest counterpart.
- **Called by**: `async_added_to_hass()`, `_handle_coordinator_update()`.
- **Edge cases**: Same as coldest.
- **Test coverage**: Partially tested.

### async_setup_entry(hass, config_entry, async_add_entities) (line 27)
- **Signature**: `async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None`
- **Contract**: Creates coldest/warmest sensors unconditionally. If `settings.create_derivative_sensors` is True (default), creates derivative sensors for each climate entity in all groups and their associated floor sensors. Skips ignored entities.
- **Mutates**: Adds entities to HA platform.
- **Calls**: `storage.async_get_all_entities()`, `storage.async_is_ignored()`, `er.async_get()`, `dr.async_get()`, `async_add_entities()`.
- **Called by**: HA platform setup (forwarded by `__init__.py`).
- **Edge cases**:
  - Floor sensor detection (line 81): Uses `"floor" in entry.entity_id.lower()` — fragile heuristic. Will miss sensors named differently and include false positives if "floor" appears in entity ID for other reasons.
  - Device-less entities (line 97): Climate entities not associated with a HA device get no floor sensor derivatives and a warning is logged.
  - Settings check (line 46): `not settings.get("create_derivative_sensors", True)` — the `not` flips the logic: if True (default), derivatives ARE created. The `not` + `True` default means the early return fires when the setting is explicitly False. Correct but confusing.
- **Test coverage**: Partially tested.

## Invariants
1. **SAMPLE_SIZE = 10**: Rate sensors keep at most 10 samples. (Proven by `_async_source_state_changed` line 230.)
2. **Rate computed from endpoints only**: Uses first and last sample, not a regression. (Proven by `_calculate_rate`.)
3. **Coldest/warmest always present**: These two sensors are created regardless of settings. (Proven by `async_setup_entry` lines 42–44.)
4. **Ignored entities excluded**: All sensor types skip entities flagged as ignored in storage. (Proven by `async_is_ignored` calls.)

## Contract Connections
- **C-DERIVATIVE-SENSOR**: Rate sensors provide temperature change rate data used by the coordinator for proactive heating decisions.
- **C-COLDEST-WARMEST**: Coldest/warmest sensors provide system-wide temperature extremes.
- **C-FLOOR-SENSOR**: Floor sensors are detected and tracked when associated with devices.

## Known Bugs / Gaps
1. **Hard-coded °C/h unit**: `_attr_native_unit_of_measurement = "°C/h"` doesn't adapt to Fahrenheit systems.
2. **Two-point derivative is noisy**: Using only first and last sample ignores intermediate data. A linear regression or weighted average would be more robust.
3. **Floor sensor detection heuristic**: `"floor" in entity_id.lower()` is fragile and will miss non-"floor" named floor sensors.
4. **`time_window_minutes: 5` is hard-coded and misleading**: The actual window depends on state change frequency and SAMPLE_SIZE, not a fixed 5 minutes.
5. **No deduplication on coordinator-triggered updates**: Coldest/warmest sensors create a new task on every coordinator update without deduplication — potential for redundant work.
6. **ColdestEntitySensor not a CoordinatorEntity**: Unlike the climate and switch entities, ColdestEntitySensor manually adds a coordinator listener instead of extending `CoordinatorEntity`. This means it doesn't get the automatic `async_write_ha_state` from `CoordinatorEntity`.

## Cross-Module Dependencies
- **Imports from**: `.const` (DOMAIN), `homeassistant.components.sensor.*`, `homeassistant.config_entries`, `homeassistant.const`, `homeassistant.core`, `homeassistant.helpers.device_registry`, `homeassistant.helpers.entity_platform`, `homeassistant.helpers.event`, `homeassistant.util.dt`
- **Imported by**: Home Assistant sensor platform (forwarded by `__init__.py`)
- **Depends on**: `storage` (via `hass.data[DOMAIN]`), `coordinator` (via `hass.data[DOMAIN]`)