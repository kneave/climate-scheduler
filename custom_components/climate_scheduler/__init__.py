"""The Climate Scheduler integration."""
import logging
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.util import json as json_util
from aiohttp import web

from .const import DOMAIN, UPDATE_INTERVAL_SECONDS
from .coordinator import HeatingSchedulerCoordinator
from .storage import ScheduleStorage
# Expose dynamic service descriptions for Home Assistant UI
from .services import async_get_services  # noqa: E402,F401

_LOGGER = logging.getLogger(__name__)


async def _async_setup_common(hass: HomeAssistant) -> None:
    """Common setup for storage, coordinator, services and panel."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    # Initialize storage once
    storage: ScheduleStorage | None = hass.data[DOMAIN].get("storage")
    if storage is None:
        storage = ScheduleStorage(hass)
        await storage.async_load()
        hass.data[DOMAIN]["storage"] = storage

    # Initialize coordinator once
    coordinator: HeatingSchedulerCoordinator | None = hass.data[DOMAIN].get("coordinator")
    if coordinator is None:
        coordinator = HeatingSchedulerCoordinator(
            hass,
            storage,
            timedelta(seconds=UPDATE_INTERVAL_SECONDS)
        )
        hass.data[DOMAIN]["coordinator"] = coordinator

        # Start coordinator updates
        _LOGGER.info(f"Starting coordinator with {UPDATE_INTERVAL_SECONDS}s update interval")
        await coordinator.async_refresh()
        _LOGGER.info("Forcing initial temperature sync for all entities")
        await coordinator.force_update_all()

        # Schedule periodic updates
        async def _scheduled_update(now):
            """Handle scheduled update."""
            await coordinator.async_request_refresh()

        from homeassistant.helpers.event import async_track_time_interval
        async_track_time_interval(
            hass,
            _scheduled_update,
            timedelta(seconds=UPDATE_INTERVAL_SECONDS)
        )

    # Avoid re-registering services
    if hass.data[DOMAIN].get("services_registered"):
        return

    # Register services from services module  
    from . import services as service_module
    await service_module.async_setup_services(hass)

    hass.data[DOMAIN]["services_registered"] = True

    # Register frontend card resources
    await _register_frontend_resources(hass)


async def _register_frontend_resources(hass: HomeAssistant) -> None:
    """Register the bundled frontend card as a Lovelace resource."""
    # Get version from manifest.json first
    manifest_path = Path(__file__).parent / "manifest.json"
    try:
        import json
        manifest_text = await hass.async_add_executor_job(manifest_path.read_text)
        manifest = json.loads(manifest_text)
        frontend_version = manifest.get("version", f"u{int(time.time())}")
        _LOGGER.debug("Current integration version: %s", frontend_version)
    except Exception as e:
        _LOGGER.warning("Failed to read manifest version: %s", e)
        frontend_version = f"u{int(time.time())}"
    
    # Check if we've already registered this version
    registered_version = hass.data[DOMAIN].get("frontend_registered_version")
    if registered_version == frontend_version:
        _LOGGER.debug("Frontend already registered with version %s", frontend_version)
        return

    # Register static path for frontend files
    frontend_path = Path(__file__).parent / "frontend"
    if not frontend_path.exists():
        _LOGGER.warning("Frontend directory not found at %s", frontend_path)
        return

    # Register the static path using the correct HA API
    should_cache = False

    await hass.http.async_register_static_paths([
        StaticPathConfig(f"/local/{DOMAIN}", str(frontend_path), should_cache)
    ])
    _LOGGER.info("Registered frontend static path: %s -> %s", f"/local/{DOMAIN}", frontend_path)

    # Register Lovelace resource
    try:
        # Get lovelace resources
        lovelace_data = hass.data.get("lovelace")
        if lovelace_data is None:
            _LOGGER.warning("Lovelace integration not available, card will need manual registration")
            hass.data[DOMAIN]["frontend_registered_version"] = frontend_version
            return

        # Get resources based on HA version
        from homeassistant.const import __version__ as ha_version
        version_parts = [int(x) for x in ha_version.split(".")[:2]]
        version_number = version_parts[0] * 1000 + version_parts[1]
        
        if version_number >= 2025002:  # 2025.2.0 and later
            resources = lovelace_data.resources
        else:
            resources = lovelace_data.get("resources")

        if resources is None:
            _LOGGER.warning("Lovelace resources not available, card will need manual registration")
            hass.data[DOMAIN]["frontend_registered_version"] = frontend_version
            return

        # Check for YAML mode
        if not hasattr(resources, "store") or resources.store is None:
            _LOGGER.info("Lovelace YAML mode detected, card must be registered manually")
            hass.data[DOMAIN]["frontend_registered_version"] = frontend_version
            return

        # Ensure resources are loaded
        if not resources.loaded:
            await resources.async_load()

        # Build URL with version for cache busting
        base_url = f"/local/{DOMAIN}/climate-scheduler-card.js"
        url = f"{base_url}?v={frontend_version}"
        
        # Check for old standalone card installations and remove them
        old_card_patterns = [
            "/hacsfiles/climate-scheduler-card/",
            "/local/community/climate-scheduler-card/",
            "climate-scheduler-card.js"
        ]
        
        existing_entry = None
        removed_old = False
        for entry in list(resources.async_items()):
            entry_url = entry["url"]
            entry_base_url = entry_url.split("?")[0]
            
            # Check if this is our new bundled card
            if entry_base_url == base_url:
                existing_entry = entry
                continue
            
            # Check if this is an old standalone card installation
            if any(pattern in entry_url for pattern in old_card_patterns):
                _LOGGER.info("Removing old standalone card registration: %s", entry_url)
                await resources.async_delete_item(entry["id"])
                removed_old = True

        if existing_entry:
            # Always update to ensure latest version
            existing_url = existing_entry["url"]
            existing_version = existing_url.split("?v=")[1] if "?v=" in existing_url else "unknown"
            
            if existing_entry["url"] != url:
                _LOGGER.info("Updating bundled frontend card from version %s to %s", existing_version, frontend_version)
                await resources.async_update_item(existing_entry["id"], {"url": url})
            else:
                _LOGGER.debug("Bundled frontend card already registered with current version %s", frontend_version)
        else:
            # Register the bundled card
            await resources.async_create_item({"res_type": "module", "url": url})
            if removed_old:
                _LOGGER.info("Successfully migrated to bundled frontend card (version %s)", frontend_version)
            else:
                _LOGGER.info("Successfully registered bundled frontend card (version %s)", frontend_version)

    except Exception as err:
        _LOGGER.error("Failed to auto-register frontend card: %s", err)
    
    # Store the version we just registered
    hass.data[DOMAIN]["frontend_registered_version"] = frontend_version


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up via YAML by importing into a config entry, else no-op."""
    if DOMAIN in config:
        # Import legacy YAML into a config entry
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN, context={"source": config_entries.SOURCE_IMPORT}
            )
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Climate Scheduler from a config entry."""
    await _async_setup_common(hass)
    
    # Forward entry setup to sensor platform for derivative sensors
    await hass.config_entries.async_forward_entry_setups(entry, ["sensor"])
    
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Unload sensor platform
    await hass.config_entries.async_unload_platforms(entry, ["sensor"])
    
    # Remove panel and services only if this is the last entry
    entries = hass.config_entries.async_entries(DOMAIN)
    if len(entries) <= 1:
        # Unregister services
        for svc in [
            "set_schedule","get_schedule","clear_schedule","enable_schedule","disable_schedule",
            "sync_all","create_group","delete_group","add_to_group","remove_from_group",
            "get_groups","set_group_schedule","enable_group","disable_group","get_settings",
            "save_settings","reload_integration","advance_schedule","advance_group",
            "cancel_advance","get_advance_status","clear_advance_history","create_profile",
            "delete_profile","rename_profile","set_active_profile","get_profiles",
            "cleanup_derivative_sensors","factory_reset"
        ]:
            try:
                hass.services.async_remove(DOMAIN, svc)
            except Exception:  # noqa: BLE001
                pass
        hass.data.pop(DOMAIN, None)
    return True

