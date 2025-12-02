"""Coordinator for Climate Scheduler."""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.const import ATTR_TEMPERATURE

from .const import DOMAIN, TEMP_THRESHOLD
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
            _LOGGER.info(f"Current time: {current_time}")
            entities = await self.storage.async_get_all_entities()
            _LOGGER.info(f"Found {len(entities)} entities with schedules: {entities}")
            
            results = {}
            
            for entity_id in entities:
                _LOGGER.info(f"Processing entity: {entity_id}")
                # Check if entity is enabled
                if not await self.storage.async_is_enabled(entity_id):
                    _LOGGER.debug(f"Skipping disabled entity {entity_id}")
                    continue
                
                _LOGGER.info(f"{entity_id} is enabled")
                # Get schedule
                schedule_data = await self.storage.async_get_schedule(entity_id)
                _LOGGER.info(f"{entity_id} schedule data: {schedule_data}")
                if not schedule_data or "nodes" not in schedule_data:
                    _LOGGER.debug(f"No schedule nodes for {entity_id}")
                    continue
                
                nodes = schedule_data["nodes"]
                _LOGGER.info(f"{entity_id} has {len(nodes)} nodes")
                
                # Get active node (includes temp and other settings)
                active_node = self.storage.get_active_node(nodes, current_time)
                if not active_node:
                    _LOGGER.debug(f"No active node for {entity_id}")
                    continue
                    
                target_temp = active_node["temp"]
                _LOGGER.info(f"{entity_id} active node: {active_node}")
                
                # Create a state signature for the node (temp + modes)
                node_signature = {
                    "temp": target_temp,
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
                if target_hvac_mode == "off" and target_hvac_mode in hvac_modes:
                    _LOGGER.info(f"Turning off {entity_id}")
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
                    # Update to new node temperature
                    _LOGGER.info(
                        f"Updating {entity_id} to new node: temp={target_temp}°C"
                    )
                    
                    # Build service data
                    service_data = {
                        "entity_id": entity_id,
                        ATTR_TEMPERATURE: target_temp,
                    }
                    
                    # Call climate service to set temperature
                    await self.hass.services.async_call(
                        "climate",
                        "set_temperature",
                        service_data,
                        blocking=True,
                    )
                    
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
