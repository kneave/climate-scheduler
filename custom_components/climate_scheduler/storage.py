"""Storage management for Climate Scheduler."""
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, time

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_VERSION, STORAGE_KEY, DEFAULT_SCHEDULE

_LOGGER = logging.getLogger(__name__)


class ScheduleStorage:
    """Handle storage of heating schedules."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize storage."""
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: Dict[str, Any] = {}

    async def async_load(self) -> None:
        """Load data from storage."""
        data = await self._store.async_load()
        if data is None:
            self._data = {"entities": {}}
        else:
            self._data = data
        _LOGGER.debug(f"Loaded schedule data: {self._data}")

    async def async_save(self) -> None:
        """Save data to storage."""
        await self._store.async_save(self._data)
        _LOGGER.debug(f"Saved schedule data: {self._data}")

    async def async_get_all_entities(self) -> List[str]:
        """Get list of all entity IDs with schedules."""
        return list(self._data.get("entities", {}).keys())

    async def async_get_schedule(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Get schedule for an entity."""
        return self._data.get("entities", {}).get(entity_id)

    async def async_set_schedule(self, entity_id: str, nodes: List[Dict[str, Any]]) -> None:
        """Set schedule nodes for an entity."""
        if "entities" not in self._data:
            self._data["entities"] = {}
        
        if entity_id not in self._data["entities"]:
            self._data["entities"][entity_id] = {
                "enabled": True,
                "nodes": nodes
            }
        else:
            self._data["entities"][entity_id]["nodes"] = nodes
        
        await self.async_save()

    async def async_add_entity(self, entity_id: str) -> None:
        """Add a new entity with default schedule."""
        if "entities" not in self._data:
            self._data["entities"] = {}
        
        if entity_id not in self._data["entities"]:
            self._data["entities"][entity_id] = {
                "enabled": True,
                "nodes": DEFAULT_SCHEDULE.copy()
            }
            await self.async_save()
            _LOGGER.info(f"Added entity {entity_id} with default schedule")

    async def async_remove_entity(self, entity_id: str) -> None:
        """Remove an entity and its schedule."""
        if entity_id in self._data.get("entities", {}):
            del self._data["entities"][entity_id]
            await self.async_save()
            _LOGGER.info(f"Removed entity {entity_id}")

    async def async_set_enabled(self, entity_id: str, enabled: bool) -> None:
        """Enable or disable scheduling for an entity."""
        if entity_id in self._data.get("entities", {}):
            self._data["entities"][entity_id]["enabled"] = enabled
            await self.async_save()
            _LOGGER.info(f"Set {entity_id} enabled={enabled}")

    async def async_is_enabled(self, entity_id: str) -> bool:
        """Check if scheduling is enabled for an entity."""
        entity_data = self._data.get("entities", {}).get(entity_id)
        if entity_data is None:
            return False
        return entity_data.get("enabled", False)

    def interpolate_temperature(self, nodes: List[Dict[str, Any]], current_time: time) -> float:
        """Calculate temperature at a given time using step function (hold until next node)."""
        if not nodes:
            return 18.0  # Default fallback
        
        # Sort nodes by time
        sorted_nodes = sorted(nodes, key=lambda n: self._time_to_minutes(n["time"]))
        
        # Convert current time to minutes since midnight
        current_minutes = current_time.hour * 60 + current_time.minute
        
        # Find the active node (most recent node before or at current time)
        active_node = None
        
        for node in sorted_nodes:
            node_minutes = self._time_to_minutes(node["time"])
            if node_minutes <= current_minutes:
                active_node = node
            else:
                break
        
        # If no node found before current time, use last node from previous day (wrap around)
        if active_node is None:
            active_node = sorted_nodes[-1]
        
        return active_node["temp"]

    def get_active_node(self, nodes: List[Dict[str, Any]], current_time: time) -> Optional[Dict[str, Any]]:
        """Get the active node at a given time."""
        if not nodes:
            return None
        
        # Sort nodes by time
        sorted_nodes = sorted(nodes, key=lambda n: self._time_to_minutes(n["time"]))
        
        # Convert current time to minutes since midnight
        current_minutes = current_time.hour * 60 + current_time.minute
        
        # Find the active node (most recent node before or at current time)
        active_node = None
        
        for node in sorted_nodes:
            node_minutes = self._time_to_minutes(node["time"])
            if node_minutes <= current_minutes:
                active_node = node
            else:
                break
        
        # If no node found before current time, use last node from previous day (wrap around)
        if active_node is None:
            active_node = sorted_nodes[-1]
        
        return active_node

    @staticmethod
    def _time_to_minutes(time_str: str) -> int:
        """Convert HH:MM string to minutes since midnight."""
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        return hours * 60 + minutes
