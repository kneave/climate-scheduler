"""Validation script to verify scheduler-component data format compatibility.

This script checks that Climate Scheduler switch entities expose the correct
attributes in the format expected by integrations like Intelligent-Heating-Pilot.

Run this in Home Assistant Developer Tools -> Template or as a script.
"""

# Expected scheduler-component attributes
REQUIRED_ATTRIBUTES = [
    "next_trigger",  # ISO datetime string
    "next_slot",     # Integer index
    "actions",       # List of action dicts
]

FALLBACK_ATTRIBUTES = [
    "next_entries",  # Alternative format
]

OPTIONAL_ATTRIBUTES = [
    "schedule_mode",
    "schedules",
    "active_profile",
    "profiles",
    "entities",
    "weekdays",
]

def validate_action(action, index):
    """Validate a single action dictionary."""
    errors = []
    
    if not isinstance(action, dict):
        errors.append(f"Action {index}: Not a dictionary")
        return errors
    
    # Required fields
    if "entity_id" not in action:
        errors.append(f"Action {index}: Missing 'entity_id'")
    
    if "service" not in action:
        errors.append(f"Action {index}: Missing 'service'")
    elif not isinstance(action["service"], str):
        errors.append(f"Action {index}: 'service' must be a string")
    
    # Data field (optional but usually present)
    if "data" in action:
        if not isinstance(action["data"], dict):
            errors.append(f"Action {index}: 'data' must be a dictionary")
        else:
            # Check for temperature in climate.set_temperature actions
            if action["service"] == "climate.set_temperature":
                if "temperature" not in action["data"]:
                    errors.append(f"Action {index}: climate.set_temperature missing 'temperature' in data")
            
            # Check for preset_mode in climate.set_preset_mode actions
            if action["service"] == "climate.set_preset_mode":
                if "preset_mode" not in action["data"]:
                    errors.append(f"Action {index}: climate.set_preset_mode missing 'preset_mode' in data")
    
    return errors


def validate_next_entry(entry, index):
    """Validate a single next_entries item."""
    errors = []
    
    if not isinstance(entry, dict):
        errors.append(f"Entry {index}: Not a dictionary")
        return errors
    
    # Should have time or trigger_time
    if "time" not in entry and "trigger_time" not in entry:
        errors.append(f"Entry {index}: Missing 'time' or 'trigger_time'")
    
    # Should have actions
    if "actions" not in entry:
        errors.append(f"Entry {index}: Missing 'actions'")
    elif not isinstance(entry["actions"], list):
        errors.append(f"Entry {index}: 'actions' must be a list")
    else:
        # Validate each action in the entry
        for action_idx, action in enumerate(entry["actions"]):
            action_errors = validate_action(action, f"{index}.{action_idx}")
            errors.extend(action_errors)
    
    return errors


def validate_scheduler_entity(hass, entity_id):
    """Validate a single scheduler entity's attributes."""
    state = hass.states.get(entity_id)
    
    if not state:
        return {"valid": False, "errors": [f"Entity {entity_id} not found"]}
    
    errors = []
    warnings = []
    
    # Check entity_id pattern
    if not entity_id.startswith("switch.schedule_"):
        warnings.append(f"Entity ID doesn't follow expected pattern: switch.schedule_*")
    
    # Check state
    if state.state not in ["on", "off", "triggered"]:
        errors.append(f"Invalid state: {state.state} (expected: on, off, or triggered)")
    
    attrs = state.attributes
    
    # Check required attributes
    for attr in REQUIRED_ATTRIBUTES:
        if attr not in attrs:
            errors.append(f"Missing required attribute: {attr}")
    
    # Validate next_trigger format
    if "next_trigger" in attrs:
        next_trigger = attrs["next_trigger"]
        if next_trigger is not None:
            if not isinstance(next_trigger, str):
                errors.append(f"next_trigger must be a string (ISO datetime), got: {type(next_trigger)}")
            else:
                # Try to parse as datetime
                try:
                    from datetime import datetime
                    datetime.fromisoformat(next_trigger.replace('Z', '+00:00'))
                except ValueError as e:
                    errors.append(f"next_trigger is not valid ISO datetime: {e}")
    
    # Validate next_slot
    if "next_slot" in attrs:
        next_slot = attrs["next_slot"]
        if next_slot is not None and not isinstance(next_slot, int):
            errors.append(f"next_slot must be an integer, got: {type(next_slot)}")
    
    # Validate actions
    if "actions" in attrs:
        actions = attrs["actions"]
        if not isinstance(actions, list):
            errors.append(f"actions must be a list, got: {type(actions)}")
        else:
            # Validate each action
            for idx, action in enumerate(actions):
                action_errors = validate_action(action, idx)
                errors.extend(action_errors)
            
            # Check next_slot is valid index
            next_slot = attrs.get("next_slot")
            if next_slot is not None:
                if next_slot < 0 or next_slot >= len(actions):
                    errors.append(f"next_slot ({next_slot}) is out of range for actions list (length {len(actions)})")
    
    # Validate next_entries (fallback format)
    if "next_entries" in attrs:
        next_entries = attrs["next_entries"]
        if not isinstance(next_entries, list):
            warnings.append(f"next_entries should be a list, got: {type(next_entries)}")
        else:
            for idx, entry in enumerate(next_entries):
                entry_errors = validate_next_entry(entry, idx)
                errors.extend(entry_errors)
    
    # Check optional attributes
    if "entities" in attrs:
        entities = attrs["entities"]
        if not isinstance(entities, list):
            warnings.append(f"entities should be a list, got: {type(entities)}")
        elif len(entities) == 0:
            warnings.append("entities list is empty")
    
    if "schedule_mode" in attrs:
        schedule_mode = attrs["schedule_mode"]
        if schedule_mode not in ["all_days", "5/2", "individual"]:
            warnings.append(f"Unexpected schedule_mode: {schedule_mode}")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "attributes_found": list(attrs.keys()),
        "state": state.state,
    }


def validate_all_schedulers(hass):
    """Validate all scheduler entities in the system."""
    results = {}
    
    # Find all scheduler switches
    for entity_id in hass.states.async_entity_ids('switch'):
        if entity_id.startswith('switch.schedule_'):
            results[entity_id] = validate_scheduler_entity(hass, entity_id)
    
    return results


# For use in Home Assistant Template editor:
TEMPLATE_VALIDATION = """
{%- set schedulers = states.switch | selectattr('entity_id', 'match', 'switch.schedule_.*') | list -%}
Found {{ schedulers | length }} scheduler entities:

{% for scheduler in schedulers -%}
{{ scheduler.entity_id }}:
  State: {{ scheduler.state }}
  next_trigger: {{ scheduler.attributes.next_trigger }}
  next_slot: {{ scheduler.attributes.next_slot }}
  actions: {{ scheduler.attributes.actions | length }} items
  entities: {{ scheduler.attributes.entities | join(', ') }}
  
  {%- if scheduler.attributes.next_slot is not none and scheduler.attributes.actions | length > 0 -%}
  Next action: {{ scheduler.attributes.actions[scheduler.attributes.next_slot] }}
  {%- endif %}
  
{% endfor %}
"""


# Example Python script for Home Assistant Scripts integration:
SCRIPT_EXAMPLE = """
# Add this as a script in configuration.yaml or use Developer Tools -> Scripts

validate_schedulers:
  alias: "Validate Scheduler Format"
  sequence:
    - service: system_log.write
      data:
        message: >
          {%- set schedulers = states.switch | selectattr('entity_id', 'match', 'switch.schedule_.*') | list -%}
          Validating {{ schedulers | length }} scheduler entities...
          
          {% for scheduler in schedulers -%}
          {{ scheduler.entity_id }}:
            State: {{ scheduler.state }}
            Has next_trigger: {{ scheduler.attributes.next_trigger is not none }}
            Has next_slot: {{ scheduler.attributes.next_slot is not none }}
            Has actions: {{ scheduler.attributes.actions | length > 0 }}
            Has next_entries: {{ scheduler.attributes.next_entries | length > 0 }}
          
          {% endfor %}
        level: info
"""


if __name__ == "__main__":
    print("This script is meant to be run inside Home Assistant.")
    print("\nTo validate your scheduler entities:")
    print("1. Copy the TEMPLATE_VALIDATION template above")
    print("2. Paste it in Developer Tools -> Template")
    print("3. Check the output for each scheduler entity")
    print("\nOr use the validate_scheduler_entity() function in a Python script.")
