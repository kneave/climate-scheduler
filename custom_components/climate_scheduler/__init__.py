"""The Climate Scheduler integration."""
import logging
import json
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

# Load version from manifest.json
manifest_path = Path(__file__).parent / "manifest.json"
with open(manifest_path) as f:
    manifest_data = json.load(f)
    VERSION = manifest_data.get("version", "unknown")

_LOGGER = logging.getLogger(__name__)

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
    ])
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
    ])
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
        await storage.async_set_schedule(entity_id, nodes)
        _LOGGER.info(f"Schedule set for {entity_id}")
    
    async def handle_get_schedule(call: ServiceCall) -> dict:
        """Handle get_schedule service call."""
        entity_id = call.data["entity_id"]
        schedule = await storage.async_get_schedule(entity_id)
        _LOGGER.info(f"Schedule for {entity_id}: {schedule}")
        # Return as service response data including enabled state
        if schedule:
            return {
                "nodes": schedule.get("nodes", []),
                "enabled": schedule.get("enabled", True)
            }
        return {"nodes": [], "enabled": False}
    
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
        try:
            await storage.async_set_group_schedule(group_name, nodes)
            _LOGGER.info(f"Schedule set for group '{group_name}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to set group schedule: {e}")
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
    hass.services.async_register(DOMAIN, "get_settings", handle_get_settings, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "save_settings", handle_save_settings, schema=vol.Schema({vol.Required("settings"): cv.string}))
    
    # Register frontend panel
    await async_register_panel(hass)
    
    return True


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the frontend panel."""
    frontend_path = Path(__file__).parent / "frontend"
    
    _LOGGER.info(f"Frontend path: {frontend_path}")
    _LOGGER.info(f"Frontend path exists: {frontend_path.exists()}")
    
    class HeatingSchedulerPanelView(HomeAssistantView):
        """View to serve the climate scheduler panel."""
        
        url = "/climate_scheduler_panel/index.html"
        name = "climate_scheduler:panel"
        requires_auth = False
        
        async def get(self, request):
            """Serve the panel HTML."""
            file_path = frontend_path / "index.html"
            _LOGGER.info(f"Serving panel from: {file_path}, exists: {file_path.exists()}")
            if file_path.exists():
                # Read and inject VERSION
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                version_string = VERSION.replace('.', '')
                content = content.replace('{{VERSION}}', version_string)
                _LOGGER.info(f"Injecting VERSION={version_string} into index.html")
                
                response = web.Response(text=content, content_type='text/html')
                # Allow iframe embedding
                response.headers['X-Frame-Options'] = 'SAMEORIGIN'
                response.headers['Content-Security-Policy'] = "frame-ancestors 'self'"
                return response
            else:
                return web.Response(text="File not found", status=404)
    
    class HeatingSchedulerStaticView(HomeAssistantView):
        """View to serve static files."""
        
        url = r"/climate_scheduler_panel/{filename:.+}"
        name = "climate_scheduler:static"
        requires_auth = False
        
        async def get(self, request, filename):
            """Serve static files."""
            # Special endpoint for version info
            if filename == "version.json":
                return web.json_response({
                    "version": VERSION
                })
            
            # Special handling for index.html - inject VERSION
            if filename == "index.html":
                file_path = frontend_path / filename
                _LOGGER.info(f"Serving index.html with VERSION injection. VERSION={VERSION}")
                if file_path.exists() and file_path.is_file():
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    # Replace {{VERSION}} placeholder with actual version
                    version_string = VERSION.replace('.', '')
                    _LOGGER.info(f"Replacing {{{{VERSION}}}} with {version_string}")
                    content = content.replace('{{VERSION}}', version_string)
                    _LOGGER.info(f"Content length after replacement: {len(content)}, contains placeholder: {'{' in content and 'VERSION' in content}")
                    response = web.Response(text=content, content_type='text/html')
                    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
                    return response
            
            file_path = frontend_path / filename
            _LOGGER.info(f"Serving static file: {file_path}, exists: {file_path.exists()}")
            if file_path.exists() and file_path.is_file():
                response = web.FileResponse(file_path)
                # Allow iframe embedding
                response.headers['X-Frame-Options'] = 'SAMEORIGIN'
                return response
            return web.Response(text=f"File not found: {filename}", status=404)
    
    hass.http.register_view(HeatingSchedulerPanelView())
    hass.http.register_view(HeatingSchedulerStaticView())
    
    _LOGGER.info("Views registered successfully")
    
    # Register the panel
    from homeassistant.components import frontend
    frontend.async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title="Climate Scheduler",
        sidebar_icon="mdi:calendar-clock",
        frontend_url_path="climate_scheduler",
        config={
            "url": f"/climate_scheduler_panel/index.html?v={VERSION.replace('.', '')}"
        },
        require_admin=False
    )
    
    _LOGGER.info("Panel registered successfully")
