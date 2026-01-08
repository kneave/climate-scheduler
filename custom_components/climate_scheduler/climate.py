"""Climate platform for Climate Scheduler."""
import asyncio
import logging
import copy
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, time

from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACMode,
    HVACAction,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_TEMPERATURE, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util.unit_conversion import TemperatureConverter

from .const import DOMAIN
from .coordinator import HeatingSchedulerCoordinator
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)

__all__ = ["async_setup_entry", "ClimateSchedulerGroupEntity"]


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Climate Scheduler climate entities from a config entry."""
    storage: ScheduleStorage = hass.data[DOMAIN]["storage"]
    coordinator: HeatingSchedulerCoordinator = hass.data[DOMAIN]["coordinator"]
    
    # Get all groups (excluding single-entity groups)
    groups = await storage.async_get_groups()
    entities = []
    
    for group_name, group_data in groups.items():
        # Skip single-entity groups (internal wrappers)
        if group_data.get("_is_single_entity_group", False):
            continue
        
        # Skip virtual groups (no entities)
        if not group_data.get("entities"):
            continue
        
        # Create climate entity for this group
        entities.append(
            ClimateSchedulerGroupEntity(
                coordinator,
                storage,
                group_name,
                group_data,
            )
        )
        _LOGGER.info(f"Created climate entity for group '{group_name}'")
    
    if entities:
        async_add_entities(entities, True)
        _LOGGER.info(f"Added {len(entities)} climate scheduler group entities")


class ClimateSchedulerGroupEntity(CoordinatorEntity, ClimateEntity):
    """Climate entity representing a schedule group."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HeatingSchedulerCoordinator,
        storage: ScheduleStorage,
        group_name: str,
        group_data: Dict[str, Any],
    ) -> None:
        """Initialize the climate entity."""
        super().__init__(coordinator)
        
        self._storage = storage
        self._group_name = group_name
        self._attr_has_entity_name = True
        self._attr_name = f"Climate Schedule {group_name}"
        self._attr_unique_id = f"climate_scheduler_group_{group_name.lower().replace(' ', '_')}"
        
        # Climate entity configuration - will be set when added to hass
        self._attr_temperature_unit = UnitOfTemperature.CELSIUS  # Default, updated in async_added_to_hass
        self._attr_supported_features = (
            ClimateEntityFeature.TARGET_TEMPERATURE |
            ClimateEntityFeature.TURN_ON |
            ClimateEntityFeature.TURN_OFF |
            ClimateEntityFeature.PRESET_MODE
        )
        
        # Temperature control settings
        self._attr_min_temp = 5.0
        self._attr_max_temp = 35.0
        self._attr_target_temp_step = 0.5
        
        # Simplified modes: Auto (Active - follows schedule) or Off (Idle)
        self._attr_hvac_modes = [
            HVACMode.AUTO,  # Active - follows schedule
            HVACMode.OFF,   # Idle - turns off members
        ]
        
        # Preset modes from profiles
        profiles = group_data.get("profiles", {})
        self._attr_preset_modes = list(profiles.keys()) if profiles else []
        self._attr_preset_mode = group_data.get("active_profile", "Default")
        
        # State tracking
        self._member_entities: List[str] = group_data.get("entities", [])
        self._enabled: bool = group_data.get("enabled", True)
        self._attr_current_temperature: Optional[float] = None
        self._attr_target_temperature: Optional[float] = None
        self._attr_hvac_mode: Optional[HVACMode] = HVACMode.AUTO if self._enabled else HVACMode.OFF
        self._attr_hvac_action: Optional[HVACAction] = None  # Will be set in _update_state
        
        # Cache for attributes
        self._active_node: Optional[Dict[str, Any]] = None
        self._next_node: Optional[Dict[str, Any]] = None
        self._member_temps: Dict[str, float] = {}
    
    async def async_added_to_hass(self) -> None:
        """When entity is added to hass, set temperature unit from system config."""
        await super().async_added_to_hass()
        # Use the same approach as storage.py - get temperature unit from system config
        self._attr_temperature_unit = self.hass.config.units.temperature_unit
        
        # Set temperature step from first member entity if available
        if self._member_entities:
            first_member = self.hass.states.get(self._member_entities[0])
            if first_member:
                member_step = first_member.attributes.get("target_temp_step", 0.5)
                self._attr_target_temp_step = member_step
        
        _LOGGER.debug(
            "Climate entity %s initialized with temperature unit: %s, step: %s",
            self.entity_id,
            self._attr_temperature_unit,
            self._attr_target_temp_step,
        )
        # Perform initial state update
        self._update_state()
        
    @property
    def unique_id(self) -> str:
        """Return unique ID."""
        return self._attr_unique_id
    
    @property
    def device_info(self):
        """Return device info to link this entity to the Climate Scheduler integration."""
        return {
            "identifiers": {(DOMAIN, "climate_scheduler")},
            "name": "Climate Scheduler",
            "manufacturer": "Climate Scheduler",
            "model": "Schedule Manager",
        }
    
    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        # Update enabled state and profiles from storage
        group_data = self._storage._data.get("groups", {}).get(self._group_name)
        if group_data:
            self._enabled = group_data.get("enabled", True)
            profiles = group_data.get("profiles", {})
            self._attr_preset_modes = list(profiles.keys()) if profiles else []
            self._attr_preset_mode = group_data.get("active_profile", "Default")
            # Update HVAC mode based on enabled state
            self._attr_hvac_mode = HVACMode.AUTO if self._enabled else HVACMode.OFF
        self._update_state()
        self.async_write_ha_state()
    
    def _update_state(self) -> None:
        """Update entity state from member entities and schedule."""
        # 1. Calculate average current temperature from members (in their native unit)
        temps = []
        temp_map = {}
        
        for entity_id in self._member_entities:
            state = self.hass.states.get(entity_id)
            if state and state.attributes.get("current_temperature") is not None:
                try:
                    temp = float(state.attributes["current_temperature"])
                    # Store temperature in its native unit, no conversion
                    temps.append(temp)
                    temp_map[entity_id] = round(temp, 1)
                except (ValueError, TypeError):
                    pass
        
        if temps:
            self._attr_current_temperature = round(sum(temps) / len(temps), 1)
        else:
            self._attr_current_temperature = None
        
        self._member_temps = temp_map
        
        # 2. Check if any member is actively requesting heat/cool and determine overall action
        heating_count = 0
        cooling_count = 0
        for entity_id in self._member_entities:
            state = self.hass.states.get(entity_id)
            if state:
                hvac_action = state.attributes.get("hvac_action")
                if hvac_action == "heating":
                    heating_count += 1
                elif hvac_action == "cooling":
                    cooling_count += 1
        
        # Set hvac_action based on member states and enabled status
        if not self._enabled:
            self._attr_hvac_action = HVACAction.OFF
        elif heating_count > 0:
            self._attr_hvac_action = HVACAction.HEATING
        elif cooling_count > 0:
            self._attr_hvac_action = HVACAction.COOLING
        else:
            self._attr_hvac_action = HVACAction.IDLE
        
        # 3. Get active node from schedule to determine setpoint
        current_time = datetime.now().time()
        current_day = datetime.now().strftime('%a').lower()
        
        # Get the schedule data from storage (synchronously accessible)
        group_data = self._storage._data.get("groups", {}).get(self._group_name, {})
        schedule_mode = group_data.get("schedule_mode", "all_days")
        schedules = group_data.get("schedules", {})
        
        # Get nodes for current day using the same logic as coordinator
        if schedule_mode == "all_days":
            nodes = schedules.get("all_days", [])
        elif schedule_mode == "5/2":
            if current_day in ["mon", "tue", "wed", "thu", "fri"]:
                nodes = schedules.get("weekday", [])
            else:
                nodes = schedules.get("weekend", [])
        else:  # individual
            nodes = schedules.get(current_day, [])
        
        # In individual or 5/2 mode, if current time is before all nodes today,
        # use previous day's last node
        if schedule_mode in ["individual", "5/2"] and nodes:
            sorted_nodes = sorted(nodes, key=lambda n: self._storage._time_to_minutes(n["time"]))
            current_minutes = current_time.hour * 60 + current_time.minute
            if sorted_nodes and current_minutes < self._storage._time_to_minutes(sorted_nodes[0]["time"]):
                # We're before the first node of today, need previous day/period's last node
                days_of_week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                current_day_index = days_of_week.index(current_day)
                prev_day = days_of_week[(current_day_index - 1) % 7]
                
                # Get previous day's nodes based on schedule mode
                if schedule_mode == "5/2":
                    # In 5/2 mode, determine if previous day is weekday or weekend
                    if prev_day in ["mon", "tue", "wed", "thu", "fri"]:
                        prev_day_nodes = schedules.get("weekday", [])
                    else:
                        prev_day_nodes = schedules.get("weekend", [])
                else:
                    # In individual mode, use specific day
                    prev_day_nodes = schedules.get(prev_day, [])
                
                if prev_day_nodes:
                    sorted_prev_nodes = sorted(prev_day_nodes, key=lambda n: self._storage._time_to_minutes(n["time"]))
                    last_prev_node = sorted_prev_nodes[-1]
                    # Prepend previous day's last node with time "00:00"
                    carryover_node = {**last_prev_node, "time": "00:00"}
                    nodes = [carryover_node] + nodes
        
        # Determine the active setpoint from schedule
        active_setpoint = None
        if nodes:
            active_node = self._storage.get_active_node(nodes, current_time)
            if active_node:
                active_setpoint = active_node.get("temp")
                _LOGGER.debug(f"Active node for {self._group_name}: temp={active_setpoint}")
            else:
                _LOGGER.debug(f"No active node for {self._group_name} at {current_time}")
        else:
            _LOGGER.debug(f"No schedule data for {self._group_name} on {current_day}")
        
        # Show the scheduled setpoint as target temperature, or use a default
        if active_setpoint is not None:
            self._attr_target_temperature = active_setpoint
        else:
            # Fallback: use average of member target temps, or 20°C default
            member_targets = []
            for entity_id in self._member_entities:
                state = self.hass.states.get(entity_id)
                if state and state.attributes.get("temperature") is not None:
                    try:
                        member_targets.append(float(state.attributes["temperature"]))
                    except (ValueError, TypeError):
                        pass
            
            if member_targets:
                self._attr_target_temperature = round(sum(member_targets) / len(member_targets), 1)
            else:
                self._attr_target_temperature = 20.0  # Default fallback
            
            _LOGGER.debug(f"No schedule setpoint for {self._group_name}, using fallback: {self._attr_target_temperature}")
        
        # HVAC mode reflects enabled state (not member states)
        # This is already set in _handle_coordinator_update
        
        self._active_node = None
        self._next_node = None
    
    def _map_hvac_mode(self, mode_str: str) -> HVACMode:
        """Map string hvac_mode to HVACMode enum."""
        mapping = {
            "off": HVACMode.OFF,
            "heat": HVACMode.HEAT,
            "cool": HVACMode.COOL,
            "heat_cool": HVACMode.HEAT_COOL,
            "auto": HVACMode.AUTO,
            "dry": HVACMode.DRY,
            "fan_only": HVACMode.FAN_ONLY,
        }
        return mapping.get(mode_str.lower() if mode_str else "heat", HVACMode.HEAT)
    
    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        """Return entity specific state attributes."""
        attrs = {
            "member_entities": self._member_entities,
            "member_count": len(self._member_entities),
            "group_name": self._group_name,
            "schedule_enabled": self._enabled,
        }
        
        # Add member temperatures if available
        if self._member_temps:
            attrs["member_temperatures"] = self._member_temps
        
        # Placeholder for future phases - active node info
        if self._active_node:
            attrs["active_node"] = {
                "time": self._active_node.get("time"),
                "temp": self._active_node.get("temp"),
                "hvac_mode": self._active_node.get("hvac_mode"),
            }
        
        if self._next_node:
            attrs["next_node"] = {
                "time": self._next_node.get("time"),
                "temp": self._next_node.get("temp"),
                "hvac_mode": self._next_node.get("hvac_mode"),
            }
        
        return attrs
    
    async def async_set_temperature(self, **kwargs) -> None:
        """Set new target temperature for all member entities."""
        temperature = kwargs.get("temperature")
        if temperature is None:
            _LOGGER.warning("No temperature provided to async_set_temperature")
            return
        
        # Apply temperature to all member entities
        for entity_id in self._member_entities:
            try:
                await self.hass.services.async_call(
                    "climate",
                    "set_temperature",
                    {
                        "entity_id": entity_id,
                        "temperature": temperature,
                    },
                    blocking=True,
                )
                _LOGGER.info(f"Set temperature {temperature} for {entity_id}")
            except Exception as e:
                _LOGGER.error(f"Failed to set temperature for {entity_id}: {e}")
        
        # Set override for each member until next scheduled node
        current_time = datetime.now().time()
        current_day = datetime.now().strftime('%a').lower()
        
        group_data = self._storage._data.get("groups", {}).get(self._group_name, {})
        schedules = group_data.get("schedules", {})
        schedule_data = schedules.get(current_day)
        
        if schedule_data and "nodes" in schedule_data:
            nodes = schedule_data["nodes"]
            next_node = self._storage.get_next_node(nodes, current_time)
            if next_node:
                # Calculate when override expires (at next node time)
                next_node_time_str = next_node["time"]
                next_node_hours, next_node_minutes = map(int, next_node_time_str.split(":"))
                override_until = datetime.now().replace(
                    hour=next_node_hours, 
                    minute=next_node_minutes, 
                    second=0, 
                    microsecond=0
                )
                # If next node time is earlier in the day than current time, it's tomorrow
                if override_until <= datetime.now():
                    override_until += timedelta(days=1)
                
                # Set override for all members
                for entity_id in self._member_entities:
                    self.coordinator.override_until[entity_id] = override_until
                
                _LOGGER.info(
                    f"Set manual override for group {self._group_name} until {override_until}"
                )
        
        # Update target temperature immediately and trigger state refresh
        self._attr_target_temperature = temperature
        
        # Schedule a state update after a short delay to allow member entities to react
        async def delayed_update():
            await asyncio.sleep(2)  # Wait for members to start heating
            self._update_state()
            self.async_write_ha_state()
        
        self.hass.async_create_task(delayed_update())
        self.async_write_ha_state()
    
    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Set HVAC mode - AUTO (active) or OFF (idle)."""
        if hvac_mode == HVACMode.OFF:
            # Turn off schedule (idle mode)
            await self.async_turn_off()
        elif hvac_mode == HVACMode.AUTO:
            # Turn on schedule (active mode)
            await self.async_turn_on()
        else:
            _LOGGER.warning(f"Unsupported HVAC mode {hvac_mode} for climate scheduler group")
    
    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set the preset mode (profile) for this group."""
        # Verify the preset exists
        group_data = self._storage._data.get("groups", {}).get(self._group_name)
        if not group_data:
            _LOGGER.error(f"Group {self._group_name} not found")
            return
        
        profiles = group_data.get("profiles", {})
        if preset_mode not in profiles:
            _LOGGER.error(f"Profile {preset_mode} not found in group {self._group_name}")
            return
        
        # Update active profile
        group_data["active_profile"] = preset_mode
        
        # Load the profile's schedule
        profile_data = profiles[preset_mode]
        group_data["schedule_mode"] = profile_data.get("schedule_mode", "all_days")
        group_data["schedules"] = copy.deepcopy(profile_data.get("schedules", {}))
        
        await self._storage.async_save()
        
        # Force coordinator refresh to apply new schedule immediately
        await self.coordinator.async_request_refresh()
        
        _LOGGER.info(f"Set profile {preset_mode} for group {self._group_name}")
    
    async def async_turn_on(self) -> None:
        """Enable the schedule."""
        # Enable schedule for all member entities
        for entity_id in self._member_entities:
            await self._storage.async_set_enabled(entity_id, True)
        self._enabled = True
        self.async_write_ha_state()
        _LOGGER.info("Enabled schedule for group %s", self._group_name)
    
    async def async_turn_off(self) -> None:
        """Disable the schedule."""
        # Disable schedule for all member entities
        for entity_id in self._member_entities:
            await self._storage.async_set_enabled(entity_id, False)
        self._enabled = False
        self.async_write_ha_state()
        _LOGGER.info("Disabled schedule for group %s", self._group_name)
