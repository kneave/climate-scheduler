"""Storage management for Climate Scheduler."""
import logging
import copy
import re
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
        # Normalize 24:00 to 23:59 to avoid clash with 00:00 on next day
        if h == 24 and m == 0:
            h, m = 23, 59
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
            self._data = {"groups": {}, "settings": {}, "advance_history": {}}
        else:
            self._data = data
            changed_settings = False

            # Collect nested settings layers (if any) by following repeated
            # {"settings": {...}} wrappers.
            #
            # This repository has had a settings-shape mismatch where the UI
            # sometimes treated {settings: {...}, version: {...}} as the actual
            # settings dict. That can lead to recursive nesting like:
            #   data.settings.settings.settings...
            #
            # On load we:
            # - gather all layers
            # - select the layer with the newest parsed integration version
            # - flatten to a single dict (dropping nested "settings" and "version")
            # - backfill any missing keys from other layers (to avoid losing
            #   settings that only exist in older layers).
            if "settings" in self._data and isinstance(self._data.get("settings"), dict):
                layers: List[Dict[str, Any]] = []
                s: Any = self._data["settings"]

                while isinstance(s, dict):
                    layers.append(s)
                    if "settings" in s and isinstance(s.get("settings"), dict):
                        s = s["settings"]
                    else:
                        break

                if len(layers) > 1:
                    changed_settings = True

                def parse_version_string(ver: Any) -> tuple:
                    if not isinstance(ver, str):
                        return ()
                    # Extract numeric groups from version string, e.g. '1.14.0.13' -> (1,14,0,13)
                    nums = re.findall(r"\d+", ver)
                    return tuple(int(x) for x in nums) if nums else ()

                def layer_version(layer: Dict[str, Any]) -> tuple:
                    v = layer.get("version")
                    if isinstance(v, dict):
                        return parse_version_string(v.get("integration") or v.get("version"))
                    return parse_version_string(v)

                best_layer = layers[-1]  # default: innermost
                best_ver = ()
                for layer in layers:
                    parsed = layer_version(layer)
                    if parsed and parsed > best_ver:
                        best_ver = parsed
                        best_layer = layer

                # Start with the newest layer as the source of truth.
                cleaned_settings: Dict[str, Any] = {
                    k: v
                    for k, v in best_layer.items()
                    if k not in {"settings", "version", "performance_tracking"}
                }

                # Backfill missing keys from any layer (newest doesn't always
                # mean it contains all fields if the nesting was corrupted).
                for layer in reversed(layers):  # inner -> outer
                    for k, v in layer.items():
                        if k in {"settings", "version", "performance_tracking"}:
                            continue
                        if k not in cleaned_settings:
                            cleaned_settings[k] = v

                self._data["settings"] = cleaned_settings
            # Ensure groups key exists for backwards compatibility
            if "groups" not in self._data:
                self._data["groups"] = {}
            # Ensure settings exist
            if "settings" not in self._data:
                self._data["settings"] = {}
            # Ensure advance_history exists
            if "advance_history" not in self._data:
                self._data["advance_history"] = {}
            # Migrate old single-schedule format to new day-based format
            await self._migrate_to_day_schedules()
            # Migrate to profile-based structure
            await self._migrate_to_profiles()
            # Migrate entities to single-entity groups (will remove entities key after migration)
            await self._migrate_entities_to_groups()
            # Migrate per-group profiles to global profile registry
            await self._migrate_profiles_to_global()
        # Ensure global profile structure exists and schedule/profile views are synchronized
        self._ensure_global_profiles_initialized()
        self._sync_group_profile_views()
        # Ensure min/max temp defaults are present in settings
        settings = self._data.get("settings", {})
        # Drop legacy/unreferenced settings keys that may have been persisted
        # due to older settings payload shape mismatches.
        if isinstance(settings, dict) and "performance_tracking" in settings:
            del settings["performance_tracking"]
            changed_settings = True
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
        if "graph_type" not in settings:
            settings["graph_type"] = "svg"  # Default to SVG graph (classic)
        self._data["settings"] = settings
        # Persist cleaned settings if we flattened/cleaned nested layers
        if locals().get("changed_settings"):
            try:
                await self.async_save()
                _LOGGER.info("Persisted cleaned settings to storage")
            except Exception as e:
                _LOGGER.error(f"Failed to persist cleaned settings: {e}")
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
        
        # Remove the legacy entities structure after migration
        if "entities" in self._data and self._data["entities"]:
            _LOGGER.info(f"Removing legacy entities structure after migration to single-entity groups")
            del self._data["entities"]
            migrated = True
        
        if migrated:
            await self.async_save()

    async def async_save(self) -> None:
        """Save data to storage."""
        self._sync_group_profile_views()
        await self._store.async_save(self._data)
        _LOGGER.debug(f"Saved schedule data: {self._data}")

    def _get_default_schedule_template(self) -> List[Dict[str, Any]]:
        """Return configured default schedule template with validation fallback."""
        settings = self._data.get("settings", {})
        configured = settings.get("defaultSchedule") or settings.get("default_schedule")

        if isinstance(configured, list) and configured:
            valid_nodes: List[Dict[str, Any]] = []
            for node in configured:
                if validate_node(node):
                    valid_nodes.append(copy.deepcopy(node))

            if valid_nodes:
                return valid_nodes

        return copy.deepcopy(DEFAULT_SCHEDULE)

    def _build_schedules_from_template(self, default_schedule: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Build schedule dictionary from the single default schedule template."""
        return {"all_days": copy.deepcopy(default_schedule)}

    def _ensure_global_profiles_initialized(self) -> None:
        """Ensure global profiles exist with at least one usable profile."""
        profiles = self._data.get("profiles")
        if not isinstance(profiles, dict):
            profiles = {}

        if not profiles:
            default_schedule = self._get_default_schedule_template()
            profiles["Default"] = {
                "schedule_mode": "all_days",
                "schedules": self._build_schedules_from_template(default_schedule)
            }

        self._data["profiles"] = profiles

    def _resolve_group_active_global_profile(self, group_data: Dict[str, Any], global_profiles: Dict[str, Any]) -> Optional[str]:
        """Resolve the active global profile for a group using compatibility fields."""
        active_global = group_data.get("active_profile_global")
        if active_global in global_profiles:
            return active_global

        active_profile = group_data.get("active_profile")
        if active_profile in global_profiles:
            return active_profile

        return "Default" if "Default" in global_profiles else next(iter(global_profiles), None)

    def _sync_group_profile_views(self) -> None:
        """Align active schedule fields with selected global active profile."""
        groups = self._data.get("groups", {})
        if not isinstance(groups, dict):
            return

        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})
        for group_data in groups.values():
            if not isinstance(group_data, dict):
                continue

            active_profile = self._resolve_group_active_global_profile(group_data, global_profiles)
            if active_profile:
                group_data["active_profile_global"] = active_profile

            if active_profile:
                active_profile_data = global_profiles.get(active_profile, {})
                group_data["schedule_mode"] = active_profile_data.get("schedule_mode", "all_days")
                group_data["schedules"] = copy.deepcopy(active_profile_data.get("schedules", {"all_days": []}))

    async def _migrate_profiles_to_global(self) -> None:
        """Migrate legacy per-group profile dictionaries into global profiles."""
        groups = self._data.get("groups", {})
        if not isinstance(groups, dict):
            return

        global_profiles = self._data.get("profiles")
        if not isinstance(global_profiles, dict):
            global_profiles = {}

        migrated = False

        def make_unique_profile_name(base_name: str) -> str:
            candidate = base_name
            suffix = 2
            while candidate in global_profiles:
                candidate = f"{base_name} ({suffix})"
                suffix += 1
            return candidate

        if not global_profiles:
            for group_name, group_data in groups.items():
                if not isinstance(group_data, dict):
                    continue

                legacy_profiles = group_data.get("profiles", {})
                active_profile = group_data.get("active_profile", "Default")
                legacy_tag_suffix = " [legacy]"

                preserved_legacy_profiles: Dict[str, Any] = {}

                if isinstance(legacy_profiles, dict) and legacy_profiles:
                    name_map: Dict[str, str] = {}
                    legacy_name_map: Dict[str, str] = {}
                    for profile_name, profile_data in legacy_profiles.items():
                        source_profile = profile_data if isinstance(profile_data, dict) else {}
                        new_profile_name = make_unique_profile_name(f"{group_name} - {profile_name}")
                        name_map[profile_name] = new_profile_name
                        global_profiles[new_profile_name] = {
                            "schedule_mode": source_profile.get("schedule_mode", group_data.get("schedule_mode", "all_days")),
                            "schedules": copy.deepcopy(source_profile.get("schedules", group_data.get("schedules", {"all_days": []})))
                        }

                        legacy_name = profile_name if profile_name.endswith(legacy_tag_suffix) else f"{profile_name}{legacy_tag_suffix}"
                        legacy_name_map[profile_name] = legacy_name
                        preserved_legacy_profiles[legacy_name] = {
                            "schedule_mode": source_profile.get("schedule_mode", group_data.get("schedule_mode", "all_days")),
                            "schedules": copy.deepcopy(source_profile.get("schedules", group_data.get("schedules", {"all_days": []})))
                        }

                    group_data["profiles"] = preserved_legacy_profiles
                    if active_profile in legacy_name_map:
                        group_data["active_profile_legacy"] = legacy_name_map[active_profile]
                        group_data["active_profile"] = legacy_name_map[active_profile]

                    mapped_active_profile = name_map.get(active_profile)
                    if mapped_active_profile:
                        group_data["active_profile_global"] = mapped_active_profile
                    elif name_map:
                        group_data["active_profile_global"] = next(iter(name_map.values()))
                else:
                    fallback_name = make_unique_profile_name(f"{group_name} - Default")
                    global_profiles[fallback_name] = {
                        "schedule_mode": group_data.get("schedule_mode", "all_days"),
                        "schedules": copy.deepcopy(group_data.get("schedules", {"all_days": []}))
                    }

                    legacy_default_name = f"Default{legacy_tag_suffix}"
                    preserved_legacy_profiles[legacy_default_name] = {
                        "schedule_mode": group_data.get("schedule_mode", "all_days"),
                        "schedules": copy.deepcopy(group_data.get("schedules", {"all_days": []}))
                    }
                    group_data["profiles"] = preserved_legacy_profiles
                    group_data["active_profile_legacy"] = legacy_default_name
                    group_data["active_profile"] = legacy_default_name
                    group_data["active_profile_global"] = fallback_name

            migrated = True

        if migrated:
            self._data["profiles"] = global_profiles
            self._sync_group_profile_views()
            await self.async_save()
            _LOGGER.info("Migrated legacy per-group profiles to global profiles")

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
    
    async def async_factory_reset(self) -> None:
        """Reset all data to factory defaults (freshly installed state)."""
        _LOGGER.warning("Factory reset requested - clearing all schedules, groups, and settings")
        
        # Reset to fresh state with default settings
        self._data = {
            "entities": {},
            "groups": {},
            "settings": {},
            "advance_history": {}
        }
        
        # Set default min/max temp based on temperature unit
        from homeassistant.const import UnitOfTemperature
        if self.hass.config.units.temperature_unit == UnitOfTemperature.FAHRENHEIT:
            self._data["settings"]["min_temp"] = 42.0  # Fahrenheit
            self._data["settings"]["max_temp"] = 86.0  # Fahrenheit
        else:
            self._data["settings"]["min_temp"] = 5.0  # Celsius
            self._data["settings"]["max_temp"] = 30.0  # Celsius
        
        # Set default for derivative sensors
        self._data["settings"]["create_derivative_sensors"] = True
        
        await self.async_save()
        _LOGGER.info("Factory reset completed - all data cleared and defaults restored")

    def _find_single_entity_group(self, entity_id: str) -> Optional[str]:
        """Find the single-entity group name for an entity (checks both old __entity_ format and friendly name format)."""
        # Check old format first
        old_format = f"__entity_{entity_id}"
        if old_format in self._data.get("groups", {}):
            group_data = self._data["groups"][old_format]
            if group_data.get("_is_single_entity_group") and entity_id in group_data.get("entities", []):
                return old_format
        
        # Check all groups for single-entity groups containing this entity
        for group_name, group_data in self._data.get("groups", {}).items():
            if (group_data.get("_is_single_entity_group") and 
                len(group_data.get("entities", [])) == 1 and 
                entity_id in group_data.get("entities", [])):
                return group_name
        
        return None

    async def async_get_all_entities(self) -> List[str]:
        """Get list of all entity IDs with schedules (from single-entity groups)."""
        entity_ids = []
        for group_name, group_data in self._data.get("groups", {}).items():
            # Extract entity IDs from all groups (single and multi-entity)
            entity_ids.extend(group_data.get("entities", []))
        return list(set(entity_ids))  # Remove duplicates

    async def async_get_schedule(self, entity_id: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get schedule for an entity (from its single-entity group or multi-entity group). If day is specified, returns nodes for that day."""
        # Check if entity is in a single-entity group
        single_group_name = self._find_single_entity_group(entity_id)
        if single_group_name:
            group_data = self._data["groups"][single_group_name]
            projected_group = self._project_group_runtime_view(group_data)
            _LOGGER.debug(f"async_get_schedule: entity {entity_id} found in single-entity group - enabled={group_data.get('enabled', True)}")
            
            # If no day specified, return the whole schedule structure
            if day is None:
                return projected_group
            
            # Return nodes for specific day based on schedule mode
            return {
                "nodes": self._get_nodes_for_day(projected_group, day),
                "enabled": group_data.get("enabled", True),
                "schedule_mode": projected_group.get("schedule_mode", "all_days")
            }
        
        # Check if entity is in a multi-entity group
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                projected_group = self._project_group_runtime_view(group_data)
                _LOGGER.debug(f"async_get_schedule: entity {entity_id} found in multi-entity group '{group_name}' - enabled={group_data.get('enabled', True)}")
                
                # If no day specified, return the whole schedule structure
                if day is None:
                    return projected_group
                
                # Return nodes for specific day based on schedule mode
                return {
                    "nodes": self._get_nodes_for_day(projected_group, day),
                    "enabled": group_data.get("enabled", True),
                    "schedule_mode": projected_group.get("schedule_mode", "all_days")
                }
        
        _LOGGER.debug(f"async_get_schedule: entity {entity_id} not found in any group")
        return None
    
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
        
        # Check if entity already has a single-entity group (old or new format)
        single_group_name = self._find_single_entity_group(entity_id)
        
        # If no existing group, create new one with friendly name
        if not single_group_name:
            friendly_name = entity_id
            if state := self.hass.states.get(entity_id):
                friendly_name = state.attributes.get("friendly_name", entity_id)
            single_group_name = friendly_name
        
        # Ensure groups dict exists
        if "groups" not in self._data:
            self._data["groups"] = {}
        
        # Create group if it doesn't exist
        if single_group_name not in self._data["groups"]:
            self._data["groups"][single_group_name] = {
                "entities": [entity_id],
                "enabled": True,
                "ignored": False,
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
        
        # Now update the group schedule
        await self.async_set_group_schedule(single_group_name, nodes, day, schedule_mode)

    async def async_add_entity(self, entity_id: str) -> None:
        """Add a new entity with default schedule by creating a single-entity group."""
        # Get friendly name for the group
        friendly_name = entity_id
        if state := self.hass.states.get(entity_id):
            friendly_name = state.attributes.get("friendly_name", entity_id)
        single_group_name = friendly_name
        
        if "groups" not in self._data:
            self._data["groups"] = {}
        
        if single_group_name not in self._data["groups"]:
            self._data["groups"][single_group_name] = {
                "entities": [entity_id],
                "enabled": True,
                "ignored": False,
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
                "active_profile": "Default",
                "_is_single_entity_group": True
            }
            await self.async_save()
            _LOGGER.info(f"Added entity {entity_id} with default schedule as single-entity group")

    async def async_remove_entity(self, entity_id: str) -> None:
        """Remove an entity and its schedule (single-entity group)."""
        # Remove the single-entity group
        single_group_name = self._find_single_entity_group(entity_id)
        if single_group_name and single_group_name in self._data.get("groups", {}):
            del self._data["groups"][single_group_name]
            await self.async_save()
            _LOGGER.info(f"Removed single-entity group '{single_group_name}' for entity {entity_id}")
        else:
            _LOGGER.warning(f"Attempted to remove entity {entity_id} but its single-entity group doesn't exist")
    
    async def async_set_ignored(self, entity_id: str, ignored: bool) -> None:
        """Set whether an entity should be ignored (not monitored)."""
        _LOGGER.info(f"async_set_ignored called: entity_id={entity_id}, ignored={ignored}")
        
        # Find which group this entity belongs to
        entity_group_name = None
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                entity_group_name = group_name
                break
        
        # Update the group if the entity is in one
        if entity_group_name:
            group_data = self._data["groups"][entity_group_name]
            group_data["ignored"] = ignored
            # If ignored, disable the group; if not ignored, enable it
            if ignored:
                group_data["enabled"] = False
            else:
                group_data["enabled"] = True

                schedules = group_data.get("schedules", {})
                has_any_nodes = (
                    isinstance(schedules, dict)
                    and any(isinstance(nodes, list) and len(nodes) > 0 for nodes in schedules.values())
                )

                if not has_any_nodes:
                    default_schedule = self._get_default_schedule_template()
                    group_data["schedule_mode"] = "all_days"
                    group_data["schedules"] = self._build_schedules_from_template(default_schedule)

                    profiles = group_data.get("profiles", {})
                    if not isinstance(profiles, dict):
                        profiles = {}
                    if "Default" not in profiles or not isinstance(profiles.get("Default"), dict):
                        profiles["Default"] = {}

                    default_profile = profiles["Default"]
                    default_profile["schedule_mode"] = "all_days"
                    default_profile["schedules"] = copy.deepcopy(group_data["schedules"])
                    group_data["profiles"] = profiles
                    group_data["active_profile"] = group_data.get("active_profile") or "Default"

                    _LOGGER.info(
                        f"Applied configured default schedule to group '{entity_group_name}' while enabling monitoring"
                    )

            _LOGGER.info(f"Set group '{entity_group_name}' ignored={ignored}, enabled={not ignored} for entity {entity_id}")
        else:
            # Entity is not in any group, create a single-entity group
            if "groups" not in self._data:
                self._data["groups"] = {}
            
            # Get friendly name for the group
            friendly_name = entity_id
            if state := self.hass.states.get(entity_id):
                friendly_name = state.attributes.get("friendly_name", entity_id)
            single_group_name = friendly_name
            
            if ignored:
                # Create with empty schedule and ignored=True
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
                _LOGGER.info(f"Created single-entity group '{single_group_name}' for {entity_id} with ignored=True")
            else:
                # Create with default schedule and ignored=False
                default_schedule = self._get_default_schedule_template()
                self._data["groups"][single_group_name] = {
                    "entities": [entity_id],
                    "enabled": True,
                    "ignored": False,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": copy.deepcopy(default_schedule)},
                    "profiles": {
                        "Default": {
                            "schedule_mode": "all_days",
                            "schedules": {"all_days": copy.deepcopy(default_schedule)}
                        }
                    },
                    "active_profile": "Default",
                    "_is_single_entity_group": True
                }
                _LOGGER.info(f"Created single-entity group '{single_group_name}' for {entity_id} with default schedule")
        
        await self.async_save()
    
    async def async_is_ignored(self, entity_id: str) -> bool:
        """Check if an entity is marked as ignored."""
        # Check if entity is in any group
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                return group_data.get("ignored", False)
        
        # Entity not found in any group
        return False

    async def async_set_enabled(self, entity_id: str, enabled: bool) -> None:
        """Enable or disable scheduling for an entity (via its single-entity group or multi-entity group)."""
        # Find which group this entity belongs to
        entity_group_name = None
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                entity_group_name = group_name
                break
        
        # Update the group
        if entity_group_name:
            self._data["groups"][entity_group_name]["enabled"] = enabled
            await self.async_save()
            _LOGGER.info(f"Set group '{entity_group_name}' enabled={enabled} for entity {entity_id}")
        else:
            _LOGGER.warning(f"Entity {entity_id} not found in any group for async_set_enabled")
    
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
        
        # Get all entity IDs from groups
        all_entity_ids = await self.async_get_all_entities()
        
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
            
            if climate_entity_id not in all_entity_ids:
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

    async def async_cleanup_unmonitored_storage(self, delete: bool = False) -> Dict[str, Any]:
        """Cleanup stale storage references for unmonitored or missing entities.

        Removes:
        - Groups marked as ignored (unmonitored)
        - Groups with no valid climate entities
        - Invalid/missing entity references inside groups
        - Invalid profile structures and broken active profile pointers
        - Orphaned advance history entries
        """
        groups = self._data.get("groups", {})
        if not isinstance(groups, dict):
            groups = {}

        climate_entity_ids = set(self.hass.states.async_entity_ids("climate"))

        changed = False
        kept_groups: Dict[str, Any] = {}
        kept_entities: set[str] = set()

        removed_groups: list[Dict[str, Any]] = []
        removed_entity_refs: list[Dict[str, Any]] = []
        repaired_groups: list[str] = []
        removed_profiles: list[Dict[str, Any]] = []
        repaired_active_profiles: list[Dict[str, str]] = []
        removed_advance_history: list[str] = []

        for group_name, raw_group_data in groups.items():
            if not isinstance(raw_group_data, dict):
                removed_groups.append({"group": group_name, "reason": "invalid_group_data"})
                changed = True
                continue

            group_data = copy.deepcopy(raw_group_data)

            if group_data.get("ignored", False):
                removed_groups.append({"group": group_name, "reason": "unmonitored"})
                changed = True
                continue

            original_entities = group_data.get("entities", [])
            if not isinstance(original_entities, list):
                original_entities = []

            normalized_entities: list[str] = []
            seen_entities: set[str] = set()
            for entity_id in original_entities:
                if not isinstance(entity_id, str) or not entity_id:
                    removed_entity_refs.append({
                        "group": group_name,
                        "entity_id": entity_id,
                        "reason": "invalid_entity_reference",
                    })
                    changed = True
                    continue

                if entity_id in seen_entities:
                    removed_entity_refs.append({
                        "group": group_name,
                        "entity_id": entity_id,
                        "reason": "duplicate_entity_reference",
                    })
                    changed = True
                    continue

                seen_entities.add(entity_id)

                if entity_id not in climate_entity_ids:
                    removed_entity_refs.append({
                        "group": group_name,
                        "entity_id": entity_id,
                        "reason": "entity_not_found",
                    })
                    changed = True
                    continue

                normalized_entities.append(entity_id)

            if not normalized_entities:
                removed_groups.append({"group": group_name, "reason": "no_monitored_entities"})
                changed = True
                continue

            if normalized_entities != original_entities:
                group_data["entities"] = normalized_entities
                changed = True
                repaired_groups.append(group_name)

            profiles = group_data.get("profiles", {})
            if not isinstance(profiles, dict):
                profiles = {}
                changed = True

            valid_profiles: Dict[str, Any] = {}
            for profile_name, profile_data in profiles.items():
                if not isinstance(profile_data, dict):
                    removed_profiles.append({
                        "group": group_name,
                        "profile": profile_name,
                        "reason": "invalid_profile_data",
                    })
                    changed = True
                    continue

                profile_schedules = profile_data.get("schedules")
                if not isinstance(profile_schedules, dict):
                    removed_profiles.append({
                        "group": group_name,
                        "profile": profile_name,
                        "reason": "invalid_profile_schedules",
                    })
                    changed = True
                    continue

                valid_profiles[profile_name] = {
                    "schedule_mode": profile_data.get("schedule_mode", group_data.get("schedule_mode", "all_days")),
                    "schedules": copy.deepcopy(profile_schedules),
                }

            if not valid_profiles:
                valid_profiles["Default"] = {
                    "schedule_mode": group_data.get("schedule_mode", "all_days"),
                    "schedules": copy.deepcopy(group_data.get("schedules", {"all_days": []})),
                }
                changed = True

            group_data["profiles"] = valid_profiles

            active_profile = group_data.get("active_profile")
            if active_profile not in valid_profiles:
                new_active_profile = "Default" if "Default" in valid_profiles else next(iter(valid_profiles))
                repaired_active_profiles.append({
                    "group": group_name,
                    "old": str(active_profile),
                    "new": new_active_profile,
                })
                group_data["active_profile"] = new_active_profile
                changed = True

            active_profile_data = group_data["profiles"][group_data["active_profile"]]
            group_data["schedule_mode"] = active_profile_data.get("schedule_mode", "all_days")
            group_data["schedules"] = copy.deepcopy(active_profile_data.get("schedules", {"all_days": []}))

            should_be_single = len(normalized_entities) == 1
            if group_data.get("_is_single_entity_group", False) != should_be_single:
                group_data["_is_single_entity_group"] = should_be_single
                changed = True
                if group_name not in repaired_groups:
                    repaired_groups.append(group_name)

            kept_groups[group_name] = group_data
            kept_entities.update(normalized_entities)

        current_groups = self._data.get("groups", {})
        if current_groups != kept_groups:
            changed = True

        advance_history_raw = self._data.get("advance_history", {})
        advance_history: Dict[str, Any] = copy.deepcopy(advance_history_raw) if isinstance(advance_history_raw, dict) else {}
        if not isinstance(advance_history_raw, dict):
            changed = True

        for entity_id in list(advance_history.keys()):
            if entity_id not in kept_entities:
                removed_advance_history.append(entity_id)
                del advance_history[entity_id]
                changed = True

        if "entities" in self._data and self._data.get("entities"):
            changed = True

        if not delete:
            message = (
                f"Preview: would remove {len(removed_groups)} groups, "
                f"{len(removed_entity_refs)} stale entity references, "
                f"{len(removed_profiles)} invalid profiles, and "
                f"{len(removed_advance_history)} orphaned advance history entries."
            )

            return {
                "delete": False,
                "would_change": changed,
                "would_groups_remaining": len(kept_groups),
                "would_remove_groups": removed_groups,
                "would_remove_entity_references": removed_entity_refs,
                "would_remove_profiles": removed_profiles,
                "would_repair_groups": repaired_groups,
                "would_repair_active_profiles": repaired_active_profiles,
                "would_remove_advance_history": removed_advance_history,
                "message": message,
            }

        self._data["groups"] = kept_groups
        self._data["advance_history"] = advance_history
        if "entities" in self._data:
            del self._data["entities"]

        if changed:
            await self.async_save()

        message = (
            f"Removed {len(removed_groups)} groups, "
            f"{len(removed_entity_refs)} stale entity references, "
            f"{len(removed_profiles)} invalid profiles, and "
            f"{len(removed_advance_history)} orphaned advance history entries."
        )

        return {
            "delete": True,
            "changed": changed,
            "groups_remaining": len(kept_groups),
            "removed_groups": removed_groups,
            "removed_entity_references": removed_entity_refs,
            "removed_profiles": removed_profiles,
            "repaired_groups": repaired_groups,
            "repaired_active_profiles": repaired_active_profiles,
            "removed_advance_history": removed_advance_history,
            "message": message,
        }

    async def async_is_enabled(self, entity_id: str) -> bool:
        """Check if scheduling is enabled for an entity."""
        # Check if entity is in any group
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                return group_data.get("enabled", True)
        
        # Entity not found in any group
        return False

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
    
    async def get_active_node_for_group(self, group_name: str, current_time: Optional[time] = None, current_day: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get the active node for a group at a given time, handling cross-day transitions in individual mode.
        
        Args:
            group_name: Name of the group
            current_time: Time to check (defaults to now)
            current_day: Day abbreviation (mon, tue, etc.) (defaults to today)
            
        Returns:
            The active node at the specified time, or None if no schedule exists
        """
        if current_time is None:
            current_time = datetime.now().time()
        if current_day is None:
            current_day = datetime.now().strftime('%a').lower()
        
        # Get group schedule for current day
        group_schedule = await self.async_get_group_schedule(group_name, current_day)
        if not group_schedule or not group_schedule.get("nodes"):
            return None
        
        schedule_mode = group_schedule.get("schedule_mode", "all_days")
        nodes = group_schedule["nodes"]
        
        # In individual or 5/2 mode, check if we need previous day's schedule
        if schedule_mode in ["individual", "5/2"] and nodes:
            sorted_nodes = sorted(nodes, key=lambda n: self._time_to_minutes(n["time"]))
            current_minutes = current_time.hour * 60 + current_time.minute
            first_node_minutes = self._time_to_minutes(sorted_nodes[0]["time"])
            
            if current_minutes < first_node_minutes:
                # We're before the first node of today, get previous day/period's last node
                days_of_week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                current_day_index = days_of_week.index(current_day)
                prev_day = days_of_week[(current_day_index - 1) % 7]
                
                prev_day_schedule = await self.async_get_group_schedule(group_name, prev_day)
                if prev_day_schedule and prev_day_schedule.get("nodes"):
                    prev_nodes = prev_day_schedule["nodes"]
                    sorted_prev_nodes = sorted(prev_nodes, key=lambda n: self._time_to_minutes(n["time"]))
                    return sorted_prev_nodes[-1]
        
        # Normal case: get active node from current day's schedule
        return self.get_active_node(nodes, current_time)
    
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
            "ignored": False,
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
        """Add an entity to a group.
        
        If the entity is unmonitored (not in any group), it will be added to the target group.
        If the entity is in a single-entity group, that group will be deleted and the entity moved.
        """
        if group_name not in self._data.get("groups", {}):
            raise ValueError(f"Group '{group_name}' does not exist")
        
        group_data = self._data["groups"][group_name]
        
        # Check if entity is currently in a different group
        old_single_entity_group = None
        entity_found_in_group = False
        for existing_group_name, existing_group_data in self._data.get("groups", {}).items():
            if existing_group_name != group_name and entity_id in existing_group_data.get("entities", []):
                # Found entity in a different group
                entity_found_in_group = True
                if existing_group_data.get("_is_single_entity_group") and len(existing_group_data.get("entities", [])) == 1:
                    # It's a single-entity group - mark for deletion
                    old_single_entity_group = existing_group_name
                    _LOGGER.info(f"Entity {entity_id} is in single-entity group '{existing_group_name}' which will be deleted")
                # Remove entity from the old group
                existing_group_data["entities"].remove(entity_id)
                break
        
        # Log if entity wasn't in any group (unmonitored entity being added)
        if not entity_found_in_group:
            _LOGGER.info(f"Adding unmonitored entity {entity_id} to group '{group_name}'")
        
        if entity_id not in group_data["entities"]:
            group_data["entities"].append(entity_id)
            entity_count = len(group_data["entities"])
            
            # Normalize _is_single_entity_group flag based on actual entity count
            if entity_count == 1:
                # Group now has exactly 1 entity - mark as single-entity group
                group_data["_is_single_entity_group"] = True
                _LOGGER.info(f"Group '{group_name}' now has 1 entity - marked as single-entity group")
            elif entity_count >= 2:
                # Group now has 2+ entities - ensure it's marked as multi-entity group
                if group_data.get("_is_single_entity_group"):
                    group_data["_is_single_entity_group"] = False
                    _LOGGER.info(f"Group '{group_name}' now has {entity_count} entities - converted to multi-entity group")
            
            # Delete the old single-entity group if it existed
            if old_single_entity_group:
                del self._data["groups"][old_single_entity_group]
                _LOGGER.info(f"Deleted single-entity group '{old_single_entity_group}'")
            
            await self.async_save()
            _LOGGER.info(f"Added {entity_id} to group '{group_name}'")

    async def async_remove_entity_from_group(self, group_name: str, entity_id: str) -> None:
        """Remove an entity from a group and create a new single-entity group for it."""
        if group_name in self._data.get("groups", {}):
            entities = self._data["groups"][group_name]["entities"]
            if entity_id in entities:
                # Get the current group data before removing the entity
                group_data = self._data["groups"][group_name]
                
                entities.remove(entity_id)
                
                # If only 1 entity remains, convert the group to a single-entity group
                if len(entities) == 1:
                    group_data["_is_single_entity_group"] = True
                    _LOGGER.info(f"Group '{group_name}' now has only 1 entity - converted to single-entity group")
                
                # Create a new single-entity group for the removed entity using friendly name
                friendly_name = entity_id
                if state := self.hass.states.get(entity_id):
                    friendly_name = state.attributes.get("friendly_name", entity_id)
                single_group_name = friendly_name
                
                if "groups" not in self._data:
                    self._data["groups"] = {}
                
                # Create the new single-entity group with current data from the group
                self._data["groups"][single_group_name] = {
                    "entities": [entity_id],
                    "enabled": group_data.get("enabled", True),
                    "ignored": group_data.get("ignored", False),
                    "schedule_mode": group_data.get("schedule_mode", "all_days"),
                    "schedules": copy.deepcopy(group_data.get("schedules", {"all_days": []})),
                    "profiles": copy.deepcopy(group_data.get("profiles", {
                        "Default": {
                            "schedule_mode": "all_days",
                            "schedules": {"all_days": []}
                        }
                    })),
                    "active_profile": group_data.get("active_profile", "Default"),
                    "_is_single_entity_group": True
                }
                
                await self.async_save()
                _LOGGER.info(f"Removed {entity_id} from group '{group_name}' and created single-entity group '{single_group_name}'")

    async def async_get_groups(self) -> Dict[str, Any]:
        """Get all groups."""
        self._sync_group_profile_views()
        groups = self._data.get("groups", {})
        projected: Dict[str, Any] = {}
        for group_name, group_data in groups.items():
            if isinstance(group_data, dict):
                projected[group_name] = self._project_group_runtime_view(group_data)
            else:
                projected[group_name] = group_data
        return projected

    async def async_get_group(self, group_name: str) -> Optional[Dict[str, Any]]:
        """Get a specific group."""
        self._sync_group_profile_views()
        group_data = self._data.get("groups", {}).get(group_name)
        if not isinstance(group_data, dict):
            return group_data
        return self._project_group_runtime_view(group_data)

    def _project_group_runtime_view(self, group_data: Dict[str, Any]) -> Dict[str, Any]:
        """Return a runtime view exposing global profiles while preserving persisted legacy profiles."""
        view = copy.deepcopy(group_data)
        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})
        view["profiles"] = copy.deepcopy(global_profiles)

        active_profile = self._resolve_group_active_global_profile(group_data, global_profiles)
        if active_profile:
            view["active_profile"] = active_profile
            view["active_profile_global"] = active_profile

        return view

    async def async_get_entity_group(self, entity_id: str) -> Optional[str]:
        """Get the group name that an entity belongs to."""
        for group_name, group_data in self._data.get("groups", {}).items():
            if entity_id in group_data.get("entities", []):
                return group_name
        return None

    async def async_set_group_schedule(self, group_name: str, nodes: List[Dict[str, Any]], day: Optional[str] = None, schedule_mode: Optional[str] = None, profile_name: Optional[str] = None) -> None:
        """Set schedule for a group (applies to all entities in the group).
        
        If profile_name is provided, saves to that specific profile without changing the active profile.
        Otherwise saves to the currently active profile.
        """
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
        
        # Determine which profile to save to (global profile namespace)
        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})

        resolved_active_profile = self._resolve_group_active_global_profile(group_data, global_profiles)
        target_profile = profile_name if profile_name else resolved_active_profile

        # Verify profile exists if explicitly specified
        if profile_name and target_profile not in global_profiles:
            raise ValueError(f"Profile '{profile_name}' does not exist")

        # Create profile if it doesn't exist (only for active profile flow)
        if target_profile not in global_profiles:
            global_profiles[target_profile] = {
                "schedule_mode": current_mode,
                "schedules": {}
            }

        # Save to target profile
        global_profiles[target_profile]["schedule_mode"] = current_mode
        global_profiles[target_profile]["schedules"] = copy.deepcopy(group_data["schedules"])
        self._data["profiles"] = global_profiles

        # If saving to non-active profile, restore group's current schedule from active profile
        if profile_name and profile_name != resolved_active_profile:
            active_profile = resolved_active_profile
            if active_profile in global_profiles:
                group_data["schedule_mode"] = global_profiles[active_profile].get("schedule_mode", "all_days")
                group_data["schedules"] = copy.deepcopy(global_profiles[active_profile].get("schedules", {}))
        
        _LOGGER.info(f"Saved group schedule to profile '{target_profile}' for group '{group_name}' - day: {day}, mode: {current_mode}, nodes: {len(nodes)}")
        _LOGGER.debug(f"Profile schedules after save: {global_profiles[target_profile]['schedules'].keys()}")
        
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
    
    async def async_enable_schedule(self, schedule_id: str) -> None:
        """Enable a schedule by group name or entity_id."""
        # Check if it's a group name
        if schedule_id in self._data.get("groups", {}):
            await self.async_enable_group(schedule_id)
        else:
            # Treat as entity_id - find its group
            group_name = await self.async_get_entity_group(schedule_id)
            if group_name:
                await self.async_enable_group(group_name)
            else:
                raise ValueError(f"Schedule '{schedule_id}' not found")
    
    async def async_disable_schedule(self, schedule_id: str) -> None:
        """Disable a schedule by group name or entity_id."""
        # Check if it's a group name
        if schedule_id in self._data.get("groups", {}):
            await self.async_disable_group(schedule_id)
        else:
            # Treat as entity_id - find its group
            group_name = await self.async_get_entity_group(schedule_id)
            if group_name:
                await self.async_disable_group(group_name)
            else:
                raise ValueError(f"Schedule '{schedule_id}' not found")
    
    # Profile Management Methods
    
    async def async_create_profile(self, target_id: str, profile_name: str) -> None:
        """Create a new global schedule profile."""
        if target_id not in self._data.get("groups", {}):
            raise ValueError(f"Group '{target_id}' does not exist")

        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})

        if profile_name in global_profiles:
            raise ValueError(f"Profile '{profile_name}' already exists")

        # Seed from current target group's active schedule for convenience
        target_group = self._data["groups"][target_id]
        global_profiles[profile_name] = {
            "schedule_mode": target_group.get("schedule_mode", "all_days"),
            "schedules": copy.deepcopy(target_group.get("schedules", {"all_days": []}))
        }
        self._data["profiles"] = global_profiles

        await self.async_save()
        _LOGGER.info(f"Created global profile '{profile_name}'")
    
    async def async_delete_profile(self, target_id: str, profile_name: str) -> None:
        """Delete a global schedule profile."""
        if target_id not in self._data.get("groups", {}):
            raise ValueError(f"Group '{target_id}' does not exist")

        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})

        if profile_name not in global_profiles:
            raise ValueError(f"Profile '{profile_name}' does not exist")

        if len(global_profiles) <= 1:
            raise ValueError(f"Cannot delete the last profile")

        for group_name, group_data in self._data.get("groups", {}).items():
            if group_data.get("active_profile") == profile_name:
                raise ValueError(f"Cannot delete profile '{profile_name}' because it is active for group '{group_name}'")

        del global_profiles[profile_name]
        self._data["profiles"] = global_profiles

        await self.async_save()
        _LOGGER.info(f"Deleted global profile '{profile_name}'")
    
    async def async_rename_profile(self, target_id: str, old_name: str, new_name: str) -> None:
        """Rename a global schedule profile."""
        if target_id not in self._data.get("groups", {}):
            raise ValueError(f"Group '{target_id}' does not exist")

        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})

        if old_name not in global_profiles:
            raise ValueError(f"Profile '{old_name}' does not exist")

        if new_name in global_profiles:
            raise ValueError(f"Profile '{new_name}' already exists")

        global_profiles[new_name] = global_profiles.pop(old_name)
        self._data["profiles"] = global_profiles

        for group_data in self._data.get("groups", {}).values():
            if group_data.get("active_profile") == old_name:
                group_data["active_profile"] = new_name

        await self.async_save()
        _LOGGER.info(f"Renamed global profile from '{old_name}' to '{new_name}'")
    
    async def async_set_active_profile(self, target_id: str, profile_name: str) -> None:
        """Set the active profile for a group."""

        if target_id not in self._data.get("groups", {}):
            raise ValueError(f"Group '{target_id}' does not exist")

        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})

        if profile_name not in global_profiles:
            raise ValueError(f"Profile '{profile_name}' does not exist")

        target_data = self._data["groups"][target_id]

        # Set the active global profile (runtime path)
        target_data["active_profile_global"] = profile_name

        # Keep legacy active profile pointer for downgrade compatibility
        legacy_profiles = target_data.get("profiles", {})
        legacy_active = target_data.get("active_profile")
        legacy_candidate = None
        if isinstance(legacy_profiles, dict):
            if profile_name in legacy_profiles:
                legacy_candidate = profile_name
            else:
                prefix = f"{target_id} - "
                if profile_name.startswith(prefix):
                    original_name = profile_name[len(prefix):]
                    tagged_name = f"{original_name} [legacy]"
                    if tagged_name in legacy_profiles:
                        legacy_candidate = tagged_name

        if legacy_candidate:
            target_data["active_profile"] = legacy_candidate
            target_data["active_profile_legacy"] = legacy_candidate
        elif legacy_active in legacy_profiles:
            target_data["active_profile"] = legacy_active
            target_data["active_profile_legacy"] = legacy_active
        elif isinstance(legacy_profiles, dict) and legacy_profiles:
            fallback_legacy = next(iter(legacy_profiles))
            target_data["active_profile"] = fallback_legacy
            target_data["active_profile_legacy"] = fallback_legacy

        # Load the profile's schedule into the main schedule fields
        profile_data = global_profiles[profile_name]
        target_data["schedule_mode"] = profile_data.get("schedule_mode", "all_days")
        target_data["schedules"] = copy.deepcopy(profile_data.get("schedules", {}))
        
        _LOGGER.info(f"Switched to profile '{profile_name}' for group '{target_id}'")
        _LOGGER.debug(f"Loaded schedule mode: {target_data['schedule_mode']}, schedule keys: {target_data['schedules'].keys()}")
        
        await self.async_save()
        _LOGGER.info(f"Set active profile to '{profile_name}' for group '{target_id}'")
    
    async def async_get_profiles(self, target_id: str) -> Dict[str, Any]:
        """Get all global profiles."""
        if target_id not in self._data.get("groups", {}):
            return {}

        self._ensure_global_profiles_initialized()
        return self._data.get("profiles", {})
    
    async def async_get_active_profile_name(self, target_id: str) -> Optional[str]:
        """Get the name of the active profile for a group."""
        target_key = "groups"
        
        if target_id not in self._data.get(target_key, {}):
            return None
        
        target_data = self._data[target_key][target_id]
        self._ensure_global_profiles_initialized()
        global_profiles = self._data.get("profiles", {})
        return self._resolve_group_active_global_profile(target_data, global_profiles)

    async def async_get_global_profiles(self) -> Dict[str, Any]:
        """Get the global profile dictionary."""
        self._ensure_global_profiles_initialized()
        return self._data.get("profiles", {})