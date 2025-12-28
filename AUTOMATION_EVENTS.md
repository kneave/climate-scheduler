# Automation Events

The Climate Scheduler integration fires events whenever schedule nodes are activated, allowing you to trigger custom automations.

## Event Type

**Event Name:** `climate_scheduler_node_activated`

This event is fired whenever:
- A scheduled node transition occurs (scheduled time reached)
- A node is manually advanced using the `climate_scheduler.advance_to_next_node` service

## Event Data

The event includes the following data:

| Field | Type | Description |
|-------|------|-------------|
| `entity_id` | string | The climate entity that was updated (e.g., `climate.bedroom`) |
| `group_name` | string | The group name this entity belongs to |
| `day` | string | Day of the week (`mon`, `tue`, `wed`, etc.) |
| `trigger_type` | string | Either `scheduled` or `manual_advance` |
| `node` | object | Details about the activated node |
| `node.time` | string | Time of the node (e.g., `07:00`) |
| `node.temp` | number | Target temperature (after clamping) |
| `node.hvac_mode` | string | HVAC mode (`heat`, `cool`, `off`, etc.) |
| `node.fan_mode` | string | Fan mode (if set) |
| `node.swing_mode` | string | Swing mode (if set) |
| `node.preset_mode` | string | Preset mode (if set) |
| `previous_node` | object | Previous node state (only for `scheduled` triggers) |

## Example Automations

### 1. Notify When Morning Heating Starts

```yaml
automation:
  - alias: "Notify Morning Heating"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          entity_id: climate.bedroom
          node:
            time: "07:00"
          trigger_type: scheduled
    action:
      - service: notify.mobile_app
        data:
          title: "Morning Heating"
          message: "Bedroom heating activated: {{ trigger.event.data.node.temp }}°C"
```

### 2. Turn On Lights When Heating Activates

```yaml
automation:
  - alias: "Morning Routine - Lights with Heating"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          entity_id: climate.living_room
          trigger_type: scheduled
    condition:
      - condition: template
        value_template: "{{ trigger.event.data.node.time == '06:30' }}"
      - condition: state
        entity_id: sun.sun
        state: "below_horizon"
    action:
      - service: light.turn_on
        target:
          entity_id: light.living_room
        data:
          brightness_pct: 30
```

### 3. Log All Node Activations

```yaml
automation:
  - alias: "Log All Climate Schedule Changes"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
    action:
      - service: logbook.log
        data:
          name: "Climate Schedule"
          message: >
            {{ trigger.event.data.entity_id }} changed to 
            {{ trigger.event.data.node.temp }}°C 
            ({{ trigger.event.data.trigger_type }})
```

### 4. React to Manual Advances Only

```yaml
automation:
  - alias: "Manual Schedule Override Alert"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          trigger_type: manual_advance
    action:
      - service: notify.home_assistant
        data:
          title: "Schedule Manually Advanced"
          message: >
            {{ trigger.event.data.entity_id }} manually advanced to next node
            ({{ trigger.event.data.node.time }}: {{ trigger.event.data.node.temp }}°C)
```

### 5. Boost Fan When Temperature Increases

```yaml
automation:
  - alias: "Boost Bathroom Fan on Heat Increase"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          entity_id: climate.bathroom
          trigger_type: scheduled
    condition:
      - condition: template
        value_template: >
          {% set prev = trigger.event.data.previous_node %}
          {% set curr = trigger.event.data.node %}
          {{ prev is not none and curr.temp > prev.temp }}
    action:
      - service: fan.turn_on
        target:
          entity_id: fan.bathroom_exhaust
```

### 6. Trigger Different Actions by Group

```yaml
automation:
  - alias: "Upstairs Heating Activated"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          group_name: "Upstairs Bedrooms"
          trigger_type: scheduled
    action:
      - service: notify.mobile_app
        data:
          message: "Upstairs heating schedule activated"
```

### 7. Weekend Morning Routine

```yaml
automation:
  - alias: "Weekend Lazy Morning"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          entity_id: climate.bedroom
          trigger_type: scheduled
    condition:
      - condition: time
        weekday:
          - sat
          - sun
      - condition: template
        value_template: "{{ trigger.event.data.node.time == '08:00' }}"
    action:
      - service: scene.turn_on
        target:
          entity_id: scene.weekend_morning
```

## Tips

1. **Use Templates**: Access event data with `{{ trigger.event.data.field_name }}`
2. **Filter by Entity**: Use `event_data.entity_id` to target specific thermostats
3. **Filter by Time**: Check `event_data.node.time` for specific schedule times
4. **Filter by Trigger Type**: Use `event_data.trigger_type` to distinguish scheduled vs manual changes
5. **Compare Nodes**: Use `previous_node` (when available) to detect temperature increases/decreases

## Debugging

To see all events being fired, enable debug logging:

```yaml
logger:
  default: info
  logs:
    custom_components.climate_scheduler: debug
```

Or use Developer Tools > Events in Home Assistant and listen for `climate_scheduler_node_activated` events.
