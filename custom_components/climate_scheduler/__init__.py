"""The Climate Scheduler integration."""
import logging
import json
import time
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers.typing import ConfigType
from homeassistant.components.http import HomeAssistantView
from aiohttp import web
import voluptuous as vol
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, UPDATE_INTERVAL_SECONDS
from .coordinator import HeatingSchedulerCoordinator
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)

# Load version from manifest.json
manifest_path = Path(__file__).parent / "manifest.json"
with open(manifest_path) as f:
    manifest_data = json.load(f)
    VERSION = manifest_data.get("version", "unknown")

# No cache busting - browser caching through iframe is too aggressive

# Service schemas
SET_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id,
    vol.Required("nodes"): vol.All(cv.ensure_list, [
        vol.Schema({
            vol.Required("time"): cv.string,
            vol.Required("temp"): vol.Coerce(float),
            vol.Optional("hvac_mode"): cv.string,
            vol.Optional("fan_mode"): cv.string,
            vol.Optional("swing_mode"): cv.string,
            vol.Optional("preset_mode"): cv.string
        })
    ]),
    vol.Optional("day"): cv.string,
    vol.Optional("schedule_mode"): cv.string
})

ENTITY_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id
})

CREATE_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string
})

DELETE_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string
})

ADD_TO_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string,
    vol.Required("entity_id"): cv.entity_id
})

REMOVE_FROM_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string,
    vol.Required("entity_id"): cv.entity_id
})

SET_GROUP_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string,
    vol.Required("nodes"): vol.All(cv.ensure_list, [
        vol.Schema({
            vol.Required("time"): cv.string,
            vol.Required("temp"): vol.Coerce(float),
            vol.Optional("hvac_mode"): cv.string,
            vol.Optional("fan_mode"): cv.string,
            vol.Optional("swing_mode"): cv.string,
            vol.Optional("preset_mode"): cv.string
        })
    ]),
    vol.Optional("day"): cv.string,
    vol.Optional("schedule_mode"): cv.string
})

ENABLE_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string
})

DISABLE_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string
})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Climate Scheduler component."""
    hass.data[DOMAIN] = {}
    
    # Initialize storage
    storage = ScheduleStorage(hass)
    await storage.async_load()
    hass.data[DOMAIN]["storage"] = storage
    
    # Initialize coordinator
    coordinator = HeatingSchedulerCoordinator(
        hass,
        storage,
        timedelta(seconds=UPDATE_INTERVAL_SECONDS)
    )
    hass.data[DOMAIN]["coordinator"] = coordinator
    
    # Start coordinator updates
    _LOGGER.info(f"Starting coordinator with {UPDATE_INTERVAL_SECONDS}s update interval")
    await coordinator.async_refresh()
    
    # Force initial temperature sync on startup
    _LOGGER.info("Forcing initial temperature sync for all entities")
    await coordinator.force_update_all()
    
    # Schedule periodic updates
    async def _scheduled_update(now):
        """Handle scheduled update."""
        await coordinator.async_request_refresh()
    
    # Use async_track_time_interval for periodic updates
    from homeassistant.helpers.event import async_track_time_interval
    async_track_time_interval(
        hass,
        _scheduled_update,
        timedelta(seconds=UPDATE_INTERVAL_SECONDS)
    )
    
    # Register services
    async def handle_set_schedule(call: ServiceCall) -> None:
        """Handle set_schedule service call."""
        entity_id = call.data["entity_id"]
        nodes = call.data["nodes"]
        day = call.data.get("day")  # Optional: mon, tue, wed, thu, fri, sat, sun, weekday, weekend, all_days
        schedule_mode = call.data.get("schedule_mode")  # Optional: all_days, 5/2, individual
        await storage.async_set_schedule(entity_id, nodes, day, schedule_mode)
        _LOGGER.info(f"Schedule set for {entity_id} (day: {day}, mode: {schedule_mode})")
    
    async def handle_get_schedule(call: ServiceCall) -> dict:
        """Handle get_schedule service call."""
        entity_id = call.data["entity_id"]
        day = call.data.get("day")  # Optional: which day to get
        schedule = await storage.async_get_schedule(entity_id, day)
        _LOGGER.info(f"Schedule for {entity_id} (day: {day}): {schedule}")
        # Return as service response data including enabled state
        if schedule:
            return {
                "nodes": schedule.get("nodes", []),
                "enabled": schedule.get("enabled", True),
                "schedule_mode": schedule.get("schedule_mode", "all_days"),
                "schedules": schedule.get("schedules", {})
            }
        return {"nodes": [], "enabled": False, "schedule_mode": "all_days", "schedules": {}}
    
    async def handle_clear_schedule(call: ServiceCall) -> None:
        """Handle clear_schedule service call."""
        entity_id = call.data["entity_id"]
        await storage.async_remove_entity(entity_id)
        _LOGGER.info(f"Schedule cleared for {entity_id}")
    
    async def handle_enable_schedule(call: ServiceCall) -> None:
        """Handle enable_schedule service call."""
        entity_id = call.data["entity_id"]
        await storage.async_set_enabled(entity_id, True)
        _LOGGER.info(f"Schedule enabled for {entity_id}")
        
        # Clear last node state to force immediate update
        if entity_id in coordinator.last_node_states:
            del coordinator.last_node_states[entity_id]
        
        # Immediately apply the current schedule
        await coordinator.async_refresh()
    
    async def handle_disable_schedule(call: ServiceCall) -> None:
        """Handle disable_schedule service call."""
        entity_id = call.data["entity_id"]
        await storage.async_set_enabled(entity_id, False)
        _LOGGER.info(f"Schedule disabled for {entity_id}")
    
    async def handle_sync_all(call: ServiceCall) -> None:
        """Handle sync_all service call - force update all thermostats to scheduled temps."""
        _LOGGER.info("Forcing temperature sync for all entities")
        await coordinator.force_update_all()
    
    async def handle_create_group(call: ServiceCall) -> None:
        """Handle create_group service call."""
        group_name = call.data["group_name"]
        try:
            await storage.async_create_group(group_name)
            _LOGGER.info(f"Group '{group_name}' created")
        except ValueError as e:
            _LOGGER.error(f"Failed to create group: {e}")
            raise
    
    async def handle_delete_group(call: ServiceCall) -> None:
        """Handle delete_group service call."""
        group_name = call.data["group_name"]
        await storage.async_delete_group(group_name)
        _LOGGER.info(f"Group '{group_name}' deleted")
    
    async def handle_add_to_group(call: ServiceCall) -> None:
        """Handle add_to_group service call."""
        group_name = call.data["group_name"]
        entity_id = call.data["entity_id"]
        try:
            await storage.async_add_entity_to_group(group_name, entity_id)
            _LOGGER.info(f"Added {entity_id} to group '{group_name}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to add to group: {e}")
            raise
    
    async def handle_remove_from_group(call: ServiceCall) -> None:
        """Handle remove_from_group service call."""
        group_name = call.data["group_name"]
        entity_id = call.data["entity_id"]
        await storage.async_remove_entity_from_group(group_name, entity_id)
        _LOGGER.info(f"Removed {entity_id} from group '{group_name}'")
    
    async def handle_get_groups(call: ServiceCall) -> dict:
        """Handle get_groups service call."""
        groups = await storage.async_get_groups()
        return {"groups": groups}
    
    async def handle_set_group_schedule(call: ServiceCall) -> None:
        """Handle set_group_schedule service call."""
        group_name = call.data["group_name"]
        nodes = call.data["nodes"]
        day = call.data.get("day")  # Optional: mon, tue, wed, thu, fri, sat, sun, weekday, weekend, all_days
        schedule_mode = call.data.get("schedule_mode")  # Optional: all_days, 5/2, individual
        try:
            await storage.async_set_group_schedule(group_name, nodes, day, schedule_mode)
        except ValueError as err:
            _LOGGER.error(f"Error setting group schedule: {err}")
            raise
    
    async def handle_enable_group(call: ServiceCall) -> None:
        """Handle enable_group service call."""
        group_name = call.data["group_name"]
        try:
            await storage.async_enable_group(group_name)
            _LOGGER.info(f"Enabled group '{group_name}'")
            
            # Clear last node states for all entities in the group to force immediate update
            group_data = await storage.async_get_groups()
            if group_name in group_data and "entities" in group_data[group_name]:
                for entity_id in group_data[group_name]["entities"]:
                    if entity_id in coordinator.last_node_states:
                        del coordinator.last_node_states[entity_id]
            
            # Immediately apply the current schedule to all entities in the group
            await coordinator.async_refresh()
        except ValueError as err:
            _LOGGER.error(f"Error enabling group: {err}")
            raise
    
    async def handle_disable_group(call: ServiceCall) -> None:
        """Handle disable_group service call."""
        group_name = call.data["group_name"]
        try:
            await storage.async_disable_group(group_name)
            _LOGGER.info(f"Disabled group '{group_name}'")
        except ValueError as err:
            _LOGGER.error(f"Error disabling group: {err}")
            raise
    
    async def handle_get_settings(call: ServiceCall) -> dict:
        """Handle get_settings service call."""
        settings = await storage.async_get_settings()
        return settings
    
    async def handle_save_settings(call: ServiceCall) -> None:
        """Handle save_settings service call."""
        settings_json = call.data.get("settings", "{}")
        try:
            settings = json.loads(settings_json)
            await storage.async_save_settings(settings)
            _LOGGER.info(f"Settings saved")
        except (json.JSONDecodeError, ValueError) as e:
            _LOGGER.error(f"Failed to save settings: {e}")
            raise
    
    async def handle_reload_integration(call: ServiceCall) -> None:
        """Handle reload_integration service call - reloads this integration."""
        _LOGGER.info("Reloading Climate Scheduler integration via service call")
        # Find this integration's config entry
        for entry in hass.config_entries.async_entries(DOMAIN):
            await hass.config_entries.async_reload(entry.entry_id)
            _LOGGER.info(f"Reloaded config entry: {entry.entry_id}")
    
    hass.services.async_register(DOMAIN, "set_schedule", handle_set_schedule, schema=SET_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "get_schedule", handle_get_schedule, schema=ENTITY_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_schedule", handle_clear_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "enable_schedule", handle_enable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "disable_schedule", handle_disable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "sync_all", handle_sync_all)
    hass.services.async_register(DOMAIN, "create_group", handle_create_group, schema=CREATE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "delete_group", handle_delete_group, schema=DELETE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "add_to_group", handle_add_to_group, schema=ADD_TO_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_from_group", handle_remove_from_group, schema=REMOVE_FROM_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "get_groups", handle_get_groups, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "set_group_schedule", handle_set_group_schedule, schema=SET_GROUP_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "enable_group", handle_enable_group, schema=ENABLE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "disable_group", handle_disable_group, schema=DISABLE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "get_settings", handle_get_settings, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "save_settings", handle_save_settings, schema=vol.Schema({vol.Required("settings"): cv.string}))
    hass.services.async_register(DOMAIN, "reload_integration", handle_reload_integration)
    
    # Register frontend panel
    await async_register_panel(hass)
    
    return True


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the frontend panel."""
    frontend_path = Path(__file__).parent / "frontend"
    
    _LOGGER.info(f"Frontend path: {frontend_path}")
    _LOGGER.info(f"Frontend path exists: {frontend_path.exists()}")
    
    class ClimateSchedulerStaticView(HomeAssistantView):
        """View to serve static files with proper versioning."""
        
        url = r"/api/climate_scheduler/{filename:.+}"
        name = "climate_scheduler:static"
        requires_auth = False
        
        async def get(self, request, filename):
            """Serve static files with proper MIME types and versioning."""
            file_path = frontend_path / filename
            _LOGGER.debug(f"Serving file: {filename}, path: {file_path}, exists: {file_path.exists()}")
            
            if not file_path.exists() or not file_path.is_file():
                _LOGGER.warning(f"File not found: {filename}")
                return web.Response(text=f"File not found: {filename}", status=404)
            
            # Determine content type based on file extension
            content_type = 'text/plain'
            if filename.endswith('.js'):
                content_type = 'application/javascript'
            elif filename.endswith('.css'):
                content_type = 'text/css'
            elif filename.endswith('.html'):
                content_type = 'text/html'
            elif filename.endswith('.json'):
                content_type = 'application/json'
            
            # Read file content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Create response with proper headers
            response = web.Response(text=content, content_type=content_type)
            
            # Add cache control headers that work with version parameter
            # Files with ?v= parameter can be cached, others should not
            if 'v' in request.query:
                # Long cache for versioned files
                response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            else:
                # No cache for non-versioned files
                response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                response.headers['Pragma'] = 'no-cache'
                response.headers['Expires'] = '0'
            
            return response
    
    hass.http.register_view(ClimateSchedulerStaticView())
    
    _LOGGER.info("Static file view registered successfully")
    
    # Register the custom panel
    from homeassistant.components import frontend
    import time
    
    # Get version string for cache busting
    # Use timestamp in development mode for instant updates
    version_param = VERSION.replace('.', '')
    # Add timestamp to force reload on integration reload
    version_param = f"{version_param}_{int(time.time())}"
    
    # Register panel as custom panel with module URL
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Climate Scheduler",
        sidebar_icon="mdi:calendar-clock",
        frontend_url_path="climate_scheduler",
        config={
            "_panel_custom": {
                "name": "climate-scheduler-panel",
                "module_url": f"/api/climate_scheduler/panel.js?v={version_param}",
                "embed_iframe": False
            }
        },
        require_admin=False
    )
    
    _LOGGER.info(f"Custom panel registered successfully with version {version_param}")

