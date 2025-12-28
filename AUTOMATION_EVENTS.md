# Automation Events

The Climate Scheduler integration fires events whenever schedule nodes are activated, allowing you to trigger custom automations.

## Event Type

**Event Name:** `climate_scheduler_node_activated`

This event is fired whenever:
- A scheduled node transition occurs (scheduled time reached)
- A node is manually advanced using the `climate_scheduler.advance_to_next_node` service

## Virtual Schedules (Event-Only Mode)

You can create groups with **no member entities** to run "virtual schedules" that only fire events without controlling any climate devices. This is useful for:
- Custom time-based automations that don't directly control HVAC
- Triggering complex multi-device scenarios at scheduled times
- Synchronizing non-climate devices with your heating schedule
- Using the scheduler's graphical interface for any time-based automation

When a virtual schedule activates:
- `entity_id` will be `null` in the event data
- Only the `climate_scheduler_node_activated` event is fired
- No climate entities are modified
- The `group_name` field identifies which virtual schedule fired the event

## "No Change" Temperature Feature

You can set a node's temperature to `null` (or check the "No Change" box in the UI) to indicate that the temperature should **not be changed** when that node activates. This is useful for:
- Turning off heating at a certain time without changing the temperature setpoint
- Switching HVAC modes (heat/cool) without changing temperature
- Adjusting fan or swing modes while keeping the current temperature

When a node has "no change" temperature:
- `node.temp` will be `null` in the event data
- Only HVAC mode, fan mode, swing mode, and preset mode will be applied
- The thermostat's current temperature setpoint remains unchanged

## Custom Node Values

Each node can store three optional numerical values (fields `A`, `B`, and `C`) that are passed through to the event. These can be used to pass custom parameters to your automations, such as:
- Light brightness levels
- Fan speeds
- Durations or delays
- Any other numerical parameters your automations need

## Event Data

The event includes the following data:

| Field | Type | Description |
|-------|------|-------------|
| `entity_id` | string or null | The climate entity that was updated (e.g., `climate.bedroom`), or `null` for virtual schedules |
| `group_name` | string | The group name this entity belongs to |
| `day` | string | Day of the week (`mon`, `tue`, `wed`, etc.) |
| `trigger_type` | string | Either `scheduled` or `manual_advance` |
| `node` | object | Details about the activated node |
| `node.time` | string | Time of the node (e.g., `07:00`) |
| `node.temp` | number or null | Target temperature (after clamping), or `null` for "no change" |
| `node.hvac_mode` | string | HVAC mode (`heat`, `cool`, `off`, etc.) |
| `node.fan_mode` | string | Fan mode (if set) |
| `node.swing_mode` | string | Swing mode (if set) |
| `node.preset_mode` | string | Preset mode (if set) |
| `node.A` | number or null | Custom value A (optional) |
| `node.B` | number or null | Custom value B (optional) |
| `node.C` | number or null | Custom value C (optional) |
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

### 8. React to Mode Changes Without Temperature Change

```yaml
automation:
  - alias: "HVAC Mode Changed (No Temp Change)"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
    condition:
      - condition: template
        value_template: "{{ trigger.event.data.node.temp is none }}"
    action:
      - service: logbook.log
        data:
          name: "Climate Scheduler"
          message: >
            {{ trigger.event.data.entity_id }} changed mode to 
            {{ trigger.event.data.node.hvac_mode }} without changing temperature
```

### 9. Virtual Schedule - Control Lights Based on Schedule

```yaml
automation:
  - alias: "Living Room Lights from Virtual Schedule"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          group_name: "Living Room Lighting Schedule"
          trigger_type: scheduled
    condition:
      - condition: template
        value_template: "{{ trigger.event.data.entity_id is none }}"  # Virtual schedule
    action:
      - service: light.turn_on
        target:
          entity_id: light.living_room
        data:
          brightness_pct: "{{ trigger.event.data.node['A'] | int }}"  # Use custom value A for brightness
          color_temp: "{{ trigger.event.data.node['B'] | int }}"      # Use custom value B for color temp
```

### 10. Use Custom Values for Complex Automations

```yaml
automation:
  - alias: "Multi-Zone Control with Custom Values"
    trigger:
      - platform: event
        event_type: climate_scheduler_node_activated
        event_data:
          group_name: "Home Comfort Schedule"
          trigger_type: scheduled
    action:
      # Value A: Fan speed (0-100)
      - service: fan.set_percentage
        target:
          entity_id: fan.whole_house
        data:
          percentage: "{{ trigger.event.data.node['A'] | default(50) }}"
      
      # Value B: Humidifier target (30-60%)
      - service: humidifier.set_humidity
        target:
          entity_id: humidifier.bedroom
        data:
          humidity: "{{ trigger.event.data.node['B'] | default(45) }}"
      
      # Value C: Light scene number
      - service: scene.turn_on
        target:
          entity_id: "scene.comfort_{{ trigger.event.data.node['C'] | default(1) }}"
```

## Use Cases

### "No Change" Temperature
1. **Turn off at bedtime**: Set a node at 23:00 with `temp: null` and `hvac_mode: off` to turn off heating without affecting the temperature setpoint
2. **Switch modes seasonally**: Change from `heat` to `cool` mode at a specific time without modifying temperature
3. **Fan boost periods**: Increase fan speed during certain hours while maintaining current temperature
4. **Preset changes**: Switch to eco/away preset during work hours without temperature changes

### Virtual Schedules (No Entities)
1. **Lighting automation**: Use the graphical scheduler to control lights throughout the day
2. **Multi-device scenarios**: Coordinate multiple non-climate devices at scheduled times
3. **Notification schedules**: Trigger reminders or alerts at specific times
4. **Scene activation**: Switch between different home scenes on a schedule

### Custom Values
1. **Brightness levels**: Store target brightness for lights in custom value A
2. **Fan speeds**: Store fan percentage in custom value B
3. **Scene numbers**: Reference different scenes with custom value C
4. **Durations**: Store how long an action should last
5. **Thresholds**: Store custom trigger thresholds for conditional logic

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
