"""Sensor platform for Climate Scheduler."""
import logging
from datetime import timedelta
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# How many historical samples to keep for derivative calculation
SAMPLE_SIZE = 10


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Climate Scheduler sensors from a config entry."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er
    
    storage = hass.data[DOMAIN]["storage"]
    coordinator = hass.data[DOMAIN]["coordinator"]
    
    # Get settings to check if derivative sensors are enabled
    settings = storage._data.get("settings", {})
    sensors = []
    
    # Always create coldest and warmest sensors
    sensors.append(ColdestEntitySensor(hass, storage, coordinator))
    sensors.append(WarmestEntitySensor(hass, storage, coordinator))
    
    if not settings.get("create_derivative_sensors", True):
        async_add_entities(sensors, True)
        return
    
    # Get registries
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)
    
    # Get all entities from groups (both single and multi-entity groups)
    all_entity_ids = await storage.async_get_all_entities()
    
    for entity_id in all_entity_ids:
        # Skip ignored entities
        if await storage.async_is_ignored(entity_id):
            continue
            
        # Skip disabled schedules
        if not await storage.async_is_enabled(entity_id):
            continue
        
        # Find the device for this climate entity
        entity_entry = entity_registry.async_get(entity_id)
        _LOGGER.debug(f"Entity entry for {entity_id}: {entity_entry}")
        
        device_id = None
        if entity_entry and entity_entry.device_id:
            device_id = entity_entry.device_id
            _LOGGER.debug(f"Found device {device_id} for {entity_id}")
        
        # Create main temperature rate sensor
        _LOGGER.debug(f"Creating derivative sensor for {entity_id}")
        sensors.append(ClimateSchedulerRateSensor(hass, entity_id, entity_id, "current_temperature", device_id))
        
        if device_id:
            # Find all sensor entities on the same device
            device_sensors = [
                entry for entry in entity_registry.entities.values()
                if entry.device_id == device_id 
                and entry.domain == "sensor"
                and "floor" in entry.entity_id.lower()  # Look for "floor" in the entity_id
            ]
            
            _LOGGER.debug(f"Found {len(device_sensors)} floor sensors for {entity_id}: {[s.entity_id for s in device_sensors]}")
            
            # Create derivative sensors for floor temperature sensors
            for floor_sensor in device_sensors:
                _LOGGER.debug(f"Creating floor derivative sensor for {entity_id} tracking {floor_sensor.entity_id}")
                sensors.append(ClimateSchedulerRateSensor(
                    hass, 
                    entity_id,  # Associated climate entity
                    floor_sensor.entity_id,  # Floor sensor to track
                    "state",  # Use state instead of attribute
                    device_id  # Link to same device
                ))
        else:
            _LOGGER.warning(f"No device found for {entity_id}, skipping floor sensor detection")
    
    if sensors:
        async_add_entities(sensors, True)


class ClimateSchedulerRateSensor(SensorEntity):
    """Sensor that tracks the rate of temperature change for a climate entity."""

    def __init__(
        self, 
        hass: HomeAssistant, 
        climate_entity_id: str, 
        source_entity_id: str,
        temperature_attribute: str = "current_temperature",
        device_id: str = None
    ) -> None:
        """Initialize the sensor."""
        self.hass = hass
        self._climate_entity_id = climate_entity_id
        self._source_entity_id = source_entity_id
        self._temperature_attribute = temperature_attribute
        self._device_id = device_id  # Store device_id for device_info
        
        # Extract name from entity_id (e.g., climate.bedroom -> bedroom)
        entity_name = climate_entity_id.split(".")[-1]
        friendly_name = entity_name.replace("_", " ").title()
        
        # Determine if this is a floor sensor (tracking a separate sensor entity)
        is_floor = source_entity_id != climate_entity_id
        
        if is_floor:
            # For floor sensors, include the floor sensor name in unique_id to avoid collisions
            floor_sensor_name = source_entity_id.split(".")[-1]
            suffix = f"{floor_sensor_name.replace('_', ' ').title()} Rate"
            unique_suffix = floor_sensor_name
        else:
            suffix = "Rate"
            unique_suffix = "rate"
        
        _LOGGER.debug(f"Creating sensor climate_scheduler_{entity_name}_{unique_suffix} with device_id: {device_id}")
        
        self._attr_name = f"Climate Scheduler {friendly_name} {suffix}"
        self._attr_unique_id = f"climate_scheduler_{entity_name}_{unique_suffix}"
        # Explicitly set entity_id to prevent duplication issues
        self.entity_id = f"sensor.climate_scheduler_{entity_name}_{unique_suffix}"
        self._attr_device_class = None  # No standard device class for rate
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_native_unit_of_measurement = "°C/h"
        self._attr_icon = "mdi:thermometer-lines" if not is_floor else "mdi:floor-plan"
        
        # Storage for temperature samples (timestamp, temperature)
        self._samples = []
        self._attr_native_value = 0.0  # Start at 0 instead of None
        
        # Set device_info during initialization to ensure proper device linking
        if device_id:
            device_registry = dr.async_get(hass)
            device = device_registry.async_get(device_id)
            
            if device:
                self._attr_device_info = {
                    "identifiers": device.identifiers,
                }
                _LOGGER.debug(f"Linked sensor {self._attr_unique_id} to device {device_id} with identifiers {device.identifiers}")
            else:
                _LOGGER.error(f"Could not find device {device_id} in registry for sensor {self._attr_unique_id}")
        else:
            _LOGGER.warning(f"No device_id provided for sensor {self._attr_unique_id}")
    
    async def async_added_to_hass(self) -> None:
        """Register state listener when entity is added."""
        # Listen to state changes of the source entity
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._source_entity_id],
                self._async_source_state_changed,
            )
        )
        
        # Get initial state
        state = self.hass.states.get(self._source_entity_id)
        if state:
            # For separate sensor entities, use the state value
            if self._temperature_attribute == "state":
                try:
                    temp = float(state.state)
                    now = dt_util.utcnow()
                    self._samples.append((now, temp))
                except (ValueError, TypeError):
                    pass
            # For climate entity attributes, use the attribute
            elif state.attributes.get(self._temperature_attribute) is not None:
                temp = float(state.attributes[self._temperature_attribute])
                now = dt_util.utcnow()
                self._samples.append((now, temp))

    @callback
    def _async_source_state_changed(self, event) -> None:
        """Handle source entity state changes."""
        new_state = event.data.get("new_state")
        if not new_state:
            return
        
        try:
            # For separate sensor entities, use the state value
            if self._temperature_attribute == "state":
                temp = float(new_state.state)
            # For climate entity attributes, use the attribute
            else:
                current_temp = new_state.attributes.get(self._temperature_attribute)
                if current_temp is None:
                    return
                temp = float(current_temp)
            now = dt_util.utcnow()
            
            # Add new sample
            self._samples.append((now, temp))
            
            # Keep only last SAMPLE_SIZE samples
            if len(self._samples) > SAMPLE_SIZE:
                self._samples = self._samples[-SAMPLE_SIZE:]
            
            # Calculate derivative if we have enough samples
            if len(self._samples) >= 2:
                self._calculate_rate()
            
            self.async_write_ha_state()
        except (ValueError, TypeError) as e:
            _LOGGER.debug(f"Error processing temperature for {self._climate_entity_id}: {e}")

    def _calculate_rate(self) -> None:
        """Calculate the rate of temperature change."""
        if len(self._samples) < 2:
            self._attr_native_value = 0.0  # Not enough data, rate is 0
            return
        
        # Get oldest and newest samples
        oldest_time, oldest_temp = self._samples[0]
        newest_time, newest_temp = self._samples[-1]
        
        # Calculate time difference in hours
        time_diff = (newest_time - oldest_time).total_seconds() / 3600
        
        if time_diff == 0:
            self._attr_native_value = 0.0
            return
        
        # Calculate temperature change rate (°C per hour)
        temp_diff = newest_temp - oldest_temp
        rate = temp_diff / time_diff
        
        # Round to 2 decimal places
        self._attr_native_value = round(rate, 2)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional state attributes."""
        return {
            "climate_entity": self._climate_entity_id,
            "source_entity": self._source_entity_id,
            "temperature_attribute": self._temperature_attribute,
            "sample_count": len(self._samples),
            "time_window_minutes": 5,
        }


class ColdestEntitySensor(SensorEntity):
    """Sensor that shows the coldest climate entity."""

    def __init__(
        self, 
        hass: HomeAssistant,
        storage,
        coordinator
    ) -> None:
        """Initialize the sensor."""
        self.hass = hass
        self._storage = storage
        self._coordinator = coordinator
        
        self._attr_name = "Climate Scheduler Coldest Entity"
        self._attr_unique_id = "climate_scheduler_coldest_entity"
        # Explicitly set entity_id to prevent duplication issues
        self.entity_id = "sensor.climate_scheduler_coldest_entity"
        self._attr_device_class = SensorDeviceClass.TEMPERATURE
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
        self._attr_icon = "mdi:snowflake"
        self._attr_native_value = None
        self._coldest_entity_id = None
        self._coldest_friendly_name = None
        self._remove_listener = None
    
    async def async_added_to_hass(self) -> None:
        """Register state listener when entity is added."""
        # Listen to coordinator updates
        self._remove_listener = self._coordinator.async_add_listener(self._handle_coordinator_update)
        # Initial update
        await self._async_update()

    async def async_will_remove_from_hass(self) -> None:
        """Unregister listener when entity is removed."""
        if self._remove_listener:
            self._remove_listener()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        self.hass.async_create_task(self._async_update())

    async def _async_update(self) -> None:
        """Update the sensor value."""
        # Get all entities from groups
        all_entities = await self._storage.async_get_all_entities()
        
        coldest_temp = None
        coldest_entity = None
        coldest_name = None
        
        for entity_id in all_entities:
            # Skip ignored entities
            if await self._storage.async_is_ignored(entity_id):
                continue
            
            state = self.hass.states.get(entity_id)
            if not state:
                continue
            
            # Check if entity has current_temperature attribute
            current_temp = state.attributes.get("current_temperature")
            if current_temp is None:
                continue
            
            try:
                temp = float(current_temp)
                if coldest_temp is None or temp < coldest_temp:
                    coldest_temp = temp
                    coldest_entity = entity_id
                    coldest_name = state.attributes.get("friendly_name", entity_id)
            except (ValueError, TypeError):
                continue
        
        self._attr_native_value = coldest_temp
        self._coldest_entity_id = coldest_entity
        self._coldest_friendly_name = coldest_name
        self.async_write_ha_state()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional state attributes."""
        return {
            "entity_id": self._coldest_entity_id,
            "friendly_name": self._coldest_friendly_name,
        }


class WarmestEntitySensor(SensorEntity):
    """Sensor that shows the warmest climate entity."""

    def __init__(
        self, 
        hass: HomeAssistant,
        storage,
        coordinator
    ) -> None:
        """Initialize the sensor."""
        self.hass = hass
        self._storage = storage
        self._coordinator = coordinator
        
        self._attr_name = "Climate Scheduler Warmest Entity"
        self._attr_unique_id = "climate_scheduler_warmest_entity"
        # Explicitly set entity_id to prevent duplication issues
        self.entity_id = "sensor.climate_scheduler_warmest_entity"
        self._attr_device_class = SensorDeviceClass.TEMPERATURE
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
        self._attr_icon = "mdi:fire"
        self._attr_native_value = None
        self._warmest_entity_id = None
        self._warmest_friendly_name = None
        self._remove_listener = None
    
    async def async_added_to_hass(self) -> None:
        """Register state listener when entity is added."""
        # Listen to coordinator updates
        self._remove_listener = self._coordinator.async_add_listener(self._handle_coordinator_update)
        # Initial update
        await self._async_update()

    async def async_will_remove_from_hass(self) -> None:
        """Unregister listener when entity is removed."""
        if self._remove_listener:
            self._remove_listener()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        self.hass.async_create_task(self._async_update())

    async def _async_update(self) -> None:
        """Update the sensor value."""
        # Get all entities from groups
        all_entities = await self._storage.async_get_all_entities()
        
        warmest_temp = None
        warmest_entity = None
        warmest_name = None
        
        for entity_id in all_entities:
            # Skip ignored entities
            if await self._storage.async_is_ignored(entity_id):
                continue
            
            state = self.hass.states.get(entity_id)
            if not state:
                continue
            
            # Check if entity has current_temperature attribute
            current_temp = state.attributes.get("current_temperature")
            if current_temp is None:
                continue
            
            try:
                temp = float(current_temp)
                if warmest_temp is None or temp > warmest_temp:
                    warmest_temp = temp
                    warmest_entity = entity_id
                    warmest_name = state.attributes.get("friendly_name", entity_id)
            except (ValueError, TypeError):
                continue
        
        self._attr_native_value = warmest_temp
        self._warmest_entity_id = warmest_entity
        self._warmest_friendly_name = warmest_name
        self.async_write_ha_state()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional state attributes."""
        return {
            "entity_id": self._warmest_entity_id,
            "friendly_name": self._warmest_friendly_name,
        }
