"""The Climate Scheduler integration."""
import logging
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
from .version import VERSION, BUILD

_LOGGER = logging.getLogger(__name__)

# Service schemas
SET_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id,
    vol.Required("nodes"): vol.All(cv.ensure_list, [
        vol.Schema({
            vol.Required("time"): cv.string,
            vol.Required("temp"): vol.Coerce(float)
        })
    ])
})

ENTITY_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id
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
    
    hass.services.async_register(DOMAIN, "set_schedule", handle_set_schedule, schema=SET_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "get_schedule", handle_get_schedule, schema=ENTITY_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_schedule", handle_clear_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "enable_schedule", handle_enable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "disable_schedule", handle_disable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "sync_all", handle_sync_all)
    
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
                response = web.FileResponse(file_path)
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
                    "version": VERSION,
                    "build": BUILD
                })
            
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
            "url": f"/climate_scheduler_panel/index.html?cachebust={BUILD}"
        },
        require_admin=False
    )
    
    _LOGGER.info("Panel registered successfully")
