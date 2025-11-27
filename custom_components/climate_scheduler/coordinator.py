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
        self.last_node_temps = {}  # Track last node temperature for each entity

    async def force_update_all(self) -> None:
        """Force update all thermostats to their scheduled temperatures."""
        _LOGGER.info("Force updating all thermostats to scheduled temperatures")
        # Clear last node temps to force updates
        self.last_node_temps.clear()
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
                
                # Check if we've transitioned to a new node
                last_temp = self.last_node_temps.get(entity_id)
                if last_temp == target_temp:
                    # Still on same node, don't override manual changes
                    _LOGGER.debug(f"{entity_id} still on same node ({target_temp}°C), skipping")
                    results[entity_id] = {
                        "updated": False,
                        "target_temp": target_temp,
                        "reason": "same_node"
                    }
                    continue
                
                # Node has changed, update the temperature and settings
                _LOGGER.info(f"{entity_id} node changed: {last_temp}°C -> {target_temp}°C")
                self.last_node_temps[entity_id] = target_temp
                
                # Get current state
                state = self.hass.states.get(entity_id)
                if state is None:
                    _LOGGER.warning(f"Entity {entity_id} not found")
                    continue
                
                _LOGGER.info(f"{entity_id} state found: {state.state}")
                # Get current target temperature
                current_target = state.attributes.get("temperature")
                _LOGGER.info(f"{entity_id} current target: {current_target}°C")
                
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
                
                # Apply HVAC mode if specified in node
                if "hvac_mode" in active_node:
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
                
                # Apply fan mode if specified in node
                if "fan_mode" in active_node:
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
                
                # Apply swing mode if specified in node
                if "swing_mode" in active_node:
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
                
                # Apply preset mode if specified in node
                if "preset_mode" in active_node:
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
                
                results[entity_id] = {
                    "updated": True,
                    "target_temp": target_temp,
                    "previous_temp": current_target,
                }
            
            return results
            
        except Exception as err:
            _LOGGER.error(f"Error updating heating schedules: {err}")
            raise UpdateFailed(f"Error updating heating schedules: {err}")
