"""Storage management for Climate Scheduler."""
import logging
import copy
from typing import Any, Dict, List, Optional
from datetime import datetime, time

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.const import UnitOfTemperature

from .const import DOMAIN, STORAGE_VERSION, STORAGE_KEY, DEFAULT_SCHEDULE, MIN_TEMP, MAX_TEMP

_LOGGER = logging.getLogger(__name__)


def validate_node(node: Dict[str, Any]) -> bool:
    """Validate a schedule node structure."""
    if not isinstance(node, dict):
        return False
    
    # Check required fields
    if "time" not in node or "temp" not in node:
        _LOGGER.error(f"Node missing required fields: {node}")
        return False
    
    # Validate time format (HH:MM)
    time_str = node["time"]
    if not isinstance(time_str, str) or len(time_str) != 5 or time_str[2] != ":":
        _LOGGER.error(f"Invalid time format: {time_str}")
        return False
    
    try:
        hours, minutes = time_str.split(":")
        h, m = int(hours), int(minutes)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            _LOGGER.error(f"Time out of range: {time_str}")
            return False
    except (ValueError, AttributeError):
        _LOGGER.error(f"Cannot parse time: {time_str}")
        return False
    
    # Validate temperature is numeric
    try:
        float(node["temp"])
    except (ValueError, TypeError):
        _LOGGER.error(f"Invalid temperature: {node.get('temp')}")
        return False
    
    return True


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
            self._data = {"entities": {}, "groups": {}, "settings": {}, "advance_history": {}}
        else:
            self._data = data
            # Ensure groups key exists for backwards compatibility
            if "groups" not in self._data:
                self._data["groups"] = {}
            # Ensure settings exist
            if "settings" not in self._data:
                self._data["settings"] = {}
            # Ensure advance_history exists
            if "advance_history" not in self._data:
                self._data["advance_history"] = {}
            if "settings" not in self._data:
                self._data["settings"] = {}
            # Migrate old single-schedule format to new day-based format
            await self._migrate_to_day_schedules()
            # Migrate to profile-based structure
            await self._migrate_to_profiles()
            # Migrate entities to single-entity groups
            await self._migrate_entities_to_groups()
        # Ensure min/max temp defaults are present in settings
        settings = self._data.get("settings", {})
        if "min_temp" not in settings:
            # Set default based on temperature unit
            if self.hass.config.units.temperature_unit == UnitOfTemperature.FAHRENHEIT:
                settings["min_temp"] = 42.0  # Fahrenheit
            else:
                settings["min_temp"] = 5.0  # Celsius
        if "max_temp" not in settings:
            # Set default based on temperature unit
            if self.hass.config.units.temperature_unit == UnitOfTemperature.FAHRENHEIT:
                settings["max_temp"] = 86.0  # Fahrenheit
            else:
                settings["max_temp"] = 30.0  # Celsius
        if "create_derivative_sensors" not in settings:
            settings["create_derivative_sensors"] = True  # Default to enabled
        self._data["settings"] = settings
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
    
    async def _migrate_to_profiles(self) -> None:
        """Migrate existing schedules to profile-based format."""
        migrated = False
        
        # Migrate entities
        for entity_id, entity_data in self._data.get("entities", {}).items():
            if "profiles" not in entity_data or "active_profile" not in entity_data:
                # Create Default profile from current schedule
                schedule_mode = entity_data.get("schedule_mode", "all_days")
                schedules = copy.deepcopy(entity_data.get("schedules", {"all_days": []}))
                
                entity_data["profiles"] = {
                    "Default": {
                        "schedule_mode": schedule_mode,
                        "schedules": schedules
                    }
                }
                entity_data["active_profile"] = "Default"
                migrated = True
                _LOGGER.info(f"Migrated entity {entity_id} to profile-based format")
        
        # Migrate groups
        for group_name, group_data in self._data.get("groups", {}).items():
            if "profiles" not in group_data or "active_profile" not in group_data:
                # Create Default profile from current schedule
                schedule_mode = group_data.get("schedule_mode", "all_days")
                schedules = copy.deepcopy(group_data.get("schedules", {"all_days": []}))
                
                group_data["profiles"] = {
                    "Default": {
                        "schedule_mode": schedule_mode,
                        "schedules": schedules
                    }
                }
                group_data["active_profile"] = "Default"
                migrated = True
                _LOGGER.info(f"Migrated group '{group_name}' to profile-based format")
        
        if migrated:
            await self.async_save()
    
    async def _migrate_entities_to_groups(self) -> None:
        """Migrate individual entities to single-entity groups for unified backend."""
        migrated = False
        
        if "groups" not in self._data:
            self._data["groups"] = {}
        
        # Migrate individual entities to single-entity groups
        for entity_id, entity_data in list(self._data.get("entities", {}).items()):
            # Check if entity is already in a multi-entity group
            entity_in_group = False
            for group_name, group_data in self._data["groups"].items():
                if entity_id in group_data.get("entities", []):
                    entity_in_group = True
                    break
            
            # If not in a group, create a single-entity group
            if not entity_in_group:
                # Use entity_id as the group name (with a prefix to distinguish)
                group_name = f"__entity_{entity_id}"
                
                # Only create if it doesn't already exist
                if group_name not in self._data["groups"]:
                    self._data["groups"][group_name] = {
                        "entities": [entity_id],
                        "enabled": entity_data.get("enabled", True),
                        "ignored": entity_data.get("ignored", False),  # Preserve ignored status
                        "schedule_mode": entity_data.get("schedule_mode", "all_days"),
                        "schedules": copy.deepcopy(entity_data.get("schedules", {"all_days": []})),
                        "profiles": copy.deepcopy(entity_data.get("profiles", {
                            "Default": {
                                "schedule_mode": "all_days",
                                "schedules": {"all_days": []}
                            }
                        })),
                        "active_profile": entity_data.get("active_profile", "Default"),
                        "_is_single_entity_group": True  # Internal marker
                    }
                    migrated = True
                    _LOGGER.info(f"Migrated entity {entity_id} to single-entity group '{group_name}'")
        
        if migrated:
            await self.async_save()

    async def async_save(self) -> None:
        """Save data to storage."""
        await self._store.async_save(self._data)
        _LOGGER.debug(f"Saved schedule data: {self._data}")

    async def async_get_settings(self) -> Dict[str, Any]:
        """Return current global settings."""
        return self._data.get("settings", {})

    async def async_save_settings(self, settings: Dict[str, Any]) -> None:
        """Save global settings to storage by merging and persisting."""
        if "settings" not in self._data:
            self._data["settings"] = {}
        # Merge provided settings
        for k, v in settings.items():
            self._data["settings"][k] = v
        await self.async_save()
        _LOGGER.debug(f"Saved settings: {self._data.get('settings')}")

    async def async_get_advance_history(self) -> Dict[str, Any]:
        """Return advance history for all entities."""
        return self._data.get("advance_history", {})

    async def async_save_advance_history(self, history: Dict[str, Any]) -> None:
        """Save advance history to storage."""
        self._data["advance_history"] = history
        await self.async_save()
        _LOGGER.debug(f"Saved advance history: {history}")

    async def async_get_all_entities(self) -> List[str]:
        """Get list of all entity IDs with schedules."""
        return list(self._data.get("entities", {}).keys())

    async def async_get_schedule(self, entity_id: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get schedule for an entity (from its single-entity group or multi-entity group). If day is specified, returns nodes for that day."""
        # First check if entity is in a single-entity group (preferred)
        single_group_name = f"__entity_{entity_id}"
        if single_group_name in self._data.get("groups", {}):
            group_data = self._data["groups"][single_group_name]
            _LOGGER.debug(f"async_get_schedule: entity {entity_id} found in single-entity group - enabled={group_data.get('enabled', True)}")
            
            # If no day specified, return the whole schedule structure
            if day is None:
                return group_data
            
            # Return nodes for specific day based on schedule mode
            return {
                "nodes": self._get_nodes_for_day(group_data, day),
                "enabled": group_data.get("enabled", True),
                "schedule_mode": group_data.get("schedule_mode", "all_days")
            }
        
        # Fall back to legacy entity structure
        entity_data = self._data.get("entities", {}).get(entity_id)
        if not entity_data:
            _LOGGER.debug(f"async_get_schedule: entity {entity_id} not found in storage")
            return None
        
        _LOGGER.debug(f"async_get_schedule: entity {entity_id} found in legacy structure - ignored={entity_data.get('ignored', False)}, enabled={entity_data.get('enabled', True)}")
        
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
        """Set schedule nodes for an entity by creating/updating its single-entity group."""
        # Check if entity is in a multi-entity group
        for group_name, group_data in self._data.get("groups", {}).items():
            if not group_data.get("_is_single_entity_group", False) and entity_id in group_data.get("entities", []):
                # Entity is in a real group, update the group schedule instead
                _LOGGER.info(f"Entity {entity_id} is in group '{group_name}', updating group schedule")
                await self.async_set_group_schedule(group_name, nodes, day, schedule_mode)
                return
        
        # Create or update single-entity group
        single_group_name = f"__entity_{entity_id}"
        
        # Ensure groups dict exists
        if "groups" not in self._data:
            self._data["groups"] = {}
        
        # Create group if it doesn't exist
        if single_group_name not in self._data["groups"]:
            # Check if entity has ignored status in legacy structure
            existing_ignored = False
            if entity_id in self._data.get("entities", {}):
                existing_ignored = self._data["entities"][entity_id].get("ignored", False)
            
            self._data["groups"][single_group_name] = {
                "entities": [entity_id],
                "enabled": True,
                "ignored": existing_ignored,  # Preserve ignored status from legacy entity
                "schedule_mode": schedule_mode or "all_days",
                "schedules": {},
                "profiles": {
                    "Default": {
                        "schedule_mode": schedule_mode or "all_days",
                        "schedules": {}
                    }
                },
                "active_profile": "Default",
                "_is_single_entity_group": True
            }
            _LOGGER.info(f"Created single-entity group '{single_group_name}' for {entity_id}")
        
        # Ensure entity exists in legacy entities structure for backward compatibility
        if "entities" not in self._data:
            self._data["entities"] = {}
        
        if entity_id not in self._data["entities"]:
            self._data["entities"][entity_id] = {
                "enabled": True,
                "schedule_mode": schedule_mode or "all_days",
                "schedules": {},
                "profiles": {
                    "Default": {
                        "schedule_mode": schedule_mode or "all_days",
                        "schedules": {}
                    }
                },
                "active_profile": "Default"
            }
        
        # Now update the group schedule (which will sync to entity for backward compat)
        await self.async_set_group_schedule(single_group_name, nodes, day, schedule_mode)

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
                },
                "profiles": {
                    "Default": {
                        "schedule_mode": "all_days",
                        "schedules": {
                            "all_days": DEFAULT_SCHEDULE.copy()
                        }
                    }
                },
                "active_profile": "Default"
            }
            await self.async_save()
            _LOGGER.info(f"Added entity {entity_id} with default schedule")

    async def async_remove_entity(self, entity_id: str) -> None:
        """Remove an entity and its schedule (including single-entity group)."""
        # Remove the single-entity group
        single_group_name = f"__entity_{entity_id}"
        if single_group_name in self._data.get("groups", {}):
            del self._data["groups"][single_group_name]
            _LOGGER.info(f"Removed single-entity group '{single_group_name}'")
        
        # Also remove from legacy entities structure for backward compatibility
        if entity_id in self._data.get("entities", {}):
            del self._data["entities"][entity_id]
            await self.async_save()
            _LOGGER.info(f"Removed entity {entity_id} from storage")
        else:
            _LOGGER.warning(f"Attempted to remove entity {entity_id} but it doesn't exist in storage")
    
    async def async_set_ignored(self, entity_id: str, ignored: bool) -> None:
        """Set whether an entity should be ignored (not monitored)."""
        _LOGGER.info(f"async_set_ignored called: entity_id={entity_id}, ignored={ignored}")
        
        # Find which group this entity belongs to
        entity_group_name = None
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                entity_group_name = group_name
                break
        
        group_updated = False
        
        # Update the group if the entity is in one
        if entity_group_name:
            self._data["groups"][entity_group_name]["ignored"] = ignored
            # If ignored, also disable the group
            if ignored:
                self._data["groups"][entity_group_name]["enabled"] = False
            _LOGGER.info(f"Set group '{entity_group_name}' ignored={ignored} for entity {entity_id}")
            group_updated = True
        
        # Update or create legacy entity structure for backward compatibility
        if entity_id in self._data.get("entities", {}):
            self._data["entities"][entity_id]["ignored"] = ignored
            # If ignored, also disable the entity
            if ignored:
                self._data["entities"][entity_id]["enabled"] = False
            _LOGGER.info(f"Set {entity_id} ignored={ignored} - entity exists, flag updated")
            _LOGGER.debug(f"Entity data after update: {self._data['entities'][entity_id]}")
        else:
            # Entity doesn't exist yet, create it with default schedule and set ignored
            if ignored:
                # Create both group and legacy entity structures if not in a group
                if "entities" not in self._data:
                    self._data["entities"] = {}
                
                # Create single-entity group only if entity is not already in a group
                if not entity_group_name:
                    if "groups" not in self._data:
                        self._data["groups"] = {}
                    
                    single_group_name = f"__entity_{entity_id}"
                    self._data["groups"][single_group_name] = {
                        "entities": [entity_id],
                        "enabled": False,
                        "ignored": True,
                        "schedule_mode": "all_days",
                        "schedules": {"all_days": []},
                        "profiles": {
                            "Default": {
                                "schedule_mode": "all_days",
                                "schedules": {"all_days": []}
                            }
                        },
                        "active_profile": "Default",
                        "_is_single_entity_group": True
                    }
                    group_updated = True
                    _LOGGER.info(f"Created single-entity group '{single_group_name}' for {entity_id}")
                
                # Create legacy entity
                self._data["entities"][entity_id] = {
                    "enabled": False,
                    "ignored": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []}
                }
                _LOGGER.info(f"Created entity {entity_id} with ignored=True")
                _LOGGER.debug(f"New entity data: {self._data['entities'][entity_id]}")
            else:
                _LOGGER.warning(f"Attempted to set ignored=False for non-existent entity {entity_id}")
        
        # Always save if we updated anything
        if group_updated or entity_id in self._data.get("entities", {}):
            await self.async_save()
            _LOGGER.info(f"Saved changes for {entity_id}, ignored={ignored}")
    
    async def async_is_ignored(self, entity_id: str) -> bool:
        """Check if an entity is marked as ignored."""
        # Check single-entity group first
        single_group_name = f"__entity_{entity_id}"
        if single_group_name in self._data.get("groups", {}):
            return self._data["groups"][single_group_name].get("ignored", False)
        
        # Fall back to legacy entity structure
        entity_data = self._data.get("entities", {}).get(entity_id)
        if entity_data is None:
            return False
        return entity_data.get("ignored", False)

    async def async_set_enabled(self, entity_id: str, enabled: bool) -> None:
        """Enable or disable scheduling for an entity (via its single-entity group)."""
        single_group_name = f"__entity_{entity_id}"
        
        # Update the single-entity group
        if single_group_name in self._data.get("groups", {}):
            self._data["groups"][single_group_name]["enabled"] = enabled
        
        # Also update legacy entity structure for backward compatibility
        if entity_id in self._data.get("entities", {}):
            self._data["entities"][entity_id]["enabled"] = enabled
            await self.async_save()
            _LOGGER.info(f"Set {entity_id} enabled={enabled}")
            
            # Reload sensor platform to create/remove derivative sensors
            if enabled:
                await self._reload_sensor_platform()
    
    async def _reload_sensor_platform(self) -> None:
        """Reload the sensor platform to update derivative sensors."""
        try:
            # Get the config entry
            entries = self.hass.config_entries.async_entries(DOMAIN)
            if entries:
                entry = entries[0]
                # Reload the sensor platform
                await self.hass.config_entries.async_reload(entry.entry_id)
                _LOGGER.debug("Reloaded sensor platform for derivative sensor update")
        except Exception as e:
            _LOGGER.debug(f"Could not reload sensor platform: {e}")
    
    async def async_cleanup_derivative_sensors(self, confirm_delete_all: bool = False) -> Dict[str, Any]:
        """Cleanup derivative sensors.
        
        - Delete sensors for entities that no longer exist
        - If auto-creation is disabled and confirm_delete_all=True, delete ALL derivative sensors
        
        Returns a dict with cleanup results.
        """
        settings = self._data.get("settings", {})
        auto_creation_enabled = settings.get("create_derivative_sensors", True)
        entities = self._data.get("entities", {})
        
        deleted_sensors = []
        errors = []
        
        # Get entity registry to find our sensors
        from homeassistant.helpers import entity_registry as er
        entity_registry = er.async_get(self.hass)
        
        # Find all climate_scheduler rate sensors
        climate_scheduler_sensors = [
            entry
            for entry in entity_registry.entities.values()
            if entry.platform == DOMAIN 
            and entry.domain == "sensor"
            and entry.unique_id and entry.unique_id.endswith("_rate")
        ]
        
        # If auto-creation is disabled and user confirmed, delete ALL
        if not auto_creation_enabled and confirm_delete_all:
            _LOGGER.debug(f"Auto-creation disabled and confirmed - deleting all {len(climate_scheduler_sensors)} derivative sensors")
            for entry in climate_scheduler_sensors:
                try:
                    entity_registry.async_remove(entry.entity_id)
                    deleted_sensors.append(entry.entity_id)
                    _LOGGER.debug(f"Deleted derivative sensor {entry.entity_id}")
                except Exception as e:
                    errors.append(f"{entry.entity_id}: {str(e)}")
                    _LOGGER.warning(f"Failed to delete {entry.entity_id}: {e}")
            
            return {
                "deleted_count": len(deleted_sensors),
                "deleted_sensors": deleted_sensors,
                "errors": errors,
                "message": f"Deleted all {len(deleted_sensors)} climate scheduler derivative sensors"
            }
        
        # If auto-creation is disabled but not confirmed, return warning
        if not auto_creation_enabled and not confirm_delete_all:
            return {
                "deleted_count": 0,
                "deleted_sensors": [],
                "errors": [],
                "message": f"Auto-creation is disabled. Found {len(climate_scheduler_sensors)} derivative sensors. Set confirm_delete_all=true to delete all.",
                "requires_confirmation": True
            }
        
        # Otherwise, only delete sensors for entities that no longer exist
        for entry in climate_scheduler_sensors:
            # Extract climate entity from unique_id: climate_scheduler_bedroom_rate -> climate.bedroom
            unique_id = entry.unique_id
            entity_name = unique_id.replace("climate_scheduler_", "").replace("_rate", "")
            climate_entity_id = f"climate.{entity_name}"
            
            if climate_entity_id not in entities:
                # Entity no longer exists in storage, delete the sensor
                try:
                    entity_registry.async_remove(entry.entity_id)
                    deleted_sensors.append(entry.entity_id)
                    _LOGGER.debug(f"Deleted orphaned derivative sensor {entry.entity_id} (entity {climate_entity_id} no longer exists)")
                except Exception as e:
                    errors.append(f"{entry.entity_id}: {str(e)}")
                    _LOGGER.warning(f"Failed to delete {entry.entity_id}: {e}")
        
        return {
            "deleted_count": len(deleted_sensors),
            "deleted_sensors": deleted_sensors,
            "errors": errors,
            "message": f"Deleted {len(deleted_sensors)} orphaned derivative sensors"
        }

    async def async_is_enabled(self, entity_id: str) -> bool:
        """Check if scheduling is enabled for an entity."""
        # Check single-entity group first
        single_group_name = f"__entity_{entity_id}"
        if single_group_name in self._data.get("groups", {}):
            return self._data["groups"][single_group_name].get("enabled", True)
        
        # Fall back to legacy entity structure
        entity_data = self._data.get("entities", {}).get(entity_id)
        if entity_data is None:
            return False
        # Default to True for backward compatibility with entities that don't have the enabled key
        return entity_data.get("enabled", True)

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
    
    def get_next_node(self, nodes: List[Dict[str, Any]], current_time: time) -> Optional[Dict[str, Any]]:
        """Get the next scheduled node after the current time."""
        if not nodes:
            return None
        
        # Sort nodes by time
        sorted_nodes = sorted(nodes, key=lambda n: self._time_to_minutes(n["time"]))
        
        # Convert current time to minutes since midnight
        current_minutes = current_time.hour * 60 + current_time.minute
        
        # Find the next node (first node after current time)
        for node in sorted_nodes:
            node_minutes = self._time_to_minutes(node["time"])
            if node_minutes > current_minutes:
                return node
        
        # If no node found after current time, wrap around to first node (next day)
        return sorted_nodes[0]

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
            "enabled": True,
            "schedule_mode": "all_days",
            "schedules": {
                "all_days": [{"time": "00:00", "temp": 18}]
            },
            "profiles": {
                "Default": {
                    "schedule_mode": "all_days",
                    "schedules": {
                        "all_days": [{"time": "00:00", "temp": 18}]
                    }
                }
            },
            "active_profile": "Default"
        }
        await self.async_save()
        _LOGGER.info(f"Created group '{group_name}'")

    async def async_delete_group(self, group_name: str) -> None:
        """Delete a group."""
        if group_name in self._data.get("groups", {}):
            del self._data["groups"][group_name]
            await self.async_save()
            _LOGGER.info(f"Deleted group '{group_name}'")
    
    async def async_rename_group(self, old_name: str, new_name: str) -> None:
        """Rename a group."""
        if old_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{old_name}' does not exist")
        
        if new_name in self._data.get("groups", {}):
            raise ValueError(f"Group '{new_name}' already exists")
        
        # Rename the group
        self._data["groups"][new_name] = self._data["groups"].pop(old_name)
        await self.async_save()
        _LOGGER.info(f"Renamed group from '{old_name}' to '{new_name}'")

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
        
        # Save to active profile
        active_profile = group_data.get("active_profile", "Default")
        if "profiles" not in group_data:
            group_data["profiles"] = {}
        if active_profile not in group_data["profiles"]:
            group_data["profiles"][active_profile] = {
                "schedule_mode": current_mode,
                "schedules": {}
            }
        
        # Update the active profile with current schedule and mode
        group_data["profiles"][active_profile]["schedule_mode"] = current_mode
        group_data["profiles"][active_profile]["schedules"] = copy.deepcopy(group_data["schedules"])
        
        _LOGGER.info(f"Saved group schedule to profile '{active_profile}' for group '{group_name}' - day: {day}, mode: {current_mode}, nodes: {len(nodes)}")
        _LOGGER.debug(f"Profile schedules after save: {group_data['profiles'][active_profile]['schedules'].keys()}")
        
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
    
    async def async_get_group_schedule(self, group_name: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get schedule for a group (same logic as entity schedule retrieval)."""
        if group_name not in self._data.get("groups", {}):
            return None
        
        group_data = self._data["groups"][group_name]
        schedule_mode = group_data.get("schedule_mode", "all_days")
        schedules = group_data.get("schedules", {})
        
        # Same day resolution logic as entity schedules
        if schedule_mode == "all_days":
            nodes = schedules.get("all_days", [])
        elif schedule_mode == "5/2":
            if day in ["mon", "tue", "wed", "thu", "fri"]:
                nodes = schedules.get("weekday", [])
            else:  # sat, sun
                nodes = schedules.get("weekend", [])
        else:  # individual
            nodes = schedules.get(day, [])
        
        return {
            "nodes": nodes,
            "enabled": group_data.get("enabled", True),
            "schedule_mode": schedule_mode,
            "schedules": schedules
        }
    
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
    # Profile Management Methods
    
    async def async_create_profile(self, target_id: str, profile_name: str, is_group: bool = False) -> None:
        """Create a new schedule profile for an entity or group."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            raise ValueError(f"{'Group' if is_group else 'Entity'} '{target_id}' does not exist")
        
        target_data = self._data[target_key][target_id]
        
        # Initialize profiles if not present
        if "profiles" not in target_data:
            target_data["profiles"] = {}
        
        if profile_name in target_data["profiles"]:
            raise ValueError(f"Profile '{profile_name}' already exists")
        
        # Create new profile with current active schedule as template
        current_mode = target_data.get("schedule_mode", "all_days")
        current_schedules = copy.deepcopy(target_data.get("schedules", {"all_days": []}))
        
        target_data["profiles"][profile_name] = {
            "schedule_mode": current_mode,
            "schedules": current_schedules
        }
        
        await self.async_save()
        _LOGGER.info(f"Created profile '{profile_name}' for {'group' if is_group else 'entity'} '{target_id}'")
    
    async def async_delete_profile(self, target_id: str, profile_name: str, is_group: bool = False) -> None:
        """Delete a schedule profile."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            raise ValueError(f"{'Group' if is_group else 'Entity'} '{target_id}' does not exist")
        
        target_data = self._data[target_key][target_id]
        
        if profile_name not in target_data.get("profiles", {}):
            raise ValueError(f"Profile '{profile_name}' does not exist")
        
        # Don't allow deleting the active profile or the last profile
        if profile_name == target_data.get("active_profile"):
            raise ValueError(f"Cannot delete the active profile. Switch to another profile first.")
        
        if len(target_data.get("profiles", {})) <= 1:
            raise ValueError(f"Cannot delete the last profile")
        
        del target_data["profiles"][profile_name]
        
        await self.async_save()
        _LOGGER.info(f"Deleted profile '{profile_name}' from {'group' if is_group else 'entity'} '{target_id}'")
    
    async def async_rename_profile(self, target_id: str, old_name: str, new_name: str, is_group: bool = False) -> None:
        """Rename a schedule profile."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            raise ValueError(f"{'Group' if is_group else 'Entity'} '{target_id}' does not exist")
        
        target_data = self._data[target_key][target_id]
        
        if old_name not in target_data.get("profiles", {}):
            raise ValueError(f"Profile '{old_name}' does not exist")
        
        if new_name in target_data.get("profiles", {}):
            raise ValueError(f"Profile '{new_name}' already exists")
        
        # Rename the profile
        target_data["profiles"][new_name] = target_data["profiles"].pop(old_name)
        
        # Update active profile name if needed
        if target_data.get("active_profile") == old_name:
            target_data["active_profile"] = new_name
        
        await self.async_save()
        _LOGGER.info(f"Renamed profile from '{old_name}' to '{new_name}' for {'group' if is_group else 'entity'} '{target_id}'")
    
    async def async_set_active_profile(self, target_id: str, profile_name: str, is_group: bool = False) -> None:
        """Set the active profile for an entity or group."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            raise ValueError(f"{'Group' if is_group else 'Entity'} '{target_id}' does not exist")
        
        target_data = self._data[target_key][target_id]
        
        if profile_name not in target_data.get("profiles", {}):
            raise ValueError(f"Profile '{profile_name}' does not exist")
        
        # Set the active profile
        target_data["active_profile"] = profile_name
        
        # Load the profile's schedule into the main schedule fields
        profile_data = target_data["profiles"][profile_name]
        target_data["schedule_mode"] = profile_data.get("schedule_mode", "all_days")
        target_data["schedules"] = copy.deepcopy(profile_data.get("schedules", {}))
        
        _LOGGER.info(f"Switched to profile '{profile_name}' for {'group' if is_group else 'entity'} '{target_id}'")
        _LOGGER.debug(f"Loaded schedule mode: {target_data['schedule_mode']}, schedule keys: {target_data['schedules'].keys()}")
        
        # If this is a group, update all entities in the group
        if is_group:
            for entity_id in target_data.get("entities", []):
                if entity_id in self._data.get("entities", {}):
                    entity_data = self._data["entities"][entity_id]
                    entity_data["schedule_mode"] = target_data["schedule_mode"]
                    entity_data["schedules"] = copy.deepcopy(target_data["schedules"])
        
        await self.async_save()
        _LOGGER.info(f"Set active profile to '{profile_name}' for {'group' if is_group else 'entity'} '{target_id}'")
    
    async def async_get_profiles(self, target_id: str, is_group: bool = False) -> Dict[str, Any]:
        """Get all profiles for an entity or group."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            return {}
        
        target_data = self._data[target_key][target_id]
        return target_data.get("profiles", {})
    
    async def async_get_active_profile_name(self, target_id: str, is_group: bool = False) -> Optional[str]:
        """Get the name of the active profile for an entity or group."""
        target_key = "groups" if is_group else "entities"
        
        if target_id not in self._data.get(target_key, {}):
            return None
        
        target_data = self._data[target_key][target_id]
        return target_data.get("active_profile")