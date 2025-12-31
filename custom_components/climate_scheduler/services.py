"""Service definitions and handlers for Climate Scheduler."""
import logging
from typing import Any
import json
from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers import selector
from homeassistant.util import json as json_util
import voluptuous as vol
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN
from .coordinator import HeatingSchedulerCoordinator
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)


async def async_get_services(hass: HomeAssistant) -> dict[str, Any]:
    """Return dynamic service definitions with runtime-populated selectors."""
    # Get current groups and profiles from storage
    storage: ScheduleStorage = hass.data[DOMAIN]["storage"]
    all_groups = await storage.async_get_groups()
    
    # Get group names (excluding internal single-entity groups)
    group_names = [name for name in all_groups.keys() if not name.startswith("__entity_")]
    
    # Get all profiles with formatted labels
    profile_options = []
    for group_name, group_data in all_groups.items():
        profiles = group_data.get("profiles", {})
        for profile_name in profiles.keys():
            # Format: value is just the profile name, label shows "GroupName: ProfileName"
            if group_name.startswith("__entity_"):
                entity_id = group_name.replace("__entity_", "")
                display_name = entity_id
            else:
                display_name = group_name
            
            profile_options.append({
                "value": profile_name,
                "label": f"{display_name}: {profile_name}"
            })
    
    return {
        "recreate_all_sensors": {
            "name": "Recreate all sensors",
            "description": "Delete ALL Climate Scheduler sensor entities and reload the integration to recreate them cleanly. Requires confirmation.",
            "fields": {
                "confirm": {
                    "description": "Must be set to true to confirm deletion of all sensors",
                    "required": True,
                    "default": False,
                    "example": True,
                    "selector": {"boolean": {}},
                }
            },
        },
        "cleanup_malformed_sensors": {
            "name": "Cleanup malformed sensors",
            "description": "Scan for unexpected Climate Scheduler sensor entities and optionally remove them. Returns expected and unexpected entity lists.",
            "fields": {
                "delete": {
                    "description": "Whether to actually delete the unexpected entities (default is false for dry-run)",
                    "required": False,
                    "default": False,
                    "example": True,
                    "selector": {"boolean": {}},
                }
            },
        },
        "set_schedule": {
            "name": "Set climate schedule",
            "description": "Configure temperature schedule for a climate entity",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to control",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                },
                "nodes": {
                    "description": "List of schedule nodes with time and temperature",
                    "required": True,
                    "example": '[{"time": "07:00", "temp": 21}, {"time": "23:00", "temp": 18}]',
                },
                "day": {
                    "description": "Day of week for this schedule (all_days, mon, tue, wed, thu, fri, sat, sun, weekday, weekend)",
                    "required": False,
                    "default": "all_days",
                    "example": "mon",
                    "selector": {"text": {}},
                },
                "schedule_mode": {
                    "description": "Schedule mode (all_days, 5/2, individual)",
                    "required": False,
                    "default": "all_days",
                    "example": "individual",
                    "selector": {"text": {}},
                },
            },
        },
        
        "get_schedule": {
            "name": "Get climate schedule",
            "description": "Retrieve the current schedule for a climate entity",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to get schedule for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "clear_schedule": {
            "name": "Clear climate schedule",
            "description": "Remove the schedule for a climate entity",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to clear schedule for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "enable_schedule": {
            "name": "Enable climate schedule",
            "description": "Enable automatic scheduling for a climate entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID (e.g. climate.living_room) or group name to enable",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                }
            },
        },
        
        "disable_schedule": {
            "name": "Disable climate schedule",
            "description": "Disable automatic scheduling for a climate entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID (e.g. climate.living_room) or group name to disable",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                }
            },
        },
        
        "create_group": {
            "name": "Create thermostat group",
            "description": "Create a new group to share schedules between multiple thermostats",
            "fields": {
                "group_name": {
                    "description": "Name for the new group",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"text": {}},
                }
            },
        },
        
        "delete_group": {
            "name": "Delete thermostat group",
            "description": "Delete a thermostat group",
            "fields": {
                "group_name": {
                    "description": "Name of the group to delete",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                }
            },
        },
        
        "rename_group": {
            "name": "Rename thermostat group",
            "description": "Rename a thermostat group",
            "fields": {
                "old_name": {
                    "description": "Current name of the group",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                },
                "new_name": {
                    "description": "New name for the group",
                    "required": True,
                    "example": "Upstairs Bedrooms",
                    "selector": {"text": {}},
                },
            },
        },
        
        "add_to_group": {
            "name": "Add thermostat to group",
            "description": "Add a climate entity to a group",
            "fields": {
                "group_name": {
                    "description": "Name of the group",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                },
                "entity_id": {
                    "description": "Climate entity to add to the group",
                    "required": True,
                    "example": "climate.bedroom_1",
                    "selector": {"entity": {"domain": "climate"}},
                },
            },
        },
        
        "remove_from_group": {
            "name": "Remove thermostat from group",
            "description": "Remove a climate entity from a group",
            "fields": {
                "group_name": {
                    "description": "Name of the group",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                },
                "entity_id": {
                    "description": "Climate entity to remove from the group",
                    "required": True,
                    "example": "climate.bedroom_1",
                    "selector": {"entity": {"domain": "climate"}},
                },
            },
        },
        
        "get_groups": {
            "name": "Get all groups",
            "description": "Retrieve all thermostat groups",
        },
        
        "list_groups": {
            "name": "List all group names",
            "description": "Get a simple list of all thermostat group names for populating selectors",
        },
        
        "set_group_schedule": {
            "name": "Set group schedule",
            "description": "Set schedule for all thermostats in a group",
            "fields": {
                "group_name": {
                    "description": "Name of the group",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                },
                "nodes": {
                    "description": "List of schedule nodes with time and temperature",
                    "required": True,
                    "example": '[{"time": "07:00", "temp": 21}, {"time": "23:00", "temp": 18}]',
                },
                "day": {
                    "description": "Day of week for this schedule (all_days, mon, tue, wed, thu, fri, sat, sun, weekday, weekend)",
                    "required": False,
                    "default": "all_days",
                    "example": "mon",
                    "selector": {"text": {}},
                },
                "schedule_mode": {
                    "description": "Schedule mode (all_days, 5/2, individual)",
                    "required": False,
                    "default": "all_days",
                    "example": "individual",
                    "selector": {"text": {}},
                },
            },
        },
        
        "sync_all": {
            "name": "Sync all thermostats",
            "description": "Force synchronization of all enabled thermostats with their schedules",
        },
        
        "enable_group": {
            "name": "Enable group schedule",
            "description": "Enable automatic scheduling for all thermostats in a group",
            "fields": {
                "group_name": {
                    "description": "Name of the group to enable",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                }
            },
        },
        
        "disable_group": {
            "name": "Disable group schedule",
            "description": "Disable automatic scheduling for all thermostats in a group",
            "fields": {
                "group_name": {
                    "description": "Name of the group to disable",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                }
            },
        },
        
        "get_settings": {
            "name": "Get settings",
            "description": "Retrieve global integration settings (min/max temp, default schedule, etc.)",
        },
        
        "save_settings": {
            "name": "Save settings",
            "description": "Save global integration settings",
            "fields": {
                "settings": {
                    "description": "Settings object with min_temp, max_temp, defaultSchedule, tooltipMode, etc.",
                    "required": True,
                    "example": '{"min_temp": 10, "max_temp": 30}',
                }
            },
        },
        
        "set_ignored": {
            "name": "Set entity ignored status",
            "description": "Mark an entity as ignored (not monitored) or un-ignore it",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to set ignored status for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                },
                "ignored": {
                    "description": "Whether to ignore this entity (true) or monitor it (false)",
                    "required": True,
                    "example": True,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "reload_integration": {
            "name": "Reload integration (Dev)",
            "description": "Reload the Climate Scheduler integration (development only)",
        },
        
        "advance_schedule": {
            "name": "Advance to next scheduled node",
            "description": "Manually advance a climate entity to its next scheduled temperature and settings, even if the scheduled time hasn't arrived yet",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to advance to next scheduled node",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "advance_group": {
            "name": "Advance group to next scheduled node",
            "description": "Manually advance all climate entities in a group to their next scheduled temperature and settings, even if the scheduled time hasn't arrived yet",
            "fields": {
                "group_name": {
                    "description": "Name of the group to advance",
                    "required": True,
                    "example": "Bedrooms",
                    "selector": {"select": {"options": group_names}},
                }
            },
        },
        
        "cancel_advance": {
            "name": "Cancel advance override",
            "description": "Cancel an active advance override and return the climate entity to its current scheduled settings",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to cancel advance for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "clear_advance_history": {
            "name": "Clear advance history",
            "description": "Clear all advance history markers for a climate entity",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to clear history for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "get_advance_status": {
            "name": "Get advance status",
            "description": "Check if a climate entity has an active advance override",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity to check",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"entity": {"domain": "climate"}},
                }
            },
        },
        
        "create_profile": {
            "name": "Create schedule profile",
            "description": "Create a new schedule profile for an entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID or group name to create profile for",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                },
                "profile_name": {
                    "description": "Name for the new profile",
                    "required": True,
                    "example": "Winter Schedule",
                    "selector": {"text": {}},
                },
                "is_group": {
                    "description": "Whether this is a group (true) or entity (false)",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "delete_profile": {
            "name": "Delete schedule profile",
            "description": "Delete a schedule profile from an entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID or group name to delete profile from",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                },
                "profile_name": {
                    "description": "Name of the profile to delete",
                    "required": True,
                    "example": "Winter Schedule",
                    "selector": {"select": {"options": profile_options}},
                },
                "is_group": {
                    "description": "Whether this is a group (true) or entity (false)",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "rename_profile": {
            "name": "Rename schedule profile",
            "description": "Rename a schedule profile for an entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID or group name",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                },
                "old_name": {
                    "description": "Current name of the profile",
                    "required": True,
                    "example": "Winter Schedule",
                    "selector": {"select": {"options": profile_options}},
                },
                "new_name": {
                    "description": "New name for the profile",
                    "required": True,
                    "example": "Cold Weather Schedule",
                    "selector": {"text": {}},
                },
                "is_group": {
                    "description": "Whether this is a group (true) or entity (false)",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "set_active_profile": {
            "name": "Set active schedule profile",
            "description": "Switch to a different schedule profile for an entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID or group name",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                },
                "profile_name": {
                    "description": "Name of the profile to activate",
                    "required": True,
                    "example": "Winter Schedule",
                    "selector": {"select": {"options": profile_options}},
                },
                "is_group": {
                    "description": "Whether this is a group (true) or entity (false)",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "get_profiles": {
            "name": "Get schedule profiles",
            "description": "Get list of all available profiles for an entity or group",
            "fields": {
                "schedule_id": {
                    "description": "Climate entity ID or group name",
                    "required": True,
                    "example": "climate.living_room",
                    "selector": {"text": {}},
                },
                "is_group": {
                    "description": "Whether this is a group (true) or entity (false)",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                },
            },
        },
        
        "list_profiles": {
            "name": "List all profile names",
            "description": "Get a list of all profiles across all entities and groups with group prefix for populating selectors",
        },
        
        "cleanup_derivative_sensors": {
            "name": "Cleanup derivative sensors",
            "description": "Remove orphaned derivative sensors for entities that no longer exist",
            "fields": {
                "confirm_delete_all": {
                    "description": "Confirm deletion of all derivative sensors",
                    "required": False,
                    "default": False,
                    "example": False,
                    "selector": {"boolean": {}},
                }
            },
        },
        
        "factory_reset": {
            "name": "Factory Reset",
            "description": "Reset all Climate Scheduler data to freshly installed state. WARNING - This will delete all schedules, groups, profiles, and settings permanently.",
            "fields": {
                "confirm": {
                    "description": "Must be set to true to confirm the factory reset",
                    "required": True,
                    "example": True,
                    "selector": {"boolean": {}},
                }
            },
        },
    }



async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up all services for the Climate Scheduler integration."""

    # Define voluptuous schemas for services (used for validation)
    service_schemas: dict[str, vol.Schema] = {
        "recreate_all_sensors": vol.Schema({vol.Required("confirm"): cv.boolean}),
        "cleanup_malformed_sensors": vol.Schema({vol.Optional("delete", default=False): cv.boolean}),
        "set_schedule": vol.Schema({
            vol.Required("schedule_id"): cv.string,
            # Accept either a JSON string (legacy) or a structured list/object from the UI
            vol.Required("nodes"): vol.Any(cv.string, list, dict),
            vol.Optional("day", default="all_days"): cv.string,
            vol.Optional("schedule_mode", default="all_days"): cv.string,
        }),
        "get_schedule": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "clear_schedule": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "enable_schedule": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "disable_schedule": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "set_ignored": vol.Schema({vol.Required("schedule_id"): cv.string, vol.Required("ignored"): cv.boolean}),
        "sync_all": vol.Schema({}),
        "create_group": vol.Schema({vol.Required("group_name"): cv.string}),
        "delete_group": vol.Schema({vol.Required("group_name"): cv.string}),
        "rename_group": vol.Schema({vol.Required("old_name"): cv.string, vol.Required("new_name"): cv.string}),
        "add_to_group": vol.Schema({vol.Required("group_name"): cv.string, vol.Required("entity_id"): cv.string}),
        "remove_from_group": vol.Schema({vol.Required("group_name"): cv.string, vol.Required("entity_id"): cv.string}),
        "get_groups": vol.Schema({}),
        "list_groups": vol.Schema({}),
        "list_profiles": vol.Schema({}),
        "set_group_schedule": vol.Schema({
            vol.Required("group_name"): cv.string,
            vol.Required("nodes"): vol.Any(cv.string, list, dict),
            vol.Optional("day"): cv.string,
            vol.Optional("schedule_mode"): cv.string
        }),
        "enable_group": vol.Schema({vol.Required("group_name"): cv.string}),
        "disable_group": vol.Schema({vol.Required("group_name"): cv.string}),
        "get_settings": vol.Schema({}),
        "save_settings": vol.Schema({vol.Required("settings"): cv.string}),
        "reload_integration": vol.Schema({}),
        "advance_schedule": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "advance_group": vol.Schema({vol.Required("group_name"): cv.string}),
        "cancel_advance": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "get_advance_status": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "clear_advance_history": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "create_profile": vol.Schema({vol.Required("schedule_id"): cv.string, vol.Required("profile_name"): cv.string}),
        "delete_profile": vol.Schema({vol.Required("schedule_id"): cv.string, vol.Required("profile_name"): cv.string}),
        "rename_profile": vol.Schema({vol.Required("schedule_id"): cv.string, vol.Required("old_name"): cv.string, vol.Required("new_name"): cv.string}),
        "set_active_profile": vol.Schema({vol.Required("schedule_id"): cv.string, vol.Required("profile_name"): cv.string}),
        "get_profiles": vol.Schema({vol.Required("schedule_id"): cv.string}),
        "cleanup_derivative_sensors": vol.Schema({vol.Optional("confirm_delete_all", default=False): cv.boolean}),
        "factory_reset": vol.Schema({vol.Required("confirm"): cv.boolean}),
        "reregister_card": vol.Schema({
            vol.Required("resource_url"): cv.string,
            vol.Optional("resource_type", default="module"): cv.string,
        }),
    }

    async def handle_recreate_all_sensors(call: ServiceCall) -> dict:
        """Handle recreate_all_sensors service call."""
        confirm = call.data.get("confirm", False)
        if not confirm:
            raise ValueError("You must confirm deletion by setting 'confirm' to true.")

        # Find and delete all sensor entities created by this integration
        deleted_count = 0
        errors = []
        domain = "sensor"
        from homeassistant.helpers import entity_registry as er
        entity_reg = er.async_get(hass)
        sensor_entities = [e for e in entity_reg.entities.values() if e.domain == domain and e.platform == DOMAIN]
        for entity in sensor_entities:
            try:
                entity_reg.async_remove(entity.entity_id)
                deleted_count += 1
            except Exception as e:
                errors.append(f"{entity.entity_id}: {e}")

        # Reload the integration
        for entry in hass.config_entries.async_entries(DOMAIN):
            await hass.config_entries.async_reload(entry.entry_id)

        message = f"Deleted {deleted_count} sensor entities. Integration reloaded."
        if errors:
            message += f" Errors: {len(errors)}."

        return {"deleted_count": deleted_count, "errors": errors, "message": message}

    async def handle_cleanup_malformed_sensors(call: ServiceCall) -> dict:
        """Handle cleanup_malformed_sensors service call - identify and optionally remove malformed/unexpected sensors."""
        delete = call.data.get("delete", False)
        _LOGGER.info(f"Scanning for malformed Climate Scheduler sensors (delete={delete})")

        # Get registries
        from homeassistant.helpers import entity_registry as er, device_registry as dr
        entity_reg = er.async_get(hass)
        device_reg = dr.async_get(hass)

        # Get all sensor entities created by this integration
        sensor_entities = [e for e in entity_reg.entities.values() if e.domain == "sensor" and e.platform == DOMAIN]

        # Build expected IDs
        expected_entity_ids = set()
        expected_entity_ids.add("sensor.climate_scheduler_coldest_entity")
        expected_entity_ids.add("sensor.climate_scheduler_warmest_entity")

        # Collect climate entities from storage groups
        storage: ScheduleStorage = hass.data[DOMAIN]["storage"]
        groups = await storage.async_get_groups()
        all_climate_entities = set()
        for group_name, group_data in groups.items():
            entities_list = group_data.get("entities", [])
            all_climate_entities.update(entities_list)

        # Use settings to decide whether derivative sensors are expected
        settings = storage._data.get("settings", {})
        create_derivative = settings.get("create_derivative_sensors", True)

        if create_derivative:
            for climate_entity_id in all_climate_entities:
                if "." in climate_entity_id:
                    entity_name = climate_entity_id.split(".", 1)[1]
                    expected_entity_ids.add(f"sensor.climate_scheduler_{entity_name}_rate")

                    climate_entry = entity_reg.async_get(climate_entity_id)
                    if climate_entry and climate_entry.device_id:
                        device_id = climate_entry.device_id
                        device_sensors = [
                            e for e in entity_reg.entities.values()
                            if e.device_id == device_id and e.domain == "sensor" and e.entity_id != climate_entity_id
                        ]

                        for sensor in device_sensors:
                            sensor_state = hass.states.get(sensor.entity_id)
                            if not sensor_state:
                                continue
                            attrs = sensor_state.attributes
                            if ("temperature" in str(sensor_state.state).lower() or
                                attrs.get("device_class") == "temperature" or
                                attrs.get("unit_of_measurement") in ["°C", "°F"]):
                                floor_sensor_name = sensor.entity_id.split(".", 1)[1]
                                # Prevent duplicated segments like "front_room_front_room_..."
                                if floor_sensor_name.startswith(f"{entity_name}_"):
                                    floor_sensor_suffix = floor_sensor_name[len(entity_name) + 1 :]
                                else:
                                    floor_sensor_suffix = floor_sensor_name

                                expected_entity_ids.add(
                                    f"sensor.climate_scheduler_{entity_name}_{floor_sensor_suffix}_rate"
                                )

        # Find unexpected entities
        problematic = []
        for entry in sensor_entities:
            if entry.entity_id not in expected_entity_ids and entry.entity_id.startswith("sensor.climate_scheduler_"):
                problematic.append({
                    "entity_id": entry.entity_id,
                    "unique_id": entry.unique_id,
                    "name": entry.name or entry.original_name,
                    "reason": "Not in expected entity list"
                })

        if not problematic:
            _LOGGER.info("No problematic sensor entities found")
            return {
                "expected_entities": sorted(list(expected_entity_ids)),
                "unexpected_entities": []
            }

        _LOGGER.warning(f"Found {len(problematic)} unexpected sensor entities")

        if delete:
            removed = []
            for info in problematic:
                try:
                    entity_reg.async_remove(info["entity_id"])
                    removed.append(info["entity_id"])
                    _LOGGER.info(f"Removed unexpected entity: {info['entity_id']}")
                except Exception as e:
                    _LOGGER.error(f"Failed to remove entity {info['entity_id']}: {e}")

            return {
                "expected_entities": sorted(list(expected_entity_ids)),
                "unexpected_entities": [p["entity_id"] for p in problematic],
                "removed": removed
            }

        # Dry run
        return {
            "expected_entities": sorted(list(expected_entity_ids)),
            "unexpected_entities": [p["entity_id"] for p in problematic]
        }

    storage: ScheduleStorage = hass.data[DOMAIN]["storage"]
    coordinator: HeatingSchedulerCoordinator = hass.data[DOMAIN]["coordinator"]

    # Get dynamic data for selectors
    all_groups = await storage.async_get_groups()
    group_names = [name for name in all_groups.keys() if not name.startswith("__entity_")]

    # Build profile options with labels
    profile_options = []
    for group_name, group_data in all_groups.items():
        profiles = group_data.get("profiles", {})
        for profile_name in profiles.keys():
            if group_name.startswith("__entity_"):
                entity_id = group_name.replace("__entity_", "")
                display_name = entity_id
            else:
                display_name = group_name

            profile_options.append({
                "value": profile_name,
                "label": f"{display_name}: {profile_name}"
            })
    
    # Build dynamic selectors
    group_selector = selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=group_names,
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    ) if group_names else cv.string
    
    profile_selector = selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=profile_options,
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    ) if profile_options else cv.string
    
    entity_selector = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="climate")
    )
    
    # Service handler functions (schemas are defined in async_get_services() return value above)
    async def handle_set_schedule(call: ServiceCall) -> None:
        """Handle set_schedule service call."""
        entity_id = call.data["schedule_id"]
        nodes = call.data["nodes"]
        day = call.data.get("day")
        schedule_mode = call.data.get("schedule_mode")
        await storage.async_set_schedule(entity_id, nodes, day, schedule_mode)
        
        # Force immediate update
        if entity_id in coordinator.last_node_states:
            del coordinator.last_node_states[entity_id]
        
        await coordinator.async_request_refresh()
    
    async def handle_get_schedule(call: ServiceCall) -> dict:
        """Handle get_schedule service call."""
        entity_id = call.data["schedule_id"]
        schedule = await storage.async_get_schedule(entity_id)
        
        if schedule is None:
            return {"schedule": None, "enabled": False}
        
        schedules = schedule.get("schedules", {})
        schedule_mode = schedule.get("schedule_mode", "all_days")
        enabled = schedule.get("enabled", True)
        profiles = schedule.get("profiles", {})
        active_profile = schedule.get("active_profile", "Default")
        
        return {
            "schedules": schedules,
            "schedule_mode": schedule_mode,
            "enabled": enabled,
            "profiles": profiles,
            "active_profile": active_profile
        }
    
    async def handle_clear_schedule(call: ServiceCall) -> None:
        """Handle clear_schedule service call."""
        entity_id = call.data["schedule_id"]
        await storage.async_clear_schedule(entity_id)
        await coordinator.async_request_refresh()
    
    async def _enable_target(target_id: str) -> None:
        """Enable scheduling for either a single entity or a group name.

        If `target_id` is a group name, enable scheduling for all entities
        in that group by invoking storage.async_set_enabled for each entity.
        Otherwise treat `target_id` as an entity id and enable its group.
        """
        # Check if target is a group name
        group = await storage.async_get_group(target_id)
        if group is not None:
            # It's a group name - enable all member entities via storage
            entities = group.get("entities", [])
            for entity_id in entities:
                await storage.async_set_enabled(entity_id, True)
                if entity_id in coordinator.last_node_states:
                    del coordinator.last_node_states[entity_id]
            # Force a single refresh after enabling group members
            await coordinator.async_request_refresh()
            _LOGGER.info(f"Enabled schedule for group '{target_id}' (via member enable)")
            return

        # Not a group - treat as entity id
        await storage.async_set_enabled(target_id, True)
        if target_id in coordinator.last_node_states:
            del coordinator.last_node_states[target_id]
        await coordinator.async_request_refresh()
        _LOGGER.info(f"Enabled schedule for {target_id}")

    async def _disable_target(target_id: str) -> None:
        """Disable scheduling for either a single entity or a group name.

        If `target_id` is a group name, disable scheduling for all entities
        in that group by invoking storage.async_set_enabled for each entity.
        Otherwise treat `target_id` as an entity id and disable its group.
        """
        group = await storage.async_get_group(target_id)
        if group is not None:
            entities = group.get("entities", [])
            for entity_id in entities:
                await storage.async_set_enabled(entity_id, False)
            _LOGGER.info(f"Disabled schedule for group '{target_id}' (via member disable)")
            return

        # Not a group - treat as entity id
        await storage.async_set_enabled(target_id, False)
        _LOGGER.info(f"Disabled schedule for {target_id}")

    async def handle_enable_schedule(call: ServiceCall) -> None:
        """Handle enable_schedule service call (supports entity or group)."""
        target = call.data["schedule_id"]
        await _enable_target(target)

    async def handle_disable_schedule(call: ServiceCall) -> None:
        """Handle disable_schedule service call (supports entity or group)."""
        target = call.data["schedule_id"]
        await _disable_target(target)
    
    async def handle_sync_all(call: ServiceCall) -> None:
        """Handle sync_all service call."""
        coordinator.last_node_states.clear()
        await coordinator.async_request_refresh()
        _LOGGER.info("Forced sync of all thermostats")
    
    async def handle_create_group(call: ServiceCall) -> None:
        """Handle create_group service call."""
        group_name = call.data["group_name"]
        try:
            await storage.async_create_group(group_name)
            _LOGGER.info(f"Created group '{group_name}'")
        except ValueError as err:
            _LOGGER.error(f"Error creating group: {err}")
            raise
    
    async def handle_delete_group(call: ServiceCall) -> None:
        """Handle delete_group service call."""
        group_name = call.data["group_name"]
        try:
            await storage.async_delete_group(group_name)
            _LOGGER.info(f"Deleted group '{group_name}'")
        except ValueError as err:
            _LOGGER.error(f"Error deleting group: {err}")
            raise
    
    async def handle_rename_group(call: ServiceCall) -> None:
        """Handle rename_group service call."""
        old_name = call.data["old_name"]
        new_name = call.data["new_name"]
        try:
            await storage.async_rename_group(old_name, new_name)
            _LOGGER.info(f"Renamed group '{old_name}' to '{new_name}'")
        except ValueError as err:
            _LOGGER.error(f"Error renaming group: {err}")
            raise
    
    async def handle_add_to_group(call: ServiceCall) -> None:
        """Handle add_to_group service call."""
        group_name = call.data["group_name"]
        entity_id = call.data["entity_id"]
        try:
            await storage.async_add_entity_to_group(group_name, entity_id)
            _LOGGER.info(f"Added {entity_id} to group '{group_name}'")
        except ValueError as err:
            _LOGGER.error(f"Error adding to group: {err}")
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
    
    async def handle_list_groups(call: ServiceCall) -> dict:
        """Handle list_groups service call - return simple list of group names."""
        groups = await storage.async_get_groups()
        group_names = [name for name in groups.keys() if not name.startswith("__entity_")]
        return {"groups": group_names}
    
    async def handle_list_profiles(call: ServiceCall) -> dict:
        """Handle list_profiles service call - return list of all profiles with value/label format."""
        groups = await storage.async_get_groups()
        profiles_list = []
        
        for group_name, group_data in groups.items():
            profiles = group_data.get("profiles", {})
            for profile_name in profiles.keys():
                if group_name.startswith("__entity_"):
                    entity_id = group_name.replace("__entity_", "")
                    display_name = entity_id
                else:
                    display_name = group_name
                
                profiles_list.append({
                    "value": profile_name,
                    "label": f"{display_name}: {profile_name}"
                })
        
        return {"profiles": profiles_list}
    
    async def handle_set_group_schedule(call: ServiceCall) -> None:
        """Handle set_group_schedule service call."""
        group_name = call.data["group_name"]
        nodes = call.data["nodes"]
        day = call.data.get("day")
        schedule_mode = call.data.get("schedule_mode")
        try:
            await storage.async_set_group_schedule(group_name, nodes, day, schedule_mode)
            
            # Force immediate update for all entities in the group
            group_data = await storage.async_get_groups()
            if group_name in group_data and "entities" in group_data[group_name]:
                for entity_id in group_data[group_name]["entities"]:
                    if entity_id in coordinator.last_node_states:
                        del coordinator.last_node_states[entity_id]
                
                await coordinator.async_request_refresh()
        except ValueError as err:
            _LOGGER.error(f"Error setting group schedule: {err}")
            raise
    
    async def handle_enable_group(call: ServiceCall) -> None:
        """Handle enable_group service call."""
        group_name = call.data["group_name"]
        try:
            # Delegate to single-entity enable logic so group behaviour
            # is consistent and backwards-compatible.
            await _enable_target(group_name)
        except ValueError as err:
            _LOGGER.error(f"Error enabling group: {err}")
            raise
    
    async def handle_disable_group(call: ServiceCall) -> None:
        """Handle disable_group service call."""
        group_name = call.data["group_name"]
        try:
            # Delegate to single-entity disable logic so group behaviour
            # reuses the same implementation.
            await _disable_target(group_name)
        except ValueError as err:
            _LOGGER.error(f"Error disabling group: {err}")
            raise
    
    async def handle_get_settings(call: ServiceCall) -> dict:
        """Handle get_settings service call."""
        settings = await storage.async_get_settings()
        
        # Include version information
        from homeassistant.const import __version__ as ha_version
        
        # Get integration version from manifest
        integration_version = "unknown"
        try:
            from homeassistant.loader import async_get_integration
            integration = await async_get_integration(hass, DOMAIN)
            integration_version = integration.version
        except Exception:
            pass
        
        return {
            "settings": settings,
            "version": {
                "integration": integration_version,
                "home_assistant": ha_version
            }
        }
    
    async def handle_save_settings(call: ServiceCall) -> None:
        """Handle save_settings service call."""
        settings_json = call.data["settings"]
        import json
        settings = json.loads(settings_json)
        await storage.async_save_settings(settings)
        _LOGGER.info("Settings saved")
    
    async def handle_set_ignored(call: ServiceCall) -> None:
        """Handle set_ignored service call."""
        entity_id = call.data["schedule_id"]
        ignored = call.data["ignored"]
        await storage.async_set_ignored(entity_id, ignored)
        _LOGGER.info(f"Set {entity_id} ignored status to {ignored}")
    
    async def handle_reload_integration(call: ServiceCall) -> None:
        """Handle reload_integration service call."""
        _LOGGER.info("Reloading Climate Scheduler integration")
        
        # Trigger a config entry reload
        for entry in hass.config_entries.async_entries(DOMAIN):
            await hass.config_entries.async_reload(entry.entry_id)
    
    async def handle_advance_schedule(call: ServiceCall) -> None:
        """Handle advance_schedule service call."""
        entity_id = call.data["schedule_id"]
        await coordinator.async_advance_schedule(entity_id)
        _LOGGER.info(f"Advanced schedule for {entity_id}")
    
    async def handle_advance_group(call: ServiceCall) -> None:
        """Handle advance_group service call."""
        group_name = call.data["group_name"]
        await coordinator.async_advance_group(group_name)
        _LOGGER.info(f"Advanced schedule for group '{group_name}'")
    
    async def handle_cancel_advance(call: ServiceCall) -> None:
        """Handle cancel_advance service call."""
        entity_id = call.data["schedule_id"]
        await coordinator.async_cancel_advance(entity_id)
        
        # Force immediate update
        if entity_id in coordinator.last_node_states:
            del coordinator.last_node_states[entity_id]
        
        await coordinator.async_request_refresh()
        _LOGGER.info(f"Cancelled advance for {entity_id}")
    
    async def handle_get_advance_status(call: ServiceCall) -> dict:
        """Handle get_advance_status service call."""
        entity_id = call.data["schedule_id"]
        status = await coordinator.async_get_advance_status(entity_id)
        
        return {
            "entity_id": entity_id,
            "is_advanced": status.get("is_advanced", False),
            "advance_time": status.get("advance_time"),
            "original_node": status.get("original_node"),
            "advanced_node": status.get("advanced_node")
        }
    
    async def handle_clear_advance_history(call: ServiceCall) -> None:
        """Handle clear_advance_history service call."""
        entity_id = call.data["schedule_id"]
        await storage.async_clear_advance_history(entity_id)
        _LOGGER.info(f"Cleared advance history for {entity_id}")
    
    async def handle_create_profile(call: ServiceCall) -> None:
        """Handle create_profile service call."""
        target_id = call.data["schedule_id"]
        profile_name = call.data["profile_name"]
        
        try:
            await storage.async_create_profile(target_id, profile_name)
            _LOGGER.info(f"Created profile '{profile_name}' for schedule '{target_id}'")
        except ValueError as err:
            _LOGGER.error(f"Error creating profile: {err}")
            raise
    
    async def handle_delete_profile(call: ServiceCall) -> None:
        """Handle delete_profile service call."""
        target_id = call.data["schedule_id"]
        profile_name = call.data["profile_name"]
        
        try:
            await storage.async_delete_profile(target_id, profile_name)
            _LOGGER.info(f"Deleted profile '{profile_name}' from schedule '{target_id}'")
        except ValueError as err:
            _LOGGER.error(f"Error deleting profile: {err}")
            raise
    
    async def handle_rename_profile(call: ServiceCall) -> None:
        """Handle rename_profile service call."""
        target_id = call.data["schedule_id"]
        old_name = call.data["old_name"]
        new_name = call.data["new_name"]
        
        try:
            await storage.async_rename_profile(target_id, old_name, new_name)
            _LOGGER.info(f"Renamed profile '{old_name}' to '{new_name}' for schedule '{target_id}'")
        except ValueError as err:
            _LOGGER.error(f"Error renaming profile: {err}")
            raise
    
    async def handle_set_active_profile(call: ServiceCall) -> None:
        """Handle set_active_profile service call."""
        target_id = call.data["schedule_id"]
        profile_name = call.data["profile_name"]
        
        try:
            await storage.async_set_active_profile(target_id, profile_name)
            _LOGGER.info(f"Set active profile to '{profile_name}' for schedule '{target_id}'")
            
            # Force immediate update - clear state for all entities in the group
            group_data = await storage.async_get_groups()
            if target_id in group_data and "entities" in group_data[target_id]:
                for entity_id in group_data[target_id]["entities"]:
                    if entity_id in coordinator.last_node_states:
                        del coordinator.last_node_states[entity_id]
            
            await coordinator.async_request_refresh()
        except ValueError as err:
            _LOGGER.error(f"Error setting active profile: {err}")
            raise
    
    async def handle_get_profiles(call: ServiceCall) -> dict:
        """Handle get_profiles service call."""
        target_id = call.data["schedule_id"]
        profiles = await storage.async_get_profiles(target_id)
        active_profile = await storage.async_get_active_profile_name(target_id)
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
        """Handle factory_reset service call."""
        confirm = call.data.get("confirm", False)
        
        if not confirm:
            raise ValueError("Factory reset must be confirmed by setting 'confirm' to true")
        
        _LOGGER.warning("Factory reset initiated - deleting all schedules, groups, and settings")
        
        # Clear coordinator state
        coordinator.last_node_states.clear()
        
        # Reset storage
        await storage.async_factory_reset()
        
        # Force refresh
        await coordinator.async_request_refresh()
        
        _LOGGER.info("Factory reset completed successfully")

    async def handle_reregister_card(call: ServiceCall) -> dict:
        """Handle reregister_card service call.

        Deletes any existing frontend resource entries matching the provided
        `resource_url` and appends a fresh resource entry with the given
        `resource_type`.
        """
        resource_url = call.data.get("resource_url")
        resource_type = call.data.get("resource_type", "module")

        if not resource_url:
            raise ValueError("'resource_url' is required")

        # Use the Lovelace resources API to manage frontend resources.
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            raise RuntimeError("Lovelace resources helper not available; cannot reregister resource via API")

        # Determine resources helper (API varies by HA version)
        try:
            from homeassistant.const import __version__ as ha_version
            version_parts = [int(x) for x in ha_version.split(".")[:2]]
            version_number = version_parts[0] * 1000 + version_parts[1]
        except Exception:
            version_number = 0

        if version_number >= 2025002 and hasattr(lovelace, "resources"):
            resources = lovelace.resources
        else:
            # Older HA versions expose resources differently
            resources = getattr(lovelace, "get", lambda name: None)("resources") if hasattr(lovelace, "get") else None

        if resources is None:
            raise RuntimeError("Lovelace resources API not available; cannot reregister resource")

        # Ensure resources are loaded and available
        if not getattr(resources, "loaded", True):
            await resources.async_load()

        # Normalize incoming url (compare base without query)
        base_url = resource_url.split("?")[0]

        removed = []
        existing_entry = None

        for entry in list(resources.async_items()):
            entry_url = entry.get("url")
            if not entry_url:
                continue
            entry_base = entry_url.split("?")[0]
            if entry_base == base_url:
                existing_entry = entry
                continue
            # remove exact matches of provided url
            if entry_url == resource_url:
                removed.append(entry)
                await resources.async_delete_item(entry["id"])

        url = resource_url
        added = None
        if existing_entry:
            # update existing item to new url
            await resources.async_update_item(existing_entry["id"], {"url": url})
            added = {"id": existing_entry["id"], "url": url}
            _LOGGER.info("Updated existing Lovelace resource to %s", url)
        else:
            # create new resource item
            item = {"res_type": resource_type, "url": url}
            await resources.async_create_item(item)
            added = item
            _LOGGER.info("Created new Lovelace resource %s", url)

        return {"removed": [r.get("url") for r in removed], "added": added, "message": f"Reregistered resource {url}"}
    
    # Register all services (schemas come from async_get_services() dynamically)
    hass.services.async_register(DOMAIN, "recreate_all_sensors", handle_recreate_all_sensors, service_schemas.get("recreate_all_sensors"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "cleanup_malformed_sensors", handle_cleanup_malformed_sensors, service_schemas.get("cleanup_malformed_sensors"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "set_schedule", handle_set_schedule, service_schemas.get("set_schedule"))
    hass.services.async_register(DOMAIN, "get_schedule", handle_get_schedule, service_schemas.get("get_schedule"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_schedule", handle_clear_schedule, service_schemas.get("clear_schedule"))
    hass.services.async_register(DOMAIN, "enable_schedule", handle_enable_schedule, service_schemas.get("enable_schedule"))
    hass.services.async_register(DOMAIN, "disable_schedule", handle_disable_schedule, service_schemas.get("disable_schedule"))
    hass.services.async_register(DOMAIN, "set_ignored", handle_set_ignored, service_schemas.get("set_ignored"))
    hass.services.async_register(DOMAIN, "sync_all", handle_sync_all, service_schemas.get("sync_all"))
    hass.services.async_register(DOMAIN, "create_group", handle_create_group, service_schemas.get("create_group"))
    hass.services.async_register(DOMAIN, "delete_group", handle_delete_group, service_schemas.get("delete_group"))
    hass.services.async_register(DOMAIN, "rename_group", handle_rename_group, service_schemas.get("rename_group"))
    hass.services.async_register(DOMAIN, "add_to_group", handle_add_to_group, service_schemas.get("add_to_group"))
    hass.services.async_register(DOMAIN, "remove_from_group", handle_remove_from_group, service_schemas.get("remove_from_group"))
    hass.services.async_register(DOMAIN, "get_groups", handle_get_groups, service_schemas.get("get_groups"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "list_groups", handle_list_groups, service_schemas.get("list_groups"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "list_profiles", handle_list_profiles, service_schemas.get("list_profiles"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "set_group_schedule", handle_set_group_schedule, service_schemas.get("set_group_schedule"))
    hass.services.async_register(DOMAIN, "enable_group", handle_enable_group, service_schemas.get("enable_group"))
    hass.services.async_register(DOMAIN, "disable_group", handle_disable_group, service_schemas.get("disable_group"))
    hass.services.async_register(DOMAIN, "get_settings", handle_get_settings, service_schemas.get("get_settings"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "save_settings", handle_save_settings, service_schemas.get("save_settings"))
    hass.services.async_register(DOMAIN, "reload_integration", handle_reload_integration, service_schemas.get("reload_integration"))
    hass.services.async_register(DOMAIN, "advance_schedule", handle_advance_schedule, service_schemas.get("advance_schedule"))
    hass.services.async_register(DOMAIN, "advance_group", handle_advance_group, service_schemas.get("advance_group"))
    hass.services.async_register(DOMAIN, "cancel_advance", handle_cancel_advance, service_schemas.get("cancel_advance"))
    hass.services.async_register(DOMAIN, "get_advance_status", handle_get_advance_status, service_schemas.get("get_advance_status"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "clear_advance_history", handle_clear_advance_history, service_schemas.get("clear_advance_history"))
    hass.services.async_register(DOMAIN, "create_profile", handle_create_profile, service_schemas.get("create_profile"))
    hass.services.async_register(DOMAIN, "delete_profile", handle_delete_profile, service_schemas.get("delete_profile"))
    hass.services.async_register(DOMAIN, "rename_profile", handle_rename_profile, service_schemas.get("rename_profile"))
    hass.services.async_register(DOMAIN, "set_active_profile", handle_set_active_profile, service_schemas.get("set_active_profile"))
    hass.services.async_register(DOMAIN, "get_profiles", handle_get_profiles, service_schemas.get("get_profiles"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "cleanup_derivative_sensors", handle_cleanup_derivative_sensors, service_schemas.get("cleanup_derivative_sensors"), supports_response=SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "factory_reset", handle_factory_reset, service_schemas.get("factory_reset"))
    hass.services.async_register(DOMAIN, "reregister_card", handle_reregister_card, service_schemas.get("reregister_card"), supports_response=SupportsResponse.ONLY)
    
    _LOGGER.info("All Climate Scheduler services registered with dynamic selectors")
