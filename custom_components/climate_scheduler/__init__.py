"""The Climate Scheduler integration."""
import logging
import json
import time
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant import config_entries
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers.typing import ConfigType
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.util import json as json_util
from aiohttp import web
import voluptuous as vol
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, UPDATE_INTERVAL_SECONDS
from .coordinator import HeatingSchedulerCoordinator
from .storage import ScheduleStorage

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

RENAME_GROUP_SCHEMA = vol.Schema({
    vol.Required("old_name"): cv.string,
    vol.Required("new_name"): cv.string
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

SET_IGNORED_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id,
    vol.Required("ignored"): cv.boolean
})

ADVANCE_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id
})

ADVANCE_GROUP_SCHEMA = vol.Schema({
    vol.Required("group_name"): cv.string
})

CANCEL_ADVANCE_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id
})

CREATE_PROFILE_SCHEMA = vol.Schema({
    vol.Required("target_id"): cv.string,
    vol.Required("profile_name"): cv.string,
    vol.Optional("is_group", default=False): cv.boolean
})

DELETE_PROFILE_SCHEMA = vol.Schema({
    vol.Required("target_id"): cv.string,
    vol.Required("profile_name"): cv.string,
    vol.Optional("is_group", default=False): cv.boolean
})

RENAME_PROFILE_SCHEMA = vol.Schema({
    vol.Required("target_id"): cv.string,
    vol.Required("old_name"): cv.string,
    vol.Required("new_name"): cv.string,
    vol.Optional("is_group", default=False): cv.boolean
})

SET_ACTIVE_PROFILE_SCHEMA = vol.Schema({
    vol.Required("target_id"): cv.string,
    vol.Required("profile_name"): cv.string,
    vol.Optional("is_group", default=False): cv.boolean
})

GET_PROFILES_SCHEMA = vol.Schema({
    vol.Required("target_id"): cv.string,
    vol.Optional("is_group", default=False): cv.boolean
})

CLEANUP_DERIVATIVE_SENSORS_SCHEMA = vol.Schema({
    vol.Optional("confirm_delete_all", default=False): cv.boolean
})

FACTORY_RESET_SCHEMA = vol.Schema({
    vol.Required("confirm"): cv.boolean
})


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

    # Register services
    async def handle_set_schedule(call: ServiceCall) -> None:
        """Handle set_schedule service call."""
        entity_id = call.data["entity_id"]
        nodes = call.data["nodes"]
        day = call.data.get("day")  # Optional: mon, tue, wed, thu, fri, sat, sun, weekday, weekend, all_days
        schedule_mode = call.data.get("schedule_mode")  # Optional: all_days, 5/2, individual
        await storage.async_set_schedule(entity_id, nodes, day, schedule_mode)
        _LOGGER.info(f"Schedule set for {entity_id} (day: {day}, mode: {schedule_mode})")
        
        # Don't clear last_node_states or trigger refresh - let the coordinator 
        # apply changes only at the next scheduled node transition.
        # This prevents unnecessary commands to climate entities when editing schedules.
    
    async def handle_get_schedule(call: ServiceCall) -> dict:
        """Handle get_schedule service call."""
        entity_id = call.data["entity_id"]
        day = call.data.get("day")  # Optional: which day to get
        schedule = await storage.async_get_schedule(entity_id, day)
        # Return as service response data including enabled state
        if schedule:
            # Get nodes for compatibility: if 'nodes' key exists use it, otherwise get from schedules
            nodes = schedule.get("nodes", [])
            if not nodes and "schedules" in schedule:
                # New day-based format - get nodes from all_days as default
                schedules_dict = schedule.get("schedules", {})
                nodes = schedules_dict.get("all_days", [])
            
            _LOGGER.debug(f"get_schedule for {entity_id} (day: {day}): returning {len(nodes)} nodes, enabled={schedule.get('enabled', True)}, ignored={schedule.get('ignored', False)}")
            return {
                "nodes": nodes,
                "enabled": schedule.get("enabled", True),
                "ignored": schedule.get("ignored", False),
                "schedule_mode": schedule.get("schedule_mode", "all_days"),
                "schedules": schedule.get("schedules", {})
            }
        
        _LOGGER.debug(f"get_schedule for {entity_id} (day: {day}): entity not in storage, returning empty")
        return {"nodes": [], "enabled": False, "ignored": False, "schedule_mode": "all_days", "schedules": {}}
    
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
    
    async def handle_rename_group(call: ServiceCall) -> None:
        """Handle rename_group service call."""
        old_name = call.data["old_name"]
        new_name = call.data["new_name"]
        try:
            await storage.async_rename_group(old_name, new_name)
            _LOGGER.info(f"Renamed group from '{old_name}' to '{new_name}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to rename group: {e}")
            raise
    
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
            
            # Force immediate update for all entities in the group
            group_data = await storage.async_get_groups()
            if group_name in group_data and "entities" in group_data[group_name]:
                for entity_id in group_data[group_name]["entities"]:
                    if entity_id in coordinator.last_node_states:
                        del coordinator.last_node_states[entity_id]
                
                # Trigger immediate coordinator update
                await coordinator.async_request_refresh()
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
        # Add version from manifest
        try:
            manifest_path = Path(__file__).parent / "manifest.json"
            manifest = await hass.async_add_executor_job(
                json_util.load_json, str(manifest_path)
            )
            version = manifest.get("version", "unknown")
            
            # Check if this is a dev deployment
            dev_version_path = Path(__file__).parent / ".dev_version"
            if await hass.async_add_executor_job(dev_version_path.exists):
                version = f"{version} (dev)"
            
            settings["version"] = version
        except Exception as e:
            _LOGGER.warning(f"Failed to read version from manifest: {e}")
            settings["version"] = "unknown"
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
    
    async def handle_set_ignored(call: ServiceCall) -> None:
        """Handle set_ignored service call."""
        entity_id = call.data["entity_id"]
        ignored = call.data["ignored"]
        await storage.async_set_ignored(entity_id, ignored)
        _LOGGER.info(f"Set {entity_id} ignored={ignored}")
    
    async def handle_reload_integration(call: ServiceCall) -> None:
        """Handle reload_integration service call - reloads this integration."""
        _LOGGER.info("Reloading Climate Scheduler integration via service call")
        # Find this integration's config entry
        for entry in hass.config_entries.async_entries(DOMAIN):
            await hass.config_entries.async_reload(entry.entry_id)
            _LOGGER.info(f"Reloaded config entry: {entry.entry_id}")
    
    async def handle_advance_schedule(call: ServiceCall) -> None:
        """Handle advance_schedule service call - advance to next scheduled node."""
        entity_id = call.data["entity_id"]
        _LOGGER.info(f"Advancing schedule for {entity_id}")
        result = await coordinator.advance_to_next_node(entity_id)
        if result["success"]:
            _LOGGER.info(f"Successfully advanced {entity_id} to next node")
        else:
            _LOGGER.error(f"Failed to advance {entity_id}: {result.get('error')}")
            raise ValueError(result.get("error", "Unknown error"))
    
    async def handle_advance_group(call: ServiceCall) -> None:
        """Handle advance_group service call - advance all entities in group to next scheduled node."""
        group_name = call.data["group_name"]
        _LOGGER.info(f"Advancing group '{group_name}' to next scheduled node")
        result = await coordinator.advance_group_to_next_node(group_name)
        if result["success"]:
            _LOGGER.info(f"Successfully advanced {result['success_count']}/{result['total_entities']} entities in group '{group_name}'")
        else:
            _LOGGER.error(f"Failed to advance group '{group_name}': {result.get('error')}")
            raise ValueError(result.get("error", "Unknown error"))
    
    async def handle_cancel_advance(call: ServiceCall) -> None:
        """Handle cancel_advance service call - cancel active advance override."""
        entity_id = call.data["entity_id"]
        _LOGGER.info(f"Cancelling advance for {entity_id}")
        result = await coordinator.cancel_advance(entity_id)
        if not result["success"]:
            _LOGGER.error(f"Failed to cancel advance for {entity_id}: {result.get('error')}")
            raise ValueError(result.get("error", "Unknown error"))
    
    async def handle_get_advance_status(call: ServiceCall) -> dict:
        """Handle get_advance_status service call - get advance override status and history."""
        entity_id = call.data["entity_id"]
        is_active = entity_id in coordinator.override_until
        override_until = coordinator.override_until.get(entity_id)
        history = coordinator.get_advance_history(entity_id, hours=24)
        
        return {
            "is_active": is_active,
            "override_until": override_until.isoformat() if override_until else None,
            "history": history
        }
    
    async def handle_clear_advance_history(call: ServiceCall) -> None:
        """Handle clear_advance_history service call - clear advance history for an entity."""
        entity_id = call.data["entity_id"]
        _LOGGER.info(f"Clearing advance history for {entity_id}")
        await coordinator.clear_advance_history(entity_id)
    
    async def handle_create_profile(call: ServiceCall) -> None:
        """Handle create_profile service call - create a new schedule profile."""
        target_id = call.data["target_id"]
        profile_name = call.data["profile_name"]
        is_group = call.data.get("is_group", False)
        try:
            await storage.async_create_profile(target_id, profile_name, is_group)
            _LOGGER.info(f"Created profile '{profile_name}' for {'group' if is_group else 'entity'} '{target_id}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to create profile: {e}")
            raise
    
    async def handle_delete_profile(call: ServiceCall) -> None:
        """Handle delete_profile service call - delete a schedule profile."""
        target_id = call.data["target_id"]
        profile_name = call.data["profile_name"]
        is_group = call.data.get("is_group", False)
        try:
            await storage.async_delete_profile(target_id, profile_name, is_group)
            _LOGGER.info(f"Deleted profile '{profile_name}' from {'group' if is_group else 'entity'} '{target_id}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to delete profile: {e}")
            raise
    
    async def handle_rename_profile(call: ServiceCall) -> None:
        """Handle rename_profile service call - rename a schedule profile."""
        target_id = call.data["target_id"]
        old_name = call.data["old_name"]
        new_name = call.data["new_name"]
        is_group = call.data.get("is_group", False)
        try:
            await storage.async_rename_profile(target_id, old_name, new_name, is_group)
            _LOGGER.info(f"Renamed profile from '{old_name}' to '{new_name}' for {'group' if is_group else 'entity'} '{target_id}'")
        except ValueError as e:
            _LOGGER.error(f"Failed to rename profile: {e}")
            raise
    
    async def handle_set_active_profile(call: ServiceCall) -> None:
        """Handle set_active_profile service call - set the active schedule profile."""
        target_id = call.data["target_id"]
        profile_name = call.data["profile_name"]
        is_group = call.data.get("is_group", False)
        try:
            await storage.async_set_active_profile(target_id, profile_name, is_group)
            _LOGGER.info(f"Set active profile to '{profile_name}' for {'group' if is_group else 'entity'} '{target_id}'")
            
            # Clear last node state to force immediate update
            if not is_group:
                if target_id in coordinator.last_node_states:
                    del coordinator.last_node_states[target_id]
            else:
                # Clear for all entities in the group
                group_data = await storage.async_get_groups()
                if target_id in group_data and "entities" in group_data[target_id]:
                    for entity_id in group_data[target_id]["entities"]:
                        if entity_id in coordinator.last_node_states:
                            del coordinator.last_node_states[entity_id]
            
            # Trigger immediate coordinator update
            await coordinator.async_request_refresh()
        except ValueError as e:
            _LOGGER.error(f"Failed to set active profile: {e}")
            raise
    
    async def handle_get_profiles(call: ServiceCall) -> dict:
        """Handle get_profiles service call - get all profiles for an entity or group."""
        target_id = call.data["target_id"]
        is_group = call.data.get("is_group", False)
        profiles = await storage.async_get_profiles(target_id, is_group)
        active_profile = await storage.async_get_active_profile_name(target_id, is_group)
        return {
            "profiles": profiles,
            "active_profile": active_profile
        }
    
    async def handle_cleanup_derivative_sensors(call: ServiceCall) -> dict:
        """Handle cleanup_derivative_sensors service call."""
        confirm_delete_all = call.data.get("confirm_delete_all", False)
        result = await storage.async_cleanup_derivative_sensors(confirm_delete_all)
        return result
    
    async def handle_factory_reset(call: ServiceCall) -> None:
        """Handle factory_reset service call - reset all data to freshly installed state."""
        confirm = call.data.get("confirm", False)
        if not confirm:
            _LOGGER.error("Factory reset requires confirmation (set confirm=true)")
            raise ValueError("Factory reset requires confirmation. Set confirm=true to proceed.")
        
        _LOGGER.warning("Factory reset initiated - clearing all schedules, groups, and settings")
        await storage.async_factory_reset()
        
        # Clear coordinator state
        coordinator.last_node_states.clear()
        coordinator.override_until.clear()
        
        # Trigger refresh to ensure clean state
        await coordinator.async_request_refresh()
        
        _LOGGER.info("Factory reset completed successfully")
    
    hass.services.async_register(DOMAIN, "set_schedule", handle_set_schedule, schema=SET_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "get_schedule", handle_get_schedule, schema=ENTITY_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_schedule", handle_clear_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "enable_schedule", handle_enable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "disable_schedule", handle_disable_schedule, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "set_ignored", handle_set_ignored, schema=SET_IGNORED_SCHEMA)
    hass.services.async_register(DOMAIN, "sync_all", handle_sync_all)
    hass.services.async_register(DOMAIN, "create_group", handle_create_group, schema=CREATE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "delete_group", handle_delete_group, schema=DELETE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "rename_group", handle_rename_group, schema=RENAME_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "add_to_group", handle_add_to_group, schema=ADD_TO_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_from_group", handle_remove_from_group, schema=REMOVE_FROM_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "get_groups", handle_get_groups, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "set_group_schedule", handle_set_group_schedule, schema=SET_GROUP_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "enable_group", handle_enable_group, schema=ENABLE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "disable_group", handle_disable_group, schema=DISABLE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "get_settings", handle_get_settings, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "save_settings", handle_save_settings, schema=vol.Schema({vol.Required("settings"): cv.string}))
    hass.services.async_register(DOMAIN, "reload_integration", handle_reload_integration)
    hass.services.async_register(DOMAIN, "advance_schedule", handle_advance_schedule, schema=ADVANCE_SCHEDULE_SCHEMA)
    hass.services.async_register(DOMAIN, "advance_group", handle_advance_group, schema=ADVANCE_GROUP_SCHEMA)
    hass.services.async_register(DOMAIN, "cancel_advance", handle_cancel_advance, schema=CANCEL_ADVANCE_SCHEMA)
    hass.services.async_register(DOMAIN, "get_advance_status", handle_get_advance_status, schema=ENTITY_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_advance_history", handle_clear_advance_history, schema=ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "create_profile", handle_create_profile, schema=CREATE_PROFILE_SCHEMA)
    hass.services.async_register(DOMAIN, "delete_profile", handle_delete_profile, schema=DELETE_PROFILE_SCHEMA)
    hass.services.async_register(DOMAIN, "rename_profile", handle_rename_profile, schema=RENAME_PROFILE_SCHEMA)
    hass.services.async_register(DOMAIN, "set_active_profile", handle_set_active_profile, schema=SET_ACTIVE_PROFILE_SCHEMA)
    hass.services.async_register(DOMAIN, "get_profiles", handle_get_profiles, schema=GET_PROFILES_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "cleanup_derivative_sensors", handle_cleanup_derivative_sensors, schema=CLEANUP_DERIVATIVE_SENSORS_SCHEMA, supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "factory_reset", handle_factory_reset, schema=FACTORY_RESET_SCHEMA)

    hass.data[DOMAIN]["services_registered"] = True

    # Register frontend card resources
    await _register_frontend_resources(hass)


async def _register_frontend_resources(hass: HomeAssistant) -> None:
    """Register the bundled frontend card as a Lovelace resource."""
    # Only register once
    if hass.data[DOMAIN].get("frontend_registered"):
        return

    # Register static path for frontend files
    frontend_path = Path(__file__).parent / "frontend"
    if not frontend_path.exists():
        _LOGGER.warning("Frontend directory not found at %s", frontend_path)
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                f"/local/{DOMAIN}",
                str(frontend_path),
                True,  # cache_headers
            )
        ]
    )
    _LOGGER.info("Registered frontend static path: %s", frontend_path)

    # Register Lovelace resource
    try:
        # Get lovelace resources
        lovelace_data = hass.data.get("lovelace")
        if lovelace_data is None:
            _LOGGER.warning("Lovelace integration not available, card will need manual registration")
            hass.data[DOMAIN]["frontend_registered"] = True
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
            hass.data[DOMAIN]["frontend_registered"] = True
            return

        # Check for YAML mode
        if not hasattr(resources, "store") or resources.store is None:
            _LOGGER.info("Lovelace YAML mode detected, card must be registered manually")
            hass.data[DOMAIN]["frontend_registered"] = True
            return

        # Ensure resources are loaded
        if not resources.loaded:
            await resources.async_load()

        # Get version for cache busting
        version_file = frontend_path / ".version"
        if version_file.exists():
            frontend_version = version_file.read_text().strip()
        else:
            # Fallback to manifest version
            from .const import DOMAIN
            manifest_path = Path(__file__).parent / "manifest.json"
            if manifest_path.exists():
                import json
                manifest = json.loads(manifest_path.read_text())
                frontend_version = manifest.get("version", "unknown")
            else:
                frontend_version = "unknown"

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
            # Update if version changed
            if existing_entry["url"] != url:
                _LOGGER.info("Updating bundled frontend card to version %s", frontend_version)
                await resources.async_update_item(existing_entry["id"], {"url": url})
            else:
                _LOGGER.debug("Bundled frontend card already registered with current version")
            hass.data[DOMAIN]["frontend_registered"] = True
            return

        # Register the bundled card
        await resources.async_create_item({"res_type": "module", "url": url})
        if removed_old:
            _LOGGER.info("Successfully migrated to bundled frontend card (version %s)", frontend_version)
        else:
            _LOGGER.info("Successfully registered bundled frontend card (version %s)", frontend_version)

    except Exception as err:
        _LOGGER.error("Failed to auto-register frontend card: %s", err)
    
    hass.data[DOMAIN]["frontend_registered"] = True


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

