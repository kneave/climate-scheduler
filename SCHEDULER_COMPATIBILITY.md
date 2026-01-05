# Scheduler Component Compatibility

## Overview

Climate Scheduler now exposes schedule data in a format compatible with [nielsfaber/scheduler-component](https://github.com/nielsfaber/scheduler-component), allowing other integrations like [Intelligent-Heating-Pilot](https://github.com/RastaChaum/Intelligent-Heating-Pilot) to consume your climate schedules.

## Implementation

### Switch Entities

Each schedule (group) is exposed as a **switch entity** following the pattern: `switch.schedule_<name>_<token>`

For example:
- `switch.schedule_living_room_a1b2c3` (single-entity group)
- `switch.schedule_bedrooms_d4e5f6` (multi-entity group)

### Entity State

The switch state indicates whether the schedule is enabled:
- **`on`**: Schedule is enabled and active
- **`off`**: Schedule is disabled

### Scheduler-Compatible Attributes

Each switch entity exposes the following attributes that match the scheduler-component format:

#### Core Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| `next_trigger` | ISO datetime string | When the next schedule change will occur |
| `next_slot` | int | Index of the next action in the actions list |
| `actions` | list | List of action dictionaries (service calls) |

#### Fallback Format
| Attribute | Type | Description |
|-----------|------|-------------|
| `next_entries` | list | Alternative format with time + actions |

#### Metadata
| Attribute | Type | Description |
|-----------|------|-------------|
| `schedule_mode` | string | `all_days`, `5/2`, or `individual` |
| `schedules` | dict | All schedules for different days |
| `active_profile` | string | Name of currently active profile |
| `profiles` | list | Available profile names |
| `entities` | list | Climate entities controlled by this schedule |
| `weekdays` | list | Days when schedule is active |

### Action Format

Actions follow the Home Assistant service call format:

```json
{
  "entity_id": "climate.living_room",
  "service": "climate.set_temperature",
  "data": {
    "temperature": 21.0
  }
}
```

For preset mode actions:
```json
{
  "entity_id": "climate.living_room",
  "service": "climate.set_preset_mode",
  "data": {
    "preset_mode": "comfort"
  }
}
```

### next_entries Format

The `next_entries` attribute provides an alternative format:

```json
[
  {
    "time": "2026-01-05T07:00:00+00:00",
    "trigger_time": "2026-01-05T07:00:00+00:00",
    "actions": [
      {
        "entity_id": "climate.living_room",
        "service": "climate.set_temperature",
        "data": {"temperature": 21.0}
      }
    ]
  }
]
```

## Integration Examples

### Reading Next Scheduled Temperature

```python
from homeassistant.core import HomeAssistant

async def get_next_schedule(hass: HomeAssistant, climate_entity: str):
    """Get next scheduled temperature for a climate entity."""
    # Find the scheduler switch for this entity
    for entity_id in hass.states.async_entity_ids('switch'):
        if not entity_id.startswith('switch.schedule_'):
            continue
        
        state = hass.states.get(entity_id)
        if not state:
            continue
        
        # Check if this scheduler controls our climate entity
        entities = state.attributes.get('entities', [])
        if climate_entity not in entities:
            continue
        
        # Check if enabled
        if state.state != 'on':
            continue
        
        # Get next trigger info
        next_trigger = state.attributes.get('next_trigger')
        next_slot = state.attributes.get('next_slot')
        actions = state.attributes.get('actions', [])
        
        if next_slot is not None and next_slot < len(actions):
            next_action = actions[next_slot]
            next_temp = next_action.get('data', {}).get('temperature')
            
            return {
                'next_trigger': next_trigger,
                'temperature': next_temp,
                'action': next_action
            }
    
    return None
```

### Using next_entries (Fallback)

```python
async def get_next_from_entries(hass: HomeAssistant, scheduler_entity: str):
    """Get next schedule using next_entries format."""
    state = hass.states.get(scheduler_entity)
    if not state:
        return None
    
    next_entries = state.attributes.get('next_entries', [])
    if not next_entries:
        return None
    
    # First entry is the next scheduled event
    next_entry = next_entries[0]
    
    return {
        'time': next_entry.get('time'),
        'actions': next_entry.get('actions', [])
    }
```

## Consuming Schedule Data

### For Integration Developers

If you're building an integration that needs to read climate schedules:

1. **Find scheduler switches**: Look for entities starting with `switch.schedule_`
2. **Check entity mapping**: Use the `entities` attribute to find which scheduler controls your climate entity
3. **Verify enabled**: Check that `state == "on"`
4. **Read schedule data**: Use either:
   - `next_trigger` + `next_slot` + `actions` (standard format)
   - `next_entries` (fallback format)

### Example: Intelligent-Heating-Pilot Integration

The [Intelligent-Heating-Pilot](https://github.com/RastaChaum/Intelligent-Heating-Pilot) integration expects:

- **State**: "on" or "off" (enabled/disabled)
- **`next_trigger`**: ISO datetime string
- **`next_slot`**: Integer index
- **`actions`**: List with `service`, `data`, `entity_id`

Climate Scheduler provides all of these attributes in the expected format.

## Automation Examples

### Get Next Schedule Time

```yaml
automation:
  - alias: "Log next heating schedule"
    trigger:
      - platform: time_pattern
        minutes: "/15"
    action:
      - service: system_log.write
        data:
          message: >
            Next schedule for Living Room: 
            {{ state_attr('switch.schedule_living_room_a1b2c3', 'next_trigger') }}
            Target: {{ state_attr('switch.schedule_living_room_a1b2c3', 'actions')[state_attr('switch.schedule_living_room_a1b2c3', 'next_slot')].data.temperature }}°C
```

### Enable/Disable Schedule

```yaml
automation:
  - alias: "Disable heating schedule at night"
    trigger:
      - platform: time
        at: "22:00:00"
    action:
      - service: switch.turn_off
        target:
          entity_id: switch.schedule_bedrooms_d4e5f6
```

## Testing

### Check Available Schedules

In Home Assistant Developer Tools → States, filter by `switch.schedule_` to see all scheduler switches.

### Inspect Attributes

Click on any scheduler switch to see the full attribute set, including:
- `next_trigger`
- `next_slot`
- `actions`
- `next_entries`
- `schedules`
- `entities`

### Test with Template

Developer Tools → Template:

```jinja
{% set scheduler = 'switch.schedule_living_room_a1b2c3' %}
Enabled: {{ states(scheduler) }}
Next Trigger: {{ state_attr(scheduler, 'next_trigger') }}
Next Slot: {{ state_attr(scheduler, 'next_slot') }}
Entities: {{ state_attr(scheduler, 'entities') }}
Actions: {{ state_attr(scheduler, 'actions') }}
```

## Migration Notes

### Existing Installations

After upgrading to this version:

1. **Switch entities are created automatically** for all existing schedules
2. **No data loss**: All your existing schedules remain intact
3. **Backward compatible**: Existing functionality continues to work

### Naming Convention

- Single-entity groups: `switch.schedule_<climate_name>_<token>`
- Multi-entity groups: `switch.schedule_<group_name>_<token>`

The 6-character token ensures unique entity IDs even if you have multiple schedules with similar names.

## Troubleshooting

### Switch Entity Not Appearing

1. Check if the schedule is marked as ignored: Look at the group data in Developer Tools
2. Reload the integration: Developer Tools → YAML → Reload Integrations → Climate Scheduler
3. Check logs: Look for "Created X scheduler switch entities" in Home Assistant logs

### Attributes Missing

If `next_trigger`, `next_slot`, or `actions` are null:
- Verify the schedule has at least one node configured
- Check that the schedule is enabled (`state == "on"`)
- Ensure the schedule has valid time values (HH:MM format)

### Integration Can't Find Schedules

Make sure the consuming integration:
1. Looks for entities starting with `switch.schedule_`
2. Checks the `entities` attribute to match climate entities
3. Verifies `state == "on"` before reading schedule data

## API Reference

### Switch Entity ID Pattern

```
switch.schedule_{name}_{token}
```

- `{name}`: Climate entity name or group name (lowercase, spaces replaced with underscores)
- `{token}`: 6-character MD5 hash for uniqueness

### State Values

- `on`: Schedule enabled
- `off`: Schedule disabled

### Required Attributes

For scheduler-component compatibility, these attributes are always present:

```json
{
  "next_trigger": "2026-01-05T07:00:00+00:00",
  "next_slot": 0,
  "actions": [
    {
      "entity_id": "climate.living_room",
      "service": "climate.set_temperature",
      "data": {"temperature": 21.0}
    }
  ],
  "next_entries": [
    {
      "time": "2026-01-05T07:00:00+00:00",
      "trigger_time": "2026-01-05T07:00:00+00:00",
      "actions": [...]
    }
  ]
}
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/kneave/climate-scheduler/issues
- Scheduler Component: https://github.com/nielsfaber/scheduler-component
- Intelligent-Heating-Pilot: https://github.com/RastaChaum/Intelligent-Heating-Pilot
