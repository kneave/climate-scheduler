# KNOWLEDGE: const.py

## Purpose
Central constants module for the Climate Scheduler integration. Defines the domain name, storage keys, temperature bounds, update interval, and workday settings used across all other modules.

## Key Functions (alphabetical)

*(This module contains no functions — only module-level constant assignments.)*

### DOMAIN (line 3)
- **Signature**: `str = "climate_scheduler"`
- **Contract**: The unique Home Assistant integration domain identifier. Used as key in `hass.data`, service domain, and config entry identification.
- **Mutates**: N/A (immutable constant)
- **Calls**: N/A
- **Called by**: Every other module imports this: `__init__.py`, `config_flow.py`, `climate.py`, `sensor.py`, `switch.py`, and others.
- **Edge cases**: N/A
- **Test coverage**: Implicitly tested via all integration tests.

### STORAGE_KEY (line 7)
- **Signature**: `str = "climate_scheduler_data"`
- **Contract**: The key used to persist schedule data in Home Assistant's `hass.helpers.storage.Store`. Must match across load/save calls.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: `storage.py` (not in the 6-module set, but inferred from `__init__.py` usage of `ScheduleStorage`)
- **Edge cases**: Changing this key without migration will orphan existing persisted data.
- **Test coverage**: Untested directly.

### STORAGE_VERSION (line 6)
- **Signature**: `int = 1`
- **Contract**: Schema version for the persistent store. Incrementing triggers migration logic in `ScheduleStorage`.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: `storage.py`
- **Edge cases**: Must be incremented on breaking schema changes; otherwise old data may fail to deserialize.
- **Test coverage**: Untested directly.

### MIN_TEMP / MAX_TEMP (lines 13–14)
- **Signature**: `float = 5.0` / `float = 30.0`
- **Contract**: Legal temperature range in Celsius. Validates user input and constrains schedule node temperatures.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: `coordinator.py`, `storage.py` (inferred)
- **Edge cases**: Does not account for Fahrenheit — UI must convert before comparing. Also `climate.py` hard-codes its own `min_temp=5.0, max_temp=35.0` rather than importing these.
- **Test coverage**: Partially tested via schedule validation.

### NO_CHANGE_TEMP (line 15)
- **Signature**: `None = None`
- **Contract**: Sentinel value meaning "do not change the temperature at this schedule node". When a node's `temp` equals `NO_CHANGE_TEMP`, the coordinator should skip the set_temperature call.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: Coordinator logic (inferred)
- **Edge cases**: Must only be compared with `is None` since `None == None` is True but the intent is a sentinel, not a valid temperature. A typo could accidentally pass `0` as a real temperature vs `None` as "skip".
- **Test coverage**: Likely untested.

### UPDATE_INTERVAL_SECONDS (line 18)
- **Signature**: `int = 60`
- **Contract**: How often (in seconds) the coordinator polls for schedule changes and applies setpoints. Timer fires every 60s via `async_track_time_interval`.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: `__init__.py` (line 43, 59–63)
- **Edge cases**: Too low → excessive HA state writes and service calls. Too high → sluggish response to schedule transitions. 60s is a compromise.
- **Test coverage**: Untested directly.

### SETTING_USE_WORKDAY / SETTING_WORKDAYS (lines 20–21)
- **Signature**: `str = "use_workday_integration"` / `str = "workdays"`
- **Contract**: Dictionary keys for per-integration settings governing whether the HA Workday integration is consulted for weekday/weekend classification, and which days are considered workdays.
- **Mutates**: N/A
- **Called by**: `storage.py`, `services.py` (inferred)
- **Edge cases**: The setting key strings must match exactly what's stored/loaded from persistent data; a mismatch silently yields defaults.
- **Test coverage**: Partially tested.

### DEFAULT_WORKDAYS (line 24)
- **Signature**: `list[str] = ["mon", "tue", "wed", "thu", "fri"]`
- **Contract**: Fallback workday list when the user has not configured custom workdays. Uses three-letter lowercase day abbreviations matching Python's `%a` format.
- **Mutates**: N/A
- **Called by**: Settings initialization logic.
- **Edge cases**: Locale-dependent: Python's `%a` format respects locale; `"Mon"` vs `"mon"` could mismatch if locale is not English. All comparisons elsewhere use `.lower()` so this is mitigated.
- **Test coverage**: Untested directly.

### DEFAULT_SCHEDULE (line 10)
- **Signature**: `list = []`
- **Contract**: Empty list — no default schedule nodes. New groups/entities start with no schedule; the user must configure one.
- **Mutates**: N/A
- **Called by**: Group/entity creation code.
- **Edge cases**: An empty schedule means no temperature changes until the user adds nodes.
- **Test coverage**: Untested directly.

## Invariants
1. **All constants are immutable at runtime** — no module ever mutates these values. (Assumed, not enforced.)
2. **Temperature bounds are in Celsius** — any Fahrenheit conversion must happen at the boundary (UI/service layer).
3. **Day abbreviations are three-letter lowercase** — consistent with `strftime('%a').lower()`.

## Contract Connections
- **C-STORAGE-KEY**: STORAGE_KEY and STORAGE_VERSION define the persistence contract.
- **C-TEMP-BOUNDS**: MIN_TEMP/MAX_TEMP define the valid temperature input range.
- **C-UPDATE-CADENCE**: UPDATE_INTERVAL_SECONDS defines coordinator refresh rate.

## Known Bugs / Gaps
1. **climate.py doesn't use MIN_TEMP/MAX_TEMP from const.py** — It hard-codes `_attr_min_temp = 5.0` and `_attr_max_temp = 35.0` (note: 35.0 ≠ 30.0). This means the climate card allows temperatures up to 35°C while the validation logic may reject > 30°C.
2. **NO_CHANGE_TEMP is just `None`** — No type-level protection against confusing `None` (skip) with `None` (missing data). A dedicated sentinel object would be safer.
3. **DEFAULT_SCHEDULE is mutable** — It's a `[]` list. If someone accidentally appends to it, it would mutate the module-level constant. Should be a tuple `()` or frozen.

## Cross-Module Dependencies
- **Exports to**: `__init__.py` (DOMAIN, UPDATE_INTERVAL_SECONDS), `config_flow.py` (DOMAIN), `climate.py` (DOMAIN), `sensor.py` (DOMAIN), `switch.py` (DOMAIN)
- **Imports from**: None (leaf module)