"""Coordinator for Climate Scheduler."""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.const import ATTR_TEMPERATURE

from .const import DOMAIN, TEMP_THRESHOLD, MIN_TEMP, MAX_TEMP
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)


class HeatingSchedulerCoordinator(DataUpdateCoordinator):
    """Coordinator to manage heating schedule updates."""

    def __init__(
        self,
        hass: HomeAssistant,
        storage: ScheduleStorage,
        update_interval: timedelta,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=update_interval,
        )
        self.storage = storage
        self.last_node_states = {}  # Track last node state (temp + modes) for each entity

    async def force_update_all(self) -> None:
        """Force update all thermostats to their scheduled temperatures."""
        _LOGGER.info("Force updating all thermostats to scheduled temperatures")
        # Clear last node temps to force updates
        self.last_node_states.clear()
        # Trigger immediate refresh
        await self.async_request_refresh()

    async def _async_update_data(self) -> Dict[str, Any]:
        """Update heating schedules."""
        _LOGGER.info("=== COORDINATOR UPDATE CYCLE START ===")
        try:
            current_time = datetime.now().time()
            current_day = datetime.now().strftime('%a').lower()  # Get day: mon, tue, wed, etc.
            _LOGGER.info(f"Current time: {current_time}, day: {current_day}")
            # Load global settings (min/max temps)
            try:
                settings = await self.storage.async_get_settings()
            except Exception:
                settings = {}
            min_temp = settings.get("min_temp", MIN_TEMP)
            max_temp = settings.get("max_temp", MAX_TEMP)

            # Get all groups and build a map of entities to their enabled group schedules
            groups = await self.storage.async_get_groups()
            entity_group_schedules = {}  # Maps entity_id -> (group_name, schedule_data)
            groups_migrated = False
            
            for group_name, group_data in groups.items():
                # Migrate existing groups - add enabled=True if missing
                if "enabled" not in group_data:
                    group_data["enabled"] = True
                    groups_migrated = True
                    _LOGGER.info(f"Migrated group '{group_name}' - added enabled=True")
                
                if not group_data.get("enabled", True):
                    _LOGGER.debug(f"Skipping disabled group '{group_name}'")
                    continue
                
                # Get group schedule for current day
                group_schedule = await self.storage.async_get_group_schedule(group_name, current_day)
                if group_schedule and "nodes" in group_schedule:
                    # Map all entities in this group to this schedule
                    for entity_id in group_data.get("entities", []):
                        entity_group_schedules[entity_id] = (group_name, group_schedule)
                        _LOGGER.info(f"{entity_id} will use enabled group '{group_name}' schedule")
            
            # Save storage if any groups were migrated
            if groups_migrated:
                await self.storage.async_save()
                _LOGGER.info("Saved migrated group data")
            
            entities = await self.storage.async_get_all_entities()
            _LOGGER.info(f"Found {len(entities)} entities with schedules: {entities}")
            
            # Migrate entities - add enabled=True if missing
            entities_migrated = False
            for entity_id in entities:
                entity_data = self.storage._data.get("entities", {}).get(entity_id)
                if entity_data and "enabled" not in entity_data:
                    entity_data["enabled"] = True
                    entities_migrated = True
                    _LOGGER.info(f"Migrated entity '{entity_id}' - added enabled=True")
            
            if entities_migrated:
                await self.storage.async_save()
                _LOGGER.info("Saved migrated entity data")
            
            results = {}
            
            for entity_id in entities:
                _LOGGER.info(f"Processing entity: {entity_id}")
                
                # Check if entity is in an enabled group - if so, use group schedule instead
                if entity_id in entity_group_schedules:
                    group_name, schedule_data = entity_group_schedules[entity_id]
                    _LOGGER.info(f"{entity_id} using group '{group_name}' schedule")
                else:
                    # Check if individual entity schedule is enabled
                    if not await self.storage.async_is_enabled(entity_id):
                        _LOGGER.debug(f"Skipping disabled entity {entity_id}")
                        continue
                    
                    # Get individual schedule for current day
                    schedule_data = await self.storage.async_get_schedule(entity_id, current_day)
                
                _LOGGER.info(f"{entity_id} schedule data for {current_day}: {schedule_data}")
                if not schedule_data or "nodes" not in schedule_data:
                    _LOGGER.debug(f"No schedule nodes for {entity_id}")
                    continue
                
                nodes = schedule_data["nodes"]
                _LOGGER.info(f"{entity_id} has {len(nodes)} nodes for {current_day}")
                
                # Get active node (includes temp and other settings)
                active_node = self.storage.get_active_node(nodes, current_time)
                if not active_node:
                    _LOGGER.debug(f"No active node for {entity_id}")
                    continue
                    
                target_temp = active_node["temp"]
                _LOGGER.info(f"{entity_id} active node: {active_node}")
                
                # Clamp target temp to global min/max BEFORE creating signature
                # This prevents infinite update loops where unclamped signature differs from clamped output
                clamped_temp = target_temp
                if target_temp < min_temp:
                    clamped_temp = min_temp
                    _LOGGER.debug(f"Clamping {entity_id} target {target_temp} -> {clamped_temp}")
                elif target_temp > max_temp:
                    clamped_temp = max_temp
                    _LOGGER.debug(f"Clamping {entity_id} target {target_temp} -> {clamped_temp}")
                
                # Create a state signature for the node using CLAMPED temp + modes
                node_signature = {
                    "temp": clamped_temp,
                    "hvac_mode": active_node.get("hvac_mode"),
                    "fan_mode": active_node.get("fan_mode"),
                    "swing_mode": active_node.get("swing_mode"),
                    "preset_mode": active_node.get("preset_mode"),
                }
                
                # Check if we've transitioned to a new node
                last_node = self.last_node_states.get(entity_id)
                if last_node == node_signature:
                    # Still on same node, don't override manual changes
                    _LOGGER.debug(f"{entity_id} still on same node, skipping")
                    results[entity_id] = {
                        "updated": False,
                        "target_temp": target_temp,
                        "reason": "same_node"
                    }
                    continue
                
                # Node has changed, update the temperature and settings
                _LOGGER.info(f"{entity_id} node changed: {last_node} -> {node_signature}")
                self.last_node_states[entity_id] = node_signature
                
                # Get current state
                state = self.hass.states.get(entity_id)
                if state is None:
                    _LOGGER.warning(f"Entity {entity_id} not found")
                    continue
                
                _LOGGER.info(f"{entity_id} state found: {state.state}")
                # Get current target temperature
                current_target = state.attributes.get("temperature")
                _LOGGER.info(f"{entity_id} current target: {current_target}°C")
                
                # Get entity capabilities
                supported_features = state.attributes.get("supported_features", 0)
                hvac_modes = state.attributes.get("hvac_modes", [])
                fan_modes = state.attributes.get("fan_modes", [])
                swing_modes = state.attributes.get("swing_modes", [])
                preset_modes = state.attributes.get("preset_modes", [])
                
                # Check if we're turning off - if so, skip temperature and just turn off
                target_hvac_mode = active_node.get("hvac_mode")
                _LOGGER.info(f"{entity_id} target_hvac_mode: {target_hvac_mode}, supported modes: {hvac_modes}")
                if target_hvac_mode == "off":
                    _LOGGER.info(f"Turning off {entity_id}")
                    # Try using turn_off service first (more reliable for some integrations)
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "turn_off",
                            {
                                "entity_id": entity_id,
                            },
                            blocking=True,
                        )
                    except Exception as e:
                        # Fallback to set_hvac_mode if turn_off not supported
                        _LOGGER.debug(f"turn_off failed for {entity_id}, trying set_hvac_mode: {e}")
                        if "off" in hvac_modes:
                            await self.hass.services.async_call(
                                "climate",
                                "set_hvac_mode",
                                {
                                    "entity_id": entity_id,
                                    "hvac_mode": "off",
                                },
                                blocking=True,
                            )
                else:
                    # Update to new node temperature (already clamped in signature)
                    _LOGGER.info(
                        f"Updating {entity_id} to new node: temp={clamped_temp}°C"
                    )

                    # Build service data
                    service_data = {
                        "entity_id": entity_id,
                        ATTR_TEMPERATURE: clamped_temp,
                    }

                    # Call climate service to set temperature (handle per-entity errors)
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_temperature",
                            service_data,
                            blocking=True,
                        )
                    except Exception as exc:
                        _LOGGER.error(f"Failed to set_temperature for {entity_id}: {exc}")
                        results[entity_id] = {
                            "updated": False,
                            "target_temp": target_temp,
                            "applied_temp": None,
                            "error": str(exc),
                        }
                        # Skip further actions for this entity
                        continue
                    
                    # Apply HVAC mode if specified in node and supported by entity (except off, handled above)
                    if "hvac_mode" in active_node and active_node["hvac_mode"] != "off" and active_node["hvac_mode"] in hvac_modes:
                        _LOGGER.info(f"Setting HVAC mode to {active_node['hvac_mode']}")
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {
                                "entity_id": entity_id,
                                "hvac_mode": active_node["hvac_mode"],
                            },
                            blocking=True,
                        )
                    elif "hvac_mode" in active_node and active_node["hvac_mode"] != "off":
                        _LOGGER.debug(f"HVAC mode {active_node['hvac_mode']} not supported by {entity_id}")
                
                # Apply fan mode if specified in node and supported by entity
                if "fan_mode" in active_node and fan_modes and active_node["fan_mode"] in fan_modes:
                    _LOGGER.info(f"Setting fan mode to {active_node['fan_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_fan_mode",
                        {
                            "entity_id": entity_id,
                            "fan_mode": active_node["fan_mode"],
                        },
                        blocking=True,
                    )
                elif "fan_mode" in active_node and fan_modes:
                    _LOGGER.debug(f"Fan mode {active_node['fan_mode']} not supported by {entity_id}")
                
                # Apply swing mode if specified in node and supported by entity
                if "swing_mode" in active_node and swing_modes and active_node["swing_mode"] in swing_modes:
                    _LOGGER.info(f"Setting swing mode to {active_node['swing_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_swing_mode",
                        {
                            "entity_id": entity_id,
                            "swing_mode": active_node["swing_mode"],
                        },
                        blocking=True,
                    )
                elif "swing_mode" in active_node and swing_modes:
                    _LOGGER.debug(f"Swing mode {active_node['swing_mode']} not supported by {entity_id}")
                
                # Apply preset mode if specified in node and supported by entity
                if "preset_mode" in active_node and preset_modes and active_node["preset_mode"] in preset_modes:
                    _LOGGER.info(f"Setting preset mode to {active_node['preset_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_preset_mode",
                        {
                            "entity_id": entity_id,
                            "preset_mode": active_node["preset_mode"],
                        },
                        blocking=True,
                    )
                elif "preset_mode" in active_node and preset_modes:
                    _LOGGER.debug(f"Preset mode {active_node['preset_mode']} not supported by {entity_id}")
                
                results[entity_id] = {
                    "updated": True,
                    "target_temp": target_temp,
                    "previous_temp": current_target,
                }
            
            return results
            
        except Exception as err:
            _LOGGER.error(f"Error updating heating schedules: {err}")
            raise UpdateFailed(f"Error updating heating schedules: {err}")
