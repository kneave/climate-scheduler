# Climate Scheduler Actions

This document describes all the services (actions) exposed by the Climate Scheduler integration for use in automations, scripts, and the Services developer tool.

## Table of Contents

- [Schedule Management](#schedule-management)
- [Profile Management](#profile-management)
- [Entity Management](#entity-management)
- [Schedule Control](#schedule-control)
- [Advanced Features](#advanced-features)
- [Settings Management](#settings-management)

---

## Schedule Management

### `climate_scheduler.set_schedule`

Configure temperature schedule for a climate entity.

**Parameters:**
- `schedule_id` (required): Schedule name (e.g., `Living Room`, `Upstairs`, `Bedrooms`)
- `nodes` (required): List of schedule nodes with time and temperature (e.g., `[{"time": "07:00", "temp": 21}, {"time": "23:00", "temp": 18}]`)
- `day` (optional): Day of week for this schedule - `all_days`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`, `weekday`, `weekend` (default: `all_days`)
- `schedule_mode` (optional): Schedule mode - `all_days`, `5/2`, `individual` (default: `all_days`)

**Example:**
```yaml
service: climate_scheduler.set_schedule
data:
  schedule_id: Living Room
  nodes:
    - time: "06:00"
      temp: 21
    - time: "08:00"
      temp: 18
    - time: "17:00"
      temp: 21
    - time: "22:00"
      temp: 18
  day: mon
  schedule_mode: individual
```

### `climate_scheduler.get_schedule`

Retrieve the current schedule for a climate entity.

**Parameters:**
- `schedule_id` (required): Climate entity ID to get schedule for

**Example:**
```yaml
service: climate_scheduler.get_schedule
data:
  schedule_id: Living Room
```

### `climate_scheduler.clear_schedule`

Remove the schedule for a climate entity.

**Parameters:**
- `schedule_id` (required): Climate entity ID to clear schedule for

**Example:**
```yaml
service: climate_scheduler.clear_schedule
data:
  schedule_id: Living Room
```

### `climate_scheduler.enable_schedule`

Enable automatic scheduling for a climate entity.

**Parameters:**
- `schedule_id` (required): Climate entity ID to enable

**Example:**
```yaml
service: climate_scheduler.enable_schedule
data:
  schedule_id: Living Room
```

### `climate_scheduler.disable_schedule`

Disable automatic scheduling for a climate entity.

**Parameters:**
- `schedule_id` (required): Climate entity ID to disable

**Example:**
```yaml
service: climate_scheduler.disable_schedule
data:
  schedule_id: Living Room
```

---

## Profile Management

Profiles allow you to create multiple schedule configurations and switch between them. Perfect for seasonal schedules, vacation modes, or different occupancy patterns.

### `climate_scheduler.create_profile`

Create a new schedule profile.

**Parameters:**
- `schedule_id` (required): Schedule name
- `profile_name` (required): Name for the new profile

**Example:**
```yaml
service: climate_scheduler.create_profile
data:
  schedule_id: Living Room
  profile_name: Winter Schedule
```

### `climate_scheduler.set_active_profile`

Switch to a different schedule profile. Use this in automations to change schedules based on conditions.

**Parameters:**
- `schedule_id` (required): Schedule name
- `profile_name` (required): Name of the profile to activate

**Example - Switch to winter schedule in autumn:**
```yaml
automation:
  - alias: "Switch to Winter Heating Schedule"
    trigger:
      - platform: time
        at: "00:00:00"
    condition:
      - condition: template
        value_template: "{{ now().month in [10, 11, 12, 1, 2, 3] }}"
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Living Room
          profile_name: Winter Schedule
```

**Example - Vacation mode:**
```yaml
automation:
  - alias: "Activate Vacation Profile"
    trigger:
      - platform: state
        entity_id: input_boolean.vacation_mode
        to: "on"
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Bedrooms
          profile_name: Vacation
```

### `climate_scheduler.rename_profile`

Rename a schedule profile.

**Parameters:**
- `schedule_id` (required): Schedule name
- `old_name` (required): Current name of the profile
- `new_name` (required): New name for the profile

**Example:**
```yaml
service: climate_scheduler.rename_profile
data:
  schedule_id: Living Room
  old_name: Winter Schedule
  new_name: Cold Weather Schedule
```

### `climate_scheduler.delete_profile`

Delete a schedule profile.

**Parameters:**
- `schedule_id` (required): Schedule name
- `profile_name` (required): Name of the profile to delete

**Example:**
```yaml
service: climate_scheduler.delete_profile
data:
  schedule_id: Living Room
  profile_name: Old Schedule
```

### `climate_scheduler.get_profiles`

Get list of all available profiles.

**Parameters:**
- `schedule_id` (required): Schedule name

**Example:**
```yaml
service: climate_scheduler.get_profiles
data:
  schedule_id: Living Room
```

---

## Schedule Management

All schedules in Climate Scheduler can control multiple climate entities.

### `climate_scheduler.create_group`

Create a new schedule.

**Parameters:**
- `schedule_id` (required): Name for the new schedule

**Example:**
```yaml
service: climate_scheduler.create_group
data:
  schedule_id: Bedrooms
```

### `climate_scheduler.delete_group`

Delete a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule to delete

**Example:**
```yaml
service: climate_scheduler.delete_group
data:
  schedule_id: Bedrooms
```

### `climate_scheduler.add_to_group`

Add a climate entity to a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule
- `entity_id` (required): Climate entity to add

**Example:**
```yaml
service: climate_scheduler.add_to_group
data:
  schedule_id: Bedrooms
  entity_id: climate.master_bedroom
```

### `climate_scheduler.remove_from_group`

Remove a climate entity from a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule
- `entity_id` (required): Climate entity to remove

**Example:**
```yaml
service: climate_scheduler.remove_from_group
data:
  schedule_id: Bedrooms
  entity_id: climate.master_bedroom
```

### `climate_scheduler.set_group_schedule`

Set the schedule for all climate entities in a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule
- `nodes` (required): List of schedule nodes
- `day` (optional): Day of week (default: `all_days`)
- `schedule_mode` (optional): Schedule mode (default: `all_days`)

**Example:**
```yaml
service: climate_scheduler.set_group_schedule
data:
  schedule_id: Bedrooms
  nodes:
    - time: "06:00"
      temp: 21
    - time: "22:00"
      temp: 18
```

### `climate_scheduler.enable_group`

Enable scheduling for all climate entities in a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule

**Example:**
```yaml
service: climate_scheduler.enable_group
data:
  schedule_id: Bedrooms
```

### `climate_scheduler.disable_group`

Disable scheduling for all climate entities in a schedule.

**Parameters:**
- `schedule_id` (required): Name of the schedule

**Example:**
```yaml
service: climate_scheduler.disable_group
data:
  schedule_id: Bedrooms
```

---

## Schedule Control

### `climate_scheduler.advance_schedule`

Manually advance a climate entity to its next scheduled temperature and settings, even if the scheduled time hasn't arrived yet.

**Parameters:**
- `schedule_id` (required): Climate entity ID to advance

**Example:**
```yaml
service: climate_scheduler.advance_schedule
data:
  schedule_id: Living Room
```

**Use case:** Press a button to skip ahead to nighttime temperature early.

### `climate_scheduler.advance_group`

Manually advance all climate entities in a group to their next scheduled temperature and settings.

**Parameters:**
- `schedule_id` (required): Name of the group to advance

**Example:**
```yaml
service: climate_scheduler.advance_group
data:
  schedule_id: Bedrooms
```

### `climate_scheduler.cancel_advance`

Cancel an active advance override and return the climate entity to its current scheduled settings.

**Parameters:**
- `schedule_id` (required): Climate entity ID to cancel advance for

**Example:**
```yaml
service: climate_scheduler.cancel_advance
data:
  schedule_id: Living Room
```

### `climate_scheduler.get_advance_status`

Check if a climate entity has an active advance override.

**Parameters:**
- `schedule_id` (required): Climate entity ID to check

**Example:**
```yaml
service: climate_scheduler.get_advance_status
data:
  schedule_id: Living Room
```

### `climate_scheduler.clear_advance_history`

Clear all advance history markers for a climate entity.

**Parameters:**
- `schedule_id` (required): Climate entity ID to clear history for

**Example:**
```yaml
service: climate_scheduler.clear_advance_history
data:
  schedule_id: Living Room
```

---

## Advanced Features

### `climate_scheduler.set_ignored`

Mark an entity as ignored (not monitored) or un-ignore it.

**Parameters:**
- `schedule_id` (required): Climate entity ID to set ignored status for
- `ignored` (required): Whether to ignore this entity (true) or monitor it (false)

**Example:**
```yaml
service: climate_scheduler.set_ignored
data:
  schedule_id: Guest Room
  ignored: true
```

---

## Settings Management

### `climate_scheduler.get_settings`

Retrieve global integration settings (min/max temp, default schedule, etc.).

**Example:**
```yaml
service: climate_scheduler.get_settings
```

### `climate_scheduler.save_settings`

Save global integration settings.

**Parameters:**
- `settings` (required): Settings object with min_temp, max_temp, defaultSchedule, tooltipMode, etc.

**Example:**
```yaml
service: climate_scheduler.save_settings
data:
  settings:
    min_temp: 10
    max_temp: 30
    defaultSchedule:
      - time: "06:00"
        temp: 21
      - time: "22:00"
        temp: 18
```

---

## Common Automation Examples

### Switch profiles based on season

```yaml
automation:
  - alias: "Summer Cooling Schedule"
    trigger:
      - platform: time
        at: "00:00:00"
    condition:
      - condition: template
        value_template: "{{ now().month in [6, 7, 8] }}"
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Living Room
          profile_name: Summer
          
  - alias: "Winter Heating Schedule"
    trigger:
      - platform: time
        at: "00:00:00"
    condition:
      - condition: template
        value_template: "{{ now().month in [12, 1, 2] }}"
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Living Room
          profile_name: Winter
```

### Disable heating when away

```yaml
automation:
  - alias: "Disable heating when away"
    trigger:
      - platform: state
        entity_id: person.homeowner
        to: "not_home"
        for: "01:00:00"
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: All Zones
          profile_name: Away
```

### Weekend vs Weekday profiles

```yaml
automation:
  - alias: "Switch to Weekend Profile"
    trigger:
      - platform: time
        at: "00:00:00"
    condition:
      - condition: time
        weekday:
          - sat
          - sun
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Living Room
          profile_name: Weekend
          
  - alias: "Switch to Weekday Profile"
    trigger:
      - platform: time
        at: "00:00:00"
    condition:
      - condition: time
        weekday:
          - mon
          - tue
          - wed
          - thu
          - fri
    action:
      - service: climate_scheduler.set_active_profile
        data:
          schedule_id: Living Room
          profile_name: Weekday
```

### Early bedtime button

```yaml
automation:
  - alias: "Early bedtime - advance to night schedule"
    trigger:
      - platform: event
        event_type: mobile_app_notification_action
        event_data:
          action: EARLY_BEDTIME
    action:
      - service: climate_scheduler.advance_schedule
        data:
          schedule_id: Bedroom
```
