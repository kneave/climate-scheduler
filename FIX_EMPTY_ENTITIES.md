# Fixing Empty Entities in Switch Schedulers

## Problem

Your scheduler switch entities show `entities: []` (empty list), which causes the `actions` array to be empty as well. This happens when the group data doesn't have the climate entities properly registered.

## Quick Fix

### Option 1: Via Developer Tools (Recommended)

1. Go to **Developer Tools** → **Services**
2. Select service: `climate_scheduler.reload_integration`
3. Click **Call Service**

This will reload the integration and should properly populate the entities lists.

### Option 2: Check Storage File

The issue is in your storage file. Check `.storage/climate_scheduler.storage` and look for groups with empty entities:

```json
{
  "groups": {
    "Bathroom": {
      "entities": [],  // ← This should have ["climate.bathroom"]
      "enabled": true,
      ...
    }
  }
}
```

The group name "Bathroom" should have been created as `__entity_climate.bathroom` (for single-entity groups) or should have the entity added to it.

### Option 3: Manual Fix via Service Call

Call the service to recreate the group properly:

```yaml
service: climate_scheduler.add_to_group
data:
  schedule_id: "Bathroom"  # Your group name
  entity_id: "climate.bathroom"  # The climate entity that should be in this group
```

## Why This Happened

This occurs when:
1. Groups were created without entities
2. The migration from old entity structure didn't properly populate the entities list
3. Manual group creation without adding entities

## Verification

After fixing, check the switch entity attributes again in **Developer Tools** → **States**:

```yaml
# Before (broken):
entities: []
actions: []

# After (fixed):
entities: ["climate.bathroom"]
actions:
  - entity_id: climate.bathroom
    service: climate.set_temperature
    data:
      temperature: 19
```

## Prevention

The switch platform has been updated to:
1. Automatically derive the entity from the group name for single-entity groups
2. Populate actions even if entities list is temporarily empty (using "unknown" as placeholder)
3. Log warnings when entities list is empty

## Automated Fix Script

Run this in Home Assistant scripts:

```yaml
fix_scheduler_entities:
  alias: Fix Scheduler Empty Entities
  sequence:
    # Reload the integration
    - service: climate_scheduler.reload_integration
    
    # Wait for reload
    - delay:
        seconds: 2
    
    # Verify fix
    - service: system_log.write
      data:
        message: >
          {% set schedulers = states.switch 
             | selectattr('entity_id', 'match', 'switch.schedule_.*') 
             | list %}
          Scheduler entities status:
          {% for s in schedulers %}
          - {{ s.entity_id }}: {{ s.attributes.entities | length }} entities
          {% endfor %}
        level: info
```

## Long-term Solution

The code has been updated to handle this gracefully:
- If `entities` is empty and it's a single-entity group (name starts with `__entity_`), the entity is derived from the group name
- Actions are still populated even with empty entities (using "unknown" placeholder)
- Old switch entities without token suffixes are automatically cleaned up on integration reload
