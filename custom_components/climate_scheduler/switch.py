"""Switch platform for Climate Scheduler - Exposes schedules in scheduler-component format."""
import logging
import hashlib
from datetime import datetime, time, timedelta
from typing import Any, Dict, List, Optional

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Climate Scheduler switch entities from a config entry."""
    from homeassistant.helpers import entity_registry as er
    
    storage = hass.data[DOMAIN]["storage"]
    coordinator = hass.data[DOMAIN]["coordinator"]
    entity_registry = er.async_get(hass)
    
    # Clean up old switch entities that don't have the token suffix
    # (These are from before we added the unique_id token)
    old_entities_removed = 0
    for entry in list(entity_registry.entities.values()):
        if entry.platform != DOMAIN or entry.domain != "switch":
            continue
        
        # Old entities have unique_id like "climate_scheduler_schedule_bathroom"
        # New entities have unique_id like "climate_scheduler_schedule_climate.bathroom_abc123"
        # or "climate_scheduler_schedule_Bathroom_abc123"
        if entry.unique_id and entry.unique_id.startswith(f"{DOMAIN}_schedule_"):
            # Check if it's missing the token (no underscore followed by 6 hex chars at the end)
            parts = entry.unique_id.split("_")
            last_part = parts[-1] if parts else ""
            
            # If the last part is not a 6-character hex token, it's an old entity
            if len(last_part) != 6 or not all(c in "0123456789abcdef" for c in last_part.lower()):
                _LOGGER.info(f"Removing old scheduler entity: {entry.entity_id} (unique_id: {entry.unique_id})")
                entity_registry.async_remove(entry.entity_id)
                old_entities_removed += 1
    
    if old_entities_removed > 0:
        _LOGGER.info(f"Removed {old_entities_removed} old scheduler switch entities")
    
    switches = []
    
    # Create switch entity for each group (including single-entity groups)
    all_groups = await storage.async_get_groups()
    for group_name, group_data in all_groups.items():
        # Skip ignored groups
        if group_data.get("ignored", False):
            continue
        
        switches.append(ClimateSchedulerSwitch(
            hass,
            coordinator,
            storage,
            group_name,
            group_data
        ))
    
    if switches:
        async_add_entities(switches, True)
        _LOGGER.info(f"Created {len(switches)} scheduler switch entities")


class ClimateSchedulerSwitch(CoordinatorEntity, SwitchEntity):
    """Switch entity that exposes a climate schedule in scheduler-component format."""

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator,
        storage,
        group_name: str,
        group_data: Dict[str, Any],
    ) -> None:
        """Initialize the switch."""
        super().__init__(coordinator)
        self.hass = hass
        self.storage = storage
        self._group_name = group_name
        self._group_data = group_data
        
        # Generate a stable token for the entity_id (6 chars like scheduler-component)
        token = hashlib.md5(group_name.encode()).hexdigest()[:6]
        
        # For single-entity groups, use a cleaner name
        if group_name.startswith("__entity_"):
            entity_id = group_name.replace("__entity_", "")
            self._attr_name = f"Schedule {entity_id.split('.')[-1]}"
            self._attr_unique_id = f"{DOMAIN}_schedule_{entity_id}_{token}"
        else:
            self._attr_name = f"Schedule {group_name}"
            self._attr_unique_id = f"{DOMAIN}_schedule_{group_name}_{token}"
        
        self._attr_has_entity_name = False
        self._attr_should_poll = True
        
        # Cache for computed attributes
        self._cached_next_trigger: Optional[datetime] = None
        self._cached_next_slot: Optional[int] = None
        self._cached_actions: List[Dict[str, Any]] = []
        self._cached_next_entries: List[Dict[str, Any]] = []

    @property
    def is_on(self) -> bool:
        """Return true if schedule is enabled."""
        # Refresh group data from storage
        self._refresh_group_data()
        return self._group_data.get("enabled", True)

    @property
    def state(self) -> str:
        """Return the state of the scheduler.
        
        States match scheduler-component:
        - off: Schedule is disabled
        - on: Schedule is enabled and waiting for next trigger
        - triggered: Currently executing (we'll use this briefly after firing)
        """
        if not self.is_on:
            return "off"
        
        # Check if this was recently triggered (within last minute)
        # For now, we'll just return "on" - can enhance later
        return "on"

    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        """Return scheduler-component compatible attributes."""
        self._refresh_group_data()
        self._compute_schedule_attributes()
        
        active_profile = self._group_data.get("active_profile", "Default")
        profiles = self._group_data.get("profiles", {})
        profile_data = profiles.get(active_profile, {})
        
        schedule_mode = profile_data.get("schedule_mode", "all_days")
        schedules = profile_data.get("schedules", {})
        
        # Get entities affected by this schedule
        entities = self._group_data.get("entities", [])
        
        attrs = {
            # Core scheduler-component attributes
            "next_trigger": self._cached_next_trigger.isoformat() if self._cached_next_trigger else None,
            "next_slot": self._cached_next_slot,
            "actions": self._cached_actions,
            
            # Fallback format
            "next_entries": self._cached_next_entries,
            
            # Additional metadata
            "schedule_mode": schedule_mode,
            "schedules": schedules,
            "active_profile": active_profile,
            "profiles": list(profiles.keys()),
            "entities": entities,
            
            # Compatibility fields
            "weekdays": self._get_weekdays_list(schedule_mode),
            "timeslots": self._cached_actions,  # Alias
        }
        
        return attrs

    def _refresh_group_data(self) -> None:
        """Refresh group data from storage."""
        # This is called frequently, so we cache the lookup
        import asyncio
        if asyncio.iscoroutinefunction(self.storage.async_get_group):
            # Can't call async from sync property, so we'll need to handle this differently
            # For now, keep the cached version and update on coordinator updates
            pass

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        # Refresh group data when coordinator updates
        loop = self.hass.loop
        if loop and loop.is_running():
            loop.create_task(self._async_refresh_group_data())
        self.async_write_ha_state()

    async def _async_refresh_group_data(self) -> None:
        """Async refresh of group data."""
        group_data = await self.storage.async_get_group(self._group_name)
        if group_data:
            self._group_data = group_data

    def _compute_schedule_attributes(self) -> None:
        """Compute next_trigger, next_slot, actions, and next_entries."""
        now = dt_util.now()
        current_time = now.time()
        current_day = now.strftime("%a").lower()  # mon, tue, wed, etc.
        
        active_profile = self._group_data.get("active_profile", "Default")
        profiles = self._group_data.get("profiles", {})
        profile_data = profiles.get(active_profile, {})
        
        schedule_mode = profile_data.get("schedule_mode", "all_days")
        schedules = profile_data.get("schedules", {})
        
        # Determine which schedule to use based on mode and current day
        current_schedule = self._get_schedule_for_day(schedules, schedule_mode, current_day)
        
        if not current_schedule:
            self._cached_next_trigger = None
            self._cached_next_slot = None
            self._cached_actions = []
            self._cached_next_entries = []
            return
        
        # Sort nodes by time
        sorted_nodes = sorted(current_schedule, key=lambda n: self._time_str_to_minutes(n.get("time", "00:00")))
        
        # Find next node
        next_node = None
        next_node_index = None
        
        for idx, node in enumerate(sorted_nodes):
            node_time_str = node.get("time", "00:00")
            node_minutes = self._time_str_to_minutes(node_time_str)
            current_minutes = current_time.hour * 60 + current_time.minute
            
            if node_minutes > current_minutes:
                next_node = node
                next_node_index = idx
                break
        
        # If no node found after current time, use first node tomorrow
        if next_node is None and sorted_nodes:
            next_node = sorted_nodes[0]
            next_node_index = 0
            # Add one day
            next_trigger_dt = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        else:
            next_trigger_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        if next_node:
            # Parse time
            time_str = next_node.get("time", "00:00")
            try:
                hours, minutes = time_str.split(":")
                next_trigger_dt = next_trigger_dt.replace(hour=int(hours), minute=int(minutes))
            except (ValueError, AttributeError):
                _LOGGER.warning(f"Invalid time format: {time_str}")
                next_trigger_dt = None
            
            self._cached_next_trigger = next_trigger_dt
            self._cached_next_slot = next_node_index
            
            # Build actions list for all nodes
            entities = self._group_data.get("entities", [])
            
            # If entities list is empty, try to derive from group name for single-entity groups
            if not entities and self._group_name.startswith("__entity_"):
                entities = [self._group_name.replace("__entity_", "")]
                _LOGGER.debug(f"Derived entity from group name: {entities}")
            
            self._cached_actions = []
            
            for node in sorted_nodes:
                temp = node.get("temp")
                
                # If still no entities, create a generic action without entity_id
                # This allows the data structure to be populated even if entities are missing
                if not entities:
                    action = {
                        "entity_id": "unknown",
                        "service": "climate.set_temperature",
                        "data": {"temperature": temp}
                    }
                    
                    # Add HVAC mode if present
                    if "hvac_mode" in node:
                        action["data"]["hvac_mode"] = node["hvac_mode"]
                    
                    # Add preset mode if present
                    if "preset_mode" in node:
                        action["service"] = "climate.set_preset_mode"
                        action["data"] = {"preset_mode": node["preset_mode"]}
                    
                    self._cached_actions.append(action)
                else:
                    # Normal case: create actions for each entity
                    for entity_id in entities:
                        action = {
                            "entity_id": entity_id,
                            "service": "climate.set_temperature",
                            "data": {"temperature": temp}
                        }
                        
                        # Add HVAC mode if present
                        if "hvac_mode" in node:
                            action["data"]["hvac_mode"] = node["hvac_mode"]
                        
                        # Add preset mode if present
                        if "preset_mode" in node:
                            action["service"] = "climate.set_preset_mode"
                            action["data"] = {"preset_mode": node["preset_mode"]}
                        
                        self._cached_actions.append(action)
            
            # Build next_entries (fallback format)
            self._cached_next_entries = []
            for node in sorted_nodes:
                temp = node.get("temp")
                time_str = node.get("time", "00:00")
                
                # Calculate absolute datetime for this node
                try:
                    hours, minutes = time_str.split(":")
                    node_dt = now.replace(hour=int(hours), minute=int(minutes), second=0, microsecond=0)
                    
                    # If node time is in the past today, it's for tomorrow
                    if node_dt < now:
                        node_dt += timedelta(days=1)
                    
                    entry_actions = []
                    
                    # If still no entities, create a generic action
                    if not entities:
                        entry_actions.append({
                            "entity_id": "unknown",
                            "service": "climate.set_temperature",
                            "data": {"temperature": temp}
                        })
                    else:
                        for entity_id in entities:
                            entry_actions.append({
                                "entity_id": entity_id,
                                "service": "climate.set_temperature",
                                "data": {"temperature": temp}
                            })
                    
                    self._cached_next_entries.append({
                        "time": node_dt.isoformat(),
                        "trigger_time": node_dt.isoformat(),
                        "actions": entry_actions
                    })
                except (ValueError, AttributeError):
                    continue
        else:
            self._cached_next_trigger = None
            self._cached_next_slot = None
            self._cached_actions = []
            self._cached_next_entries = []

    def _get_schedule_for_day(
        self,
        schedules: Dict[str, List[Dict[str, Any]]],
        schedule_mode: str,
        current_day: str
    ) -> List[Dict[str, Any]]:
        """Get the appropriate schedule for the current day."""
        if schedule_mode == "all_days":
            return schedules.get("all_days", [])
        elif schedule_mode == "5/2":
            if current_day in ["mon", "tue", "wed", "thu", "fri"]:
                return schedules.get("weekday", [])
            else:
                return schedules.get("weekend", [])
        elif schedule_mode == "individual":
            return schedules.get(current_day, [])
        else:
            return schedules.get("all_days", [])

    def _get_weekdays_list(self, schedule_mode: str) -> List[str]:
        """Get weekdays list for scheduler-component compatibility."""
        if schedule_mode == "all_days":
            return ["daily"]
        elif schedule_mode == "5/2":
            return ["workday", "weekend"]
        elif schedule_mode == "individual":
            return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        else:
            return ["daily"]

    @staticmethod
    def _time_str_to_minutes(time_str: str) -> int:
        """Convert HH:MM string to minutes since midnight."""
        try:
            hours, minutes = time_str.split(":")
            return int(hours) * 60 + int(minutes)
        except (ValueError, AttributeError):
            return 0

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Enable the schedule."""
        await self.storage.async_enable_schedule(self._group_name)
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Disable the schedule."""
        await self.storage.async_disable_schedule(self._group_name)
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()

    @property
    def device_info(self) -> Dict[str, Any]:
        """Return device info for this scheduler."""
        return {
            "identifiers": {(DOMAIN, f"scheduler_{self._group_name}")},
            "name": self._attr_name,
            "manufacturer": "Climate Scheduler",
            "model": "Schedule Controller",
            "sw_version": "1.0",
        }
