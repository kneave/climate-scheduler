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

    # Avoid re-registering services, but be robust across updates/reloads.
    # During an in-process reload/upgrade, `hass.data` can persist while new
    # services from a newer version are missing. If so, re-register.
    if hass.data[DOMAIN].get("services_registered"):
        # Keep this list in sync with the services registered in `services.py`.
        expected_services = (
            "recreate_all_sensors",
            "cleanup_malformed_sensors",
            "set_schedule",
            "get_schedule",
            "clear_schedule",
            "enable_schedule",
            "disable_schedule",
            "set_ignored",
            "sync_all",
            "create_group",
            "delete_group",
            "rename_group",
            "add_to_group",
            "remove_from_group",
            "get_groups",
            "list_groups",
            "list_profiles",
            "set_group_schedule",
            "enable_group",
            "disable_group",
            "get_settings",
            "save_settings",
            "reload_integration",
            "advance_schedule",
            "advance_group",
            "cancel_advance",
            "get_advance_status",
            "clear_advance_history",
            "test_fire_event",
            "create_profile",
            "delete_profile",
            "rename_profile",
            "set_active_profile",
            "get_profiles",
            "cleanup_derivative_sensors",
            "factory_reset",
            "reregister_card",
            "diagnostics",
        )
        missing = [s for s in expected_services if not hass.services.has_service(DOMAIN, s)]
        if not missing:
            # Services are already registered; still ensure frontend resources
            # are registered/updated (important after install/upgrade or when
            # Lovelace wasn't ready earlier during startup).
            await _register_frontend_resources(hass)
            return
        _LOGGER.warning(
            "Climate Scheduler services flagged as registered but missing %s; re-registering services",
            missing,
        )
        hass.data[DOMAIN]["services_registered"] = False

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
    
    # Always attempt to (re)register frontend resources on startup/update.
    # We intentionally do not short-circuit when the stored version matches
    # the current one, because we want to remove any existing resource
    # entries and recreate them during install/update/reboot.

    # Register static path for frontend files
    frontend_path = Path(__file__).parent / "frontend"
    if not frontend_path.exists():
        _LOGGER.warning("Frontend directory not found at %s", frontend_path)
        return

    # Register the static path using the correct HA API.
    # This only needs to happen once per HA runtime; avoid repeated registration
    # and noisy logs when config entries reload.
    should_cache = False
    if not hass.data[DOMAIN].get("frontend_static_registered"):
        # Expose at /<domain>/static so integrations can reliably reference it
        await hass.http.async_register_static_paths([
            StaticPathConfig(f"/{DOMAIN}/static", str(frontend_path), should_cache)
        ])
        hass.data[DOMAIN]["frontend_static_registered"] = True
        _LOGGER.info("Registered frontend static path: %s -> %s", f"/{DOMAIN}/static", frontend_path)
    else:
        _LOGGER.debug("Frontend static path already registered")

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
            return

        # Check for YAML mode
        if not hasattr(resources, "store") or resources.store is None:
            _LOGGER.info("Lovelace YAML mode detected, card must be registered manually")
            
            # Check if the card is already registered in YAML
            base_url = f"/{DOMAIN}/static/climate-scheduler-card.js"
            card_already_registered = False
            
            try:
                for entry in resources.async_items():
                    entry_url = entry.get("url", "")
                    entry_base_url = entry_url.split("?")[0]
                    if entry_base_url == base_url:
                        card_already_registered = True
                        _LOGGER.info("Card is already registered in YAML configuration")
                        # Dismiss any existing notification since card is now present
                        await hass.services.async_call(
                            "persistent_notification",
                            "dismiss",
                            {"notification_id": f"{DOMAIN}_yaml_mode"},
                        )
                        break
            except Exception as e:
                _LOGGER.debug("Could not check YAML resources: %s", e)
            
            # Only create notification if card is NOT registered
            if not card_already_registered:
                _LOGGER.warning("Card is not registered in YAML configuration - notification will be created")
                await hass.services.async_call(
                    "persistent_notification",
                    "create",
                    {
                        "notification_id": f"{DOMAIN}_yaml_mode",
                        "title": "Climate Scheduler: Manual Card Registration Required",
                        "message": (
                            "Your Lovelace dashboard is configured via YAML mode. "
                            "The Climate Scheduler card cannot be auto-registered.\n\n"
                            "**To add the card manually:**\n\n"
                            "Add this to your Lovelace resources configuration:\n\n"
                            f"```yaml\n"
                            f"lovelace:\n"
                            f"  mode: yaml\n"
                            f"  resources:\n"
                            f"    - url: /{DOMAIN}/static/climate-scheduler-card.js?v={frontend_version}\n"
                            f"      type: module\n"
                            f"```\n\n"
                            "Then restart Home Assistant and refresh your browser."
                        ),
                    },
                )
            return

        # Ensure resources are loaded
        if not resources.loaded:
            await resources.async_load()

        # Build URL with version for cache busting
        # Use the integration-hosted static path we just registered
        base_url = f"/{DOMAIN}/static/climate-scheduler-card.js"
        url = f"{base_url}?v={frontend_version}"
        
        # Check for old standalone card installations and remove them
        old_card_patterns = [
            "/hacsfiles/climate-scheduler/",
            "/local/community/climate-scheduler/",
            "climate-scheduler-card.js",
            f"/{DOMAIN}/static/"
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

        # If there's an existing bundled registration, remove it first so
        # we always create a fresh entry (ensures consistent behavior on
        # install/update/reboot and avoids stale IDs or metadata).
        if existing_entry:
            try:
                _LOGGER.info("Removing existing bundled frontend card registration: %s", existing_entry.get("url"))
                await resources.async_delete_item(existing_entry["id"])
            except Exception:  # noqa: BLE001
                _LOGGER.debug("Failed to remove existing bundled frontend resource, will attempt to (re)create it")

        # Create a new resource entry for the bundled card
        if hasattr(resources, "async_create_item"):
            await resources.async_create_item({"res_type": "module", "url": url})
            
            if removed_old:
                _LOGGER.info("Successfully migrated to bundled frontend card (version %s)", frontend_version)
            else:
                _LOGGER.info("Successfully registered bundled frontend card (version %s)", frontend_version)
        else:
            _LOGGER.warning("Cannot auto-register card: Lovelace resources are in YAML mode")
        
        # Note: Version mismatch detection and refresh notification is handled by the frontend
        # JavaScript, which can accurately detect when the browser cache is stale

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
    
    # Get current version from manifest
    manifest_path = Path(__file__).parent / "manifest.json"
    current_version = None
    try:
        manifest_text = await hass.async_add_executor_job(manifest_path.read_text)
        manifest = json.loads(manifest_text)
        current_version = manifest.get("version")
    except Exception as e:
        _LOGGER.warning("Failed to read manifest version: %s", e)
    
    # Check if this is first install or an upgrade
    stored_version = entry.data.get("version")
    is_first_install = stored_version is None
    is_upgrade = stored_version is not None and current_version != stored_version
    
    # Update version in config entry if changed
    if current_version and (is_first_install or is_upgrade):
        new_data = dict(entry.data)
        new_data["version"] = current_version
        hass.config_entries.async_update_entry(entry, data=new_data)
        
        if is_first_install:
            _LOGGER.info("First install detected (version %s) - will reload integration after setup", current_version)
        elif is_upgrade:
            _LOGGER.info("Upgrade detected (%s -> %s) - will reload integration after setup", stored_version, current_version)
    
    # Forward entry setup to sensor, climate, and switch platforms
    await hass.config_entries.async_forward_entry_setups(entry, ["sensor", "climate", "switch"])
    
    # Reload integration after first install or upgrade to ensure UI is properly initialized
    if is_first_install or is_upgrade:
        async def _delayed_reload():
            """Reload integration after a short delay to allow setup to complete."""
            await asyncio.sleep(2)  # Wait for platforms to fully initialize
            try:
                _LOGGER.info("Performing post-setup reload to initialize UI")
                await hass.config_entries.async_reload(entry.entry_id)
            except Exception as e:
                _LOGGER.warning("Post-setup reload failed: %s", e)
        
        import asyncio
        hass.async_create_task(_delayed_reload())
    
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Unload all platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, ["sensor", "climate", "switch"])
    
    # Remove panel and services only if this is the last entry
    entries = hass.config_entries.async_entries(DOMAIN)
    if len(entries) <= 1:
        _LOGGER.debug("[BACKEND] Unloading last config entry - removing all services (including set_group_schedule)")
        # Unregister services
        for svc in [
            "set_schedule","get_schedule","clear_schedule","enable_schedule","disable_schedule",
            "sync_all","create_group","delete_group","add_to_group","remove_from_group",
            "get_groups","set_group_schedule","enable_group","disable_group","get_settings",
            "save_settings","reload_integration","advance_schedule","advance_group",
            "cancel_advance","get_advance_status","clear_advance_history","test_fire_event","create_profile",
            "delete_profile","rename_profile","set_active_profile","get_profiles",
            "cleanup_derivative_sensors","factory_reset"
        ]:
            try:
                hass.services.async_remove(DOMAIN, svc)
                if svc == "set_group_schedule":
                    _LOGGER.debug("[BACKEND] Removed service: set_group_schedule")
            except Exception:  # noqa: BLE001
                pass
        _LOGGER.info("[BACKEND] All services removed during unload")
        hass.data.pop(DOMAIN, None)
    else:
        _LOGGER.info("[BACKEND] Unloading entry but keeping services (not last entry)")
    
    return unload_ok

