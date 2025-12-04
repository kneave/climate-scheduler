"""Storage management for Climate Scheduler."""
import logging
import copy
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
            self._data = {"entities": {}, "groups": {}}
        else:
            self._data = data
            # Ensure groups key exists for backwards compatibility
            if "groups" not in self._data:
                self._data["groups"] = {}
            # Migrate old single-schedule format to new day-based format
            await self._migrate_to_day_schedules()
        _LOGGER.debug(f"Loaded schedule data: {self._data}")
    
    async def _migrate_to_day_schedules(self) -> None:
        """Migrate existing schedules to day-based format."""
        migrated = False
        for entity_id, entity_data in self._data.get("entities", {}).items():
            # Check if already in new format (has schedule_mode key)
            if "schedule_mode" not in entity_data:
                # Migrate from old format
                old_nodes = entity_data.get("nodes", [])
                entity_data["schedule_mode"] = "all_days"  # Default to all days
                entity_data["schedules"] = {
                    "all_days": old_nodes
                }
                # Remove old nodes key
                if "nodes" in entity_data:
                    del entity_data["nodes"]
                migrated = True
                _LOGGER.info(f"Migrated {entity_id} to day-based schedule format")
        
        # Migrate groups
        for group_name, group_data in self._data.get("groups", {}).items():
            if "schedule_mode" not in group_data:
                old_nodes = group_data.get("nodes", [])
                group_data["schedule_mode"] = "all_days"
                group_data["schedules"] = {
                    "all_days": old_nodes
                }
                if "nodes" in group_data:
                    del group_data["nodes"]
                migrated = True
                _LOGGER.info(f"Migrated group '{group_name}' to day-based schedule format")
        
        if migrated:
            await self.async_save()

    async def async_save(self) -> None:
        """Save data to storage."""
        await self._store.async_save(self._data)
        _LOGGER.debug(f"Saved schedule data: {self._data}")

    async def async_get_all_entities(self) -> List[str]:
        """Get list of all entity IDs with schedules."""
        return list(self._data.get("entities", {}).keys())

    async def async_get_schedule(self, entity_id: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get schedule for an entity. If day is specified, returns nodes for that day."""
        entity_data = self._data.get("entities", {}).get(entity_id)
        if not entity_data:
            return None
        
        # If no day specified, return the whole schedule structure
        if day is None:
            return entity_data
        
        # Return nodes for specific day based on schedule mode
        return {
            "nodes": self._get_nodes_for_day(entity_data, day),
            "enabled": entity_data.get("enabled", True),
            "schedule_mode": entity_data.get("schedule_mode", "all_days")
        }
    
    def _get_nodes_for_day(self, entity_data: Dict[str, Any], day: str) -> List[Dict[str, Any]]:
        """Get nodes for a specific day based on schedule mode."""
        schedule_mode = entity_data.get("schedule_mode", "all_days")
        schedules = entity_data.get("schedules", {})
        
        if schedule_mode == "all_days":
            return schedules.get("all_days", [])
        elif schedule_mode == "5/2":
            # If day is already weekday/weekend, use it directly
            if day in ["weekday", "weekend"]:
                return schedules.get(day, [])
            # Otherwise map individual days to weekday/weekend
            # Weekdays: mon, tue, wed, thu, fri -> "weekday"
            # Weekends: sat, sun -> "weekend"
            elif day in ["mon", "tue", "wed", "thu", "fri"]:
                return schedules.get("weekday", [])
            else:
                return schedules.get("weekend", [])
        elif schedule_mode == "individual":
            return schedules.get(day, [])
        
        return []

    async def async_set_schedule(self, entity_id: str, nodes: List[Dict[str, Any]], day: Optional[str] = None, schedule_mode: Optional[str] = None) -> None:
        """Set schedule nodes for an entity. Supports day-specific schedules."""
        if "entities" not in self._data:
            self._data["entities"] = {}
        
        if entity_id not in self._data["entities"]:
            self._data["entities"][entity_id] = {
                "enabled": True,
                "schedule_mode": schedule_mode or "all_days",
                "schedules": {}
            }
        
        entity_data = self._data["entities"][entity_id]
        
        # Update schedule mode if provided
        if schedule_mode is not None:
            entity_data["schedule_mode"] = schedule_mode
        
        # Ensure schedules dict exists
        if "schedules" not in entity_data:
            entity_data["schedules"] = {}
        
        # Set nodes for the appropriate day/mode
        current_mode = entity_data.get("schedule_mode", "all_days")
        
        if day is None:
            # No day specified - update the primary schedule based on mode
            if current_mode == "all_days":
                entity_data["schedules"]["all_days"] = nodes
            elif current_mode == "5/2":
                # If no day specified in 5/2 mode, update weekday by default
                entity_data["schedules"]["weekday"] = nodes
            else:
                # Individual mode - update Monday by default
                entity_data["schedules"]["mon"] = nodes
        else:
            # Specific day provided
            if current_mode == "5/2":
                # Map individual days to weekday/weekend, or use weekday/weekend directly
                if day == "weekday":
                    entity_data["schedules"]["weekday"] = nodes
                elif day == "weekend":
                    entity_data["schedules"]["weekend"] = nodes
                elif day in ["mon", "tue", "wed", "thu", "fri"]:
                    entity_data["schedules"]["weekday"] = nodes
                else:  # sat, sun
                    entity_data["schedules"]["weekend"] = nodes
            else:
                # Individual mode or all_days mode
                entity_data["schedules"][day] = nodes
        
        await self.async_save()

    async def async_add_entity(self, entity_id: str) -> None:
        """Add a new entity with default schedule."""
        if "entities" not in self._data:
            self._data["entities"] = {}
        
        if entity_id not in self._data["entities"]:
            self._data["entities"][entity_id] = {
                "enabled": True,
                "schedule_mode": "all_days",
                "schedules": {
                    "all_days": DEFAULT_SCHEDULE.copy()
                }
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

    # Group Management Methods

    async def async_create_group(self, group_name: str) -> None:
        """Create a new group."""
        if "groups" not in self._data:
            self._data["groups"] = {}
        
        if group_name in self._data["groups"]:
            raise ValueError(f"Group '{group_name}' already exists")
        
        self._data["groups"][group_name] = {
            "entities": [],
            "schedule_mode": "all_days",
            "schedules": {
                "all_days": [{"time": "00:00", "temp": 18}]
            }
        }
        await self.async_save()
        _LOGGER.info(f"Created group '{group_name}'")

    async def async_delete_group(self, group_name: str) -> None:
        """Delete a group."""
        if group_name in self._data.get("groups", {}):
            del self._data["groups"][group_name]
            await self.async_save()
            _LOGGER.info(f"Deleted group '{group_name}'")

    async def async_add_entity_to_group(self, group_name: str, entity_id: str) -> None:
        """Add an entity to a group."""
        if group_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{group_name}' does not exist")
        
        if entity_id not in self._data["groups"][group_name]["entities"]:
            self._data["groups"][group_name]["entities"].append(entity_id)
            
            # If the group has a schedule, apply it to the newly added entity
            group_data = self._data["groups"][group_name]
            group_schedules = group_data.get("schedules")
            group_mode = group_data.get("schedule_mode", "all_days")
            
            if group_schedules and entity_id in self._data.get("entities", {}):
                # Deep copy the schedules and mode to ensure the entity has its own copy
                self._data["entities"][entity_id]["schedules"] = copy.deepcopy(group_schedules)
                self._data["entities"][entity_id]["schedule_mode"] = group_mode
            
            await self.async_save()
            _LOGGER.info(f"Added {entity_id} to group '{group_name}'")

    async def async_remove_entity_from_group(self, group_name: str, entity_id: str) -> None:
        """Remove an entity from a group."""
        if group_name in self._data.get("groups", {}):
            entities = self._data["groups"][group_name]["entities"]
            if entity_id in entities:
                entities.remove(entity_id)
                await self.async_save()
                _LOGGER.info(f"Removed {entity_id} from group '{group_name}'")

    async def async_get_groups(self) -> Dict[str, Any]:
        """Get all groups."""
        return self._data.get("groups", {})

    async def async_get_group(self, group_name: str) -> Optional[Dict[str, Any]]:
        """Get a specific group."""
        return self._data.get("groups", {}).get(group_name)

    async def async_get_entity_group(self, entity_id: str) -> Optional[str]:
        """Get the group name that an entity belongs to."""
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                return group_name
        return None

    async def async_set_group_schedule(self, group_name: str, nodes: List[Dict[str, Any]], day: Optional[str] = None, schedule_mode: Optional[str] = None) -> None:
        """Set schedule for a group (applies to all entities in the group)."""
        if group_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{group_name}' does not exist")
        
        group_data = self._data["groups"][group_name]
        
        # Update schedule mode if provided
        if schedule_mode is not None:
            group_data["schedule_mode"] = schedule_mode
        
        # Ensure schedules dict exists
        if "schedules" not in group_data:
            group_data["schedules"] = {}
        
        # Determine which schedule to update
        current_mode = group_data.get("schedule_mode", "all_days")
        
        if day is None:
            # No day specified - update the primary schedule based on mode
            if current_mode == "all_days":
                group_data["schedules"]["all_days"] = nodes
            elif current_mode == "5/2":
                group_data["schedules"]["weekday"] = nodes
            else:
                group_data["schedules"]["mon"] = nodes
        else:
            # Specific day provided
            if current_mode == "5/2":
                # Map individual days to weekday/weekend, or use weekday/weekend directly
                if day == "weekday":
                    group_data["schedules"]["weekday"] = nodes
                elif day == "weekend":
                    group_data["schedules"]["weekend"] = nodes
                elif day in ["mon", "tue", "wed", "thu", "fri"]:
                    group_data["schedules"]["weekday"] = nodes
                else:  # sat, sun
                    group_data["schedules"]["weekend"] = nodes
            else:
                # Individual mode or all_days mode
                group_data["schedules"][day] = nodes
        
        # Apply to all entities in the group - update their schedule mode and schedules
        for entity_id in group_data["entities"]:
            if entity_id in self._data.get("entities", {}):
                entity_data = self._data["entities"][entity_id]
                entity_data["schedule_mode"] = current_mode
                if "schedules" not in entity_data:
                    entity_data["schedules"] = {}
                # Deep copy all schedules from group to entity
                entity_data["schedules"] = copy.deepcopy(group_data["schedules"])
        
        await self.async_save()
        _LOGGER.info(f"Set schedule for group '{group_name}' with {len(nodes)} nodes (day: {day}, mode: {schedule_mode})")
    
    async def async_enable_group(self, group_name: str) -> None:
        """Enable a group schedule."""
        if group_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{group_name}' does not exist")
        
        self._data["groups"][group_name]["enabled"] = True
        await self.async_save()
        _LOGGER.info(f"Enabled group '{group_name}'")
    
    async def async_disable_group(self, group_name: str) -> None:
        """Disable a group schedule."""
        if group_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{group_name}' does not exist")
        
        self._data["groups"][group_name]["enabled"] = False
        await self.async_save()
        _LOGGER.info(f"Disabled group '{group_name}'")

    async def async_get_settings(self) -> Dict[str, Any]:
        """Get user settings."""
        return self._data.get("settings", {})
    
    async def async_save_settings(self, settings: Dict[str, Any]) -> None:
        """Save user settings."""
        if "settings" not in self._data:
            self._data["settings"] = {}
        
        self._data["settings"] = settings
        await self.async_save()
        _LOGGER.info(f"Saved settings: {settings}")
