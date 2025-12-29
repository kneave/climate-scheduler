# Preset-Only Climate Entity Support

## Overview

The Climate Scheduler automatically detects and handles climate entities that are controlled purely via preset modes and do not support temperature setpoints.

## Problem

Some climate entities (like certain thermostat models) have a `null` `current_temperature` attribute in Home Assistant. These devices are controlled through preset modes (e.g., "comfort", "eco", "away", "sleep") rather than numeric temperature setpoints.

Previously, attempting to set temperatures on these entities could cause errors or unexpected behavior.

## Solution

The system now checks each entity individually when applying schedule changes. If an entity has `current_temperature: null`, the system automatically skips setting temperature for that specific entity while still applying all mode changes.

### Per-Entity Detection

When applying a schedule node to a group:

```python
# Check if this is a preset-only entity (no current_temperature sensor)
current_temperature = state.attributes.get("current_temperature")
is_preset_only = current_temperature is None
if is_preset_only:
    _LOGGER.info(f"{entity_id} is preset-only (no current_temperature), will skip temperature changes")
```

For each entity in the group:
- If `current_temperature` is `null`: Skip temperature setpoint, apply modes only
- If `current_temperature` has a value: Set temperature normally and apply modes

This allows **mixed groups** with both regular thermostats and preset-only thermostats.

### Mode Changes Still Apply

Even for preset-only entities, all mode settings are applied:
- HVAC mode (heat, cool, off, etc.)
- Fan mode
- Swing mode
- Preset mode (comfort, eco, away, etc.)

## Usage

No special configuration is required. The system automatically:

1. **Detects** preset-only entities when applying schedules
2. **Skips** temperature setpoints for those specific entities
3. **Applies** all mode changes normally
4. **Sets temperatures** for other entities in the same group that support it

## Example: Mixed Group

```yaml
# Group with both regular and preset-only entities
group:
  entities:
    - climate.bedroom_thermostat      # Regular: has current_temperature
    - climate.preset_radiator         # Preset-only: current_temperature is null
```

When a schedule node activates with `temp: 21` and `hvac_mode: heat`:
- `climate.bedroom_thermostat`: Temperature set to 21°C, HVAC mode set to heat
- `climate.preset_radiator`: Temperature skipped, HVAC mode set to heat

## Example Entity

```yaml
climate.preset_thermostat:
  state: heat
  attributes:
    current_temperature: null  # Indicates preset-only control
    temperature: null
    target_temp_high: null
    target_temp_low: null
    hvac_modes:
      - heat
      - "off"
    hvac_action: heating
    preset_mode: comfort
    preset_modes:
      - comfort
      - eco
      - away
      - sleep
```

For this entity, the scheduler will:
- Skip temperature setpoint operations
- Apply HVAC mode, fan mode, swing mode, preset mode changes
- Log: "Skipping temperature change for climate.preset_thermostat (preset-only entity)"

## Benefits

1. **Flexibility**: Mix regular and preset-only entities in the same group
2. **Automatic**: No manual configuration or node setup needed
3. **Intelligent**: Per-entity detection, not group-wide
4. **Safe**: Prevents invalid temperature operations
5. **Functional**: All mode controls work normally for all entities

## Files Modified

- **coordinator.py**:
  - Added `is_preset_only` detection by checking `current_temperature` attribute
  - Skip temperature service calls for preset-only entities
  - Applied in both scheduled updates and manual advance service
  
- **app.js**:
  - Removed group-wide detection and UI restrictions
  - Users can freely use temperature nodes (needed for other entities)
  
- **AUTOMATION_EVENTS.md**:
  - Updated documentation to reflect per-entity handling
  - Explained mixed-group capability
