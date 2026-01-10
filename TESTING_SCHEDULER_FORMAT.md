# Testing Scheduler-Component Data Format

## Quick Validation Methods

### Method 1: Developer Tools - States (Easiest)

1. Go to **Developer Tools** → **States**
2. Filter by `switch.schedule_`
3. Click on any scheduler entity
4. Verify these attributes exist:

**Required for compatibility:**
- `next_trigger` - Should be ISO datetime like `2026-01-07T07:00:00+00:00`
- `next_slot` - Should be an integer (e.g., `0`, `1`, `2`)
- `actions` - Should be a list of action objects

**Example of correct format:**
```json
{
  "next_trigger": "2026-01-07T07:00:00+00:00",
  "next_slot": 0,
  "actions": [
    {
      "entity_id": "climate.living_room",
      "service": "climate.set_temperature",
      "data": {
        "temperature": 21.0
      }
    }
  ],
  "next_entries": [
    {
      "time": "2026-01-07T07:00:00+00:00",
      "trigger_time": "2026-01-07T07:00:00+00:00",
      "actions": [...]
    }
  ],
  "entities": ["climate.living_room"],
  "schedule_mode": "all_days"
}
```

### Method 2: Developer Tools - Template

Copy and paste this into **Developer Tools** → **Template**:

```jinja
{%- set schedulers = states.switch | selectattr('entity_id', 'match', 'switch.schedule_.*') | list -%}

# Scheduler Validation Report
Found {{ schedulers | length }} scheduler entities

{% for scheduler in schedulers -%}
## {{ scheduler.entity_id }}
**State:** {{ scheduler.state }}
**Enabled:** {{ scheduler.state == 'on' }}

### Core Attributes (Required)
- next_trigger: {{ scheduler.attributes.next_trigger }}
- next_slot: {{ scheduler.attributes.next_slot }}
- actions: {{ scheduler.attributes.actions | length }} items

### Controlled Entities
{{ scheduler.attributes.entities | join(', ') }}

### Next Scheduled Action
{%- if scheduler.attributes.next_slot is not none and scheduler.attributes.actions | length > scheduler.attributes.next_slot %}
Entity: {{ scheduler.attributes.actions[scheduler.attributes.next_slot].entity_id }}
Service: {{ scheduler.attributes.actions[scheduler.attributes.next_slot].service }}
Data: {{ scheduler.attributes.actions[scheduler.attributes.next_slot].data }}
{%- else %}
No next action available
{%- endif %}

### Validation Checks
✓ next_trigger is {{ 'valid' if scheduler.attributes.next_trigger else 'MISSING' }}
✓ next_slot is {{ 'valid' if scheduler.attributes.next_slot is not none else 'MISSING' }}
✓ actions is {{ 'valid' if scheduler.attributes.actions else 'EMPTY' }}
✓ next_entries is {{ 'valid' if scheduler.attributes.next_entries else 'EMPTY' }}

---
{% endfor %}
```

### Method 3: REST API Check

Use curl or your browser to check the entity state:

```bash
# Get authentication token from Home Assistant Profile -> Long-Lived Access Tokens
TOKEN="your_token_here"
ENTITY="switch.schedule_living_room_abc123"

curl -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://homeassistant.local:8123/api/states/$ENTITY
```

Expected response structure:
```json
{
  "entity_id": "switch.schedule_living_room_abc123",
  "state": "on",
  "attributes": {
    "next_trigger": "2026-01-07T07:00:00+00:00",
    "next_slot": 0,
    "actions": [...],
    "next_entries": [...],
    "entities": ["climate.living_room"]
  }
}
```

## Detailed Validation Checklist

### ✓ State Value
- [ ] State is either `on` or `off`
- [ ] `on` means schedule is enabled
- [ ] `off` means schedule is disabled

### ✓ next_trigger Attribute
- [ ] Present in attributes
- [ ] String type
- [ ] ISO 8601 format (e.g., `2026-01-07T07:00:00+00:00`)
- [ ] Includes timezone information
- [ ] Represents the next time the schedule will trigger

### ✓ next_slot Attribute
- [ ] Present in attributes
- [ ] Integer type (or `null` if no schedule)
- [ ] Valid index for the `actions` array
- [ ] Example: If `next_slot` is `2`, then `actions[2]` should exist

### ✓ actions Attribute
- [ ] Present in attributes
- [ ] List/array type
- [ ] Each item is a dictionary/object
- [ ] Each action has:
  - `entity_id` (string)
  - `service` (string, e.g., `climate.set_temperature`)
  - `data` (dict with service parameters)

### ✓ next_entries Attribute (Fallback)
- [ ] Present in attributes
- [ ] List/array type
- [ ] Each entry has:
  - `time` or `trigger_time` (ISO datetime string)
  - `actions` (list of action dicts)

### ✓ Additional Metadata
- [ ] `entities` - List of climate entity IDs controlled by this schedule
- [ ] `schedule_mode` - One of: `all_days`, `5/2`, `individual`
- [ ] `schedules` - Dict with schedule nodes for each day
- [ ] `active_profile` - Name of active profile
- [ ] `profiles` - List of available profile names

## Testing with Intelligent-Heating-Pilot Format

The Intelligent-Heating-Pilot integration expects:

```python
# What they read from state attributes:
next_trigger = state.attributes.get("next_trigger")  # ISO datetime string
next_slot = state.attributes.get("next_slot")        # Integer
actions = state.attributes.get("actions")            # List of dicts

# They also check:
state.state == "off"  # To see if disabled

# From actions[next_slot]:
action = actions[next_slot]
entity_id = action.get("entity_id")
service = action.get("service") or action.get("service_call")
data = action.get("data") or action.get("service_data")

# For temperature:
temperature = data.get("temperature")

# For preset mode:
preset = data.get("preset_mode") or data.get("preset") or data.get("mode")
```

### Test Template for IHP Compatibility

```jinja
{%- set scheduler = states['switch.schedule_living_room_abc123'] -%}
{%- set next_slot = scheduler.attributes.next_slot -%}
{%- set actions = scheduler.attributes.actions -%}

# IHP Compatibility Check

**Scheduler Enabled:** {{ scheduler.state != 'off' }}

**Next Trigger:** {{ scheduler.attributes.next_trigger }}

**Next Slot Index:** {{ next_slot }}

{%- if next_slot is not none and actions and next_slot < (actions | length) %}
**Next Action:**
- Entity: {{ actions[next_slot].entity_id }}
- Service: {{ actions[next_slot].service }}
- Temperature: {{ actions[next_slot].data.temperature | default('N/A') }}
- Preset: {{ actions[next_slot].data.preset_mode | default('N/A') }}

✓ IHP can read this schedule
{%- else %}
✗ No valid next action (schedule might be empty or disabled)
{%- endif %}
```

## Common Issues and Fixes

### Issue: `next_trigger` is null
**Cause:** Schedule has no nodes configured
**Fix:** Add at least one schedule node using the Climate Scheduler card

### Issue: `next_slot` is null
**Cause:** Schedule is disabled or has no future nodes
**Fix:** Enable the schedule using the switch entity or check schedule configuration

### Issue: `actions` is empty
**Cause:** No schedule configured for current day/mode
**Fix:** Configure schedule for the active day in your schedule mode

### Issue: AttributeError on entity_id
**Cause:** Entity_id property had no setter (fixed in latest version)
**Fix:** Update to latest version where this is resolved

### Issue: actions[next_slot] doesn't exist
**Cause:** Mismatch between next_slot index and actions length
**Fix:** This should be automatically calculated - report as bug

## Automated Validation Script

Save this as a Home Assistant script (`scripts.yaml`):

```yaml
validate_scheduler_data:
  alias: Validate Scheduler Data Format
  sequence:
    - variables:
        scheduler_entities: >
          {{ states.switch 
             | selectattr('entity_id', 'match', 'switch.schedule_.*') 
             | list }}
    - repeat:
        for_each: "{{ scheduler_entities }}"
        sequence:
          - service: system_log.write
            data:
              message: >
                Scheduler: {{ repeat.item.entity_id }}
                State: {{ repeat.item.state }}
                next_trigger: {{ repeat.item.attributes.next_trigger | default('MISSING') }}
                next_slot: {{ repeat.item.attributes.next_slot | default('MISSING') }}
                actions_count: {{ repeat.item.attributes.actions | length | default(0) }}
                entities: {{ repeat.item.attributes.entities | join(', ') | default('NONE') }}
                Valid: {{ (repeat.item.attributes.next_trigger is not none 
                           and repeat.item.attributes.next_slot is not none 
                           and repeat.item.attributes.actions | length > 0) }}
              level: info
```

Run it with:
```yaml
service: script.validate_scheduler_data
```

## Expected Output Examples

### Correct Format (Living Room Schedule)
```yaml
entity_id: switch.schedule_living_room_abc123
state: on
attributes:
  next_trigger: "2026-01-07T07:00:00+00:00"
  next_slot: 0
  actions:
    - entity_id: climate.living_room
      service: climate.set_temperature
      data:
        temperature: 21
    - entity_id: climate.living_room
      service: climate.set_temperature
      data:
        temperature: 18
  next_entries:
    - time: "2026-01-07T07:00:00+00:00"
      trigger_time: "2026-01-07T07:00:00+00:00"
      actions:
        - entity_id: climate.living_room
          service: climate.set_temperature
          data:
            temperature: 21
  entities:
    - climate.living_room
  schedule_mode: all_days
  active_profile: Default
```

### Correct Format (Multi-Entity Group)
```yaml
entity_id: switch.schedule_bedrooms_def456
state: on
attributes:
  next_trigger: "2026-01-07T22:00:00+00:00"
  next_slot: 1
  actions:
    - entity_id: climate.bedroom_1
      service: climate.set_temperature
      data:
        temperature: 20
    - entity_id: climate.bedroom_2
      service: climate.set_temperature
      data:
        temperature: 20
  entities:
    - climate.bedroom_1
    - climate.bedroom_2
  schedule_mode: 5/2
```

## Integration Testing

To test with an actual consuming integration:

1. **Install Intelligent-Heating-Pilot** (optional)
2. **Configure it to read your scheduler entities**
3. **Check its logs** for any parsing errors
4. **Monitor behavior** to ensure it correctly reads schedule changes

## Verification Checklist

- [ ] All scheduler entities start with `switch.schedule_`
- [ ] State is `on` or `off`
- [ ] `next_trigger` is valid ISO datetime string
- [ ] `next_slot` is valid integer index
- [ ] `actions` is non-empty list
- [ ] Each action has `entity_id`, `service`, and `data`
- [ ] `next_entries` provides fallback format
- [ ] `entities` lists all controlled climate devices
- [ ] Attributes update when time progresses
- [ ] Turning switch on/off enables/disables schedule

If all checks pass, your data format is correct for scheduler-component integration! ✓
