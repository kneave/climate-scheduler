"""Coordinator for Climate Scheduler."""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.const import ATTR_TEMPERATURE

from .const import DOMAIN, TEMP_THRESHOLD, MIN_TEMP, MAX_TEMP
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)


class HeatingSchedulerCoordinator(DataUpdateCoordinator):
    """Coordinator to manage heating schedule updates."""

    def __init__(
        self,
        hass: HomeAssistant,
        storage: ScheduleStorage,
        performance_storage,
        update_interval: timedelta,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=update_interval,
        )
        self.storage = storage
        self.performance_storage = performance_storage
        self.last_node_states = {}  # Track last node state (temp + modes) for each entity
        self.override_until = {}  # Track entities with advance override (entity_id -> time)
        self.advance_history = {}  # Track advance events (entity_id -> list of {activated_at, target_time, cancelled_at})
        self.performance_sessions = {}  # Track active performance sessions (entity_id -> session dict)

    async def async_config_entry_first_refresh(self) -> None:
        """Handle the first refresh."""
        # Load advance history from storage
        self.advance_history = await self.storage.async_get_advance_history()
        _LOGGER.debug(f"Loaded advance history from storage: {self.advance_history}")
        # Call parent's first refresh
        await super().async_config_entry_first_refresh()

    async def force_update_all(self) -> None:
        """Force update all thermostats to their scheduled temperatures."""
        _LOGGER.info("Force updating all thermostats to scheduled temperatures")
        # Clear last node temps to force updates
        self.last_node_states.clear()
        # Trigger immediate refresh
        await self.async_request_refresh()
    
    async def advance_to_next_node(self, entity_id: str) -> Dict[str, Any]:
        """Manually advance a specific entity to its next scheduled node."""
        _LOGGER.info(f"Advancing {entity_id} to next scheduled node")
        
        current_time = datetime.now().time()
        current_day = datetime.now().strftime('%a').lower()
        
        # Load global settings (min/max temps)
        try:
            settings = await self.storage.async_get_settings()
        except Exception:
            settings = {}
        min_temp = settings.get("min_temp", MIN_TEMP)
        max_temp = settings.get("max_temp", MAX_TEMP)
        
        # Find the entity's group (all entities are in groups now)
        groups = await self.storage.async_get_groups()
        schedule_data = None
        group_name = None
        
        for g_name, group_data in groups.items():
            if not group_data.get("enabled", True):
                continue
            # Skip ignored groups
            if group_data.get("ignored", False):
                continue
            if entity_id in group_data.get("entities", []):
                schedule_data = await self.storage.async_get_group_schedule(g_name, current_day)
                group_name = g_name
                is_single = group_data.get("_is_single_entity_group", False)
                group_type = "single-entity" if is_single else "multi-entity"
                _LOGGER.info(f"{entity_id} is in enabled {group_type} group '{g_name}'")
                break
        
        # If not in any group, entity schedule is effectively disabled or ignored
        if not schedule_data:
            return {
                "success": False,
                "error": "Entity schedule is disabled, ignored, or not found"
            }
        
        if not schedule_data or "nodes" not in schedule_data:
            return {
                "success": False,
                "error": "No schedule found for entity"
            }
        
        nodes = schedule_data["nodes"]
        if not nodes:
            return {
                "success": False,
                "error": "Schedule has no nodes"
            }
        
        # Get the next node
        next_node = self.storage.get_next_node(nodes, current_time)
        if not next_node:
            return {
                "success": False,
                "error": "Could not determine next node"
            }
        
        # Set override to prevent auto-revert until next node's scheduled time
        next_node_time_str = next_node["time"]
        next_node_hours, next_node_minutes = map(int, next_node_time_str.split(":"))
        override_until = datetime.now().replace(hour=next_node_hours, minute=next_node_minutes, second=0, microsecond=0)
        # If next node time is earlier in the day than current time, it's tomorrow
        if override_until <= datetime.now():
            override_until += timedelta(days=1)
        self.override_until[entity_id] = override_until
        
        # Record advance activation in history
        if entity_id not in self.advance_history:
            self.advance_history[entity_id] = []
        self.advance_history[entity_id].append({
            "activated_at": datetime.now().isoformat(),
            "target_time": next_node_time_str,
            "target_node": next_node,
            "cancelled_at": None
        })
        
        # Save history to storage
        await self.storage.async_save_advance_history(self.advance_history)
        
        _LOGGER.info(f"Set override for {entity_id} until {override_until}")
        
        _LOGGER.info(f"{entity_id} next node: {next_node}")
        
        # Clamp target temp
        target_temp = next_node["temp"]
        clamped_temp = max(min_temp, min(max_temp, target_temp))
        
        # Create node signature
        node_signature = {
            "temp": clamped_temp,
            "hvac_mode": next_node.get("hvac_mode"),
            "fan_mode": next_node.get("fan_mode"),
            "swing_mode": next_node.get("swing_mode"),
            "preset_mode": next_node.get("preset_mode"),
        }
        
        # Update last node state to mark this as applied
        self.last_node_states[entity_id] = node_signature
        
        # Get entity state
        state = self.hass.states.get(entity_id)
        if state is None:
            return {
                "success": False,
                "error": "Entity not found"
            }
        
        # Get entity capabilities
        hvac_modes = state.attributes.get("hvac_modes", [])
        fan_modes = state.attributes.get("fan_modes", [])
        swing_modes = state.attributes.get("swing_modes", [])
        preset_modes = state.attributes.get("preset_modes", [])
        
        # Apply the next node settings
        target_hvac_mode = next_node.get("hvac_mode")
        
        if target_hvac_mode == "off":
            _LOGGER.info(f"Advancing {entity_id} - turning off")
            try:
                await self.hass.services.async_call(
                    "climate",
                    "turn_off",
                    {"entity_id": entity_id},
                    blocking=True,
                )
            except Exception as e:
                _LOGGER.debug(f"turn_off failed for {entity_id}, trying set_hvac_mode: {e}")
                if "off" in hvac_modes:
                    await self.hass.services.async_call(
                        "climate",
                        "set_hvac_mode",
                        {"entity_id": entity_id, "hvac_mode": "off"},
                        blocking=True,
                    )
        else:
            # Set temperature
            _LOGGER.info(f"Advancing {entity_id} to temp={clamped_temp}°C")
            try:
                await self.hass.services.async_call(
                    "climate",
                    "set_temperature",
                    {
                        "entity_id": entity_id,
                        ATTR_TEMPERATURE: clamped_temp,
                    },
                    blocking=True,
                )
            except Exception as exc:
                return {
                    "success": False,
                    "error": f"Failed to set temperature: {str(exc)}"
                }
            
            # Apply HVAC mode
            if "hvac_mode" in next_node and next_node["hvac_mode"] != "off" and next_node["hvac_mode"] in hvac_modes:
                await self.hass.services.async_call(
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": entity_id, "hvac_mode": next_node["hvac_mode"]},
                    blocking=True,
                )
            
            # Apply fan mode
            if "fan_mode" in next_node and fan_modes and next_node["fan_mode"] in fan_modes:
                await self.hass.services.async_call(
                    "climate",
                    "set_fan_mode",
                    {"entity_id": entity_id, "fan_mode": next_node["fan_mode"]},
                    blocking=True,
                )
            
            # Apply swing mode
            if "swing_mode" in next_node and swing_modes and next_node["swing_mode"] in swing_modes:
                await self.hass.services.async_call(
                    "climate",
                    "set_swing_mode",
                    {"entity_id": entity_id, "swing_mode": next_node["swing_mode"]},
                    blocking=True,
                )
            
            # Apply preset mode
            if "preset_mode" in next_node and preset_modes and next_node["preset_mode"] in preset_modes:
                await self.hass.services.async_call(
                    "climate",
                    "set_preset_mode",
                    {"entity_id": entity_id, "preset_mode": next_node["preset_mode"]},
                    blocking=True,
                )
        
        return {
            "success": True,
            "next_node": next_node,
            "applied_temp": clamped_temp
        }
    
    async def cancel_advance(self, entity_id: str) -> Dict[str, Any]:
        """Cancel an active advance override for an entity."""
        _LOGGER.info(f"cancel_advance called for {entity_id}")
        _LOGGER.info(f"  advance_history keys: {list(self.advance_history.keys())}")
        _LOGGER.info(f"  entity in history: {entity_id in self.advance_history}")
        
        # Mark the most recent advance as cancelled in history (even if override expired)
        if entity_id in self.advance_history and self.advance_history[entity_id]:
            _LOGGER.info(f"  history entries for {entity_id}: {len(self.advance_history[entity_id])}")
            latest = self.advance_history[entity_id][-1]
            _LOGGER.info(f"  latest entry cancelled_at before: {latest.get('cancelled_at')}")
            if latest["cancelled_at"] is None:
                latest["cancelled_at"] = datetime.now().isoformat()
                # Save updated history to storage
                await self.storage.async_save_advance_history(self.advance_history)
                _LOGGER.info(f"Marked advance as cancelled in history for {entity_id}")
            else:
                _LOGGER.info(f"  latest entry already cancelled")
        else:
            _LOGGER.warning(f"No advance history found for {entity_id} to cancel")
        
        # Remove override if it exists
        if entity_id in self.override_until:
            del self.override_until[entity_id]
            _LOGGER.info(f"Removed active override for {entity_id}")
        
        # Clear last node state to force immediate update to current schedule
        if entity_id in self.last_node_states:
            del self.last_node_states[entity_id]
        
        _LOGGER.info(f"Cancelled advance for {entity_id}")
        
        # Trigger immediate update
        await self.async_request_refresh()
        
        return {
            "success": True
        }
    
    async def clear_advance_history(self, entity_id: str) -> Dict[str, Any]:
        """Clear advance history for an entity."""
        if entity_id in self.advance_history:
            del self.advance_history[entity_id]
            # Save updated history to storage
            await self.storage.async_save_advance_history(self.advance_history)
            _LOGGER.info(f"Cleared advance history for {entity_id}")
        
        return {
            "success": True
        }
    
    def get_advance_history(self, entity_id: str, hours: int = 24) -> List[Dict[str, Any]]:
        """Get advance history for an entity within the last N hours."""
        if entity_id not in self.advance_history:
            return []
        
        cutoff = datetime.now() - timedelta(hours=hours)
        history = []
        
        for event in self.advance_history[entity_id]:
            activated = datetime.fromisoformat(event["activated_at"])
            if activated >= cutoff:
                history.append(event)
        
        return history
    
    async def advance_group_to_next_node(self, group_name: str) -> Dict[str, Any]:
        """Advance all entities in a group to their next scheduled node."""
        _LOGGER.info(f"Advancing group '{group_name}' to next scheduled node")
        
        # Get the group
        groups = await self.storage.async_get_groups()
        if group_name not in groups:
            return {
                "success": False,
                "error": f"Group '{group_name}' not found"
            }
        
        group_data = groups[group_name]
        if not group_data.get("enabled", True):
            return {
                "success": False,
                "error": "Group is disabled"
            }
        
        entity_ids = group_data.get("entities", [])
        if not entity_ids:
            return {
                "success": False,
                "error": "Group has no entities"
            }
        
        # Advance each entity in the group
        results = {}
        success_count = 0
        error_count = 0
        
        for entity_id in entity_ids:
            try:
                result = await self.advance_to_next_node(entity_id)
                results[entity_id] = result
                if result.get("success"):
                    success_count += 1
                else:
                    error_count += 1
            except Exception as e:
                results[entity_id] = {
                    "success": False,
                    "error": str(e)
                }
                error_count += 1
        
        return {
            "success": success_count > 0,
            "total_entities": len(entity_ids),
            "success_count": success_count,
            "error_count": error_count,
            "results": results
        }
    
    def get_override_status(self, entity_id: str) -> Dict[str, Any]:
        """Get override status for an entity."""
        if entity_id in self.override_until:
            override_time = self.override_until[entity_id]
            if datetime.now() < override_time:
                return {
                    "has_override": True,
                    "override_until": override_time.isoformat()
                }
        return {"has_override": False}

    async def _async_update_data(self) -> Dict[str, Any]:
        """Update heating schedules."""
        _LOGGER.info("=== COORDINATOR UPDATE CYCLE START ===")
        try:
            current_time = datetime.now().time()
            current_day = datetime.now().strftime('%a').lower()  # Get day: mon, tue, wed, etc.
            _LOGGER.info(f"Current time: {current_time}, day: {current_day}")
            # Load global settings (min/max temps)
            try:
                settings = await self.storage.async_get_settings()
            except Exception:
                settings = {}
            min_temp = settings.get("min_temp", MIN_TEMP)
            max_temp = settings.get("max_temp", MAX_TEMP)

            # Get all groups and build a map of entities to their group schedules
            # Now ALL entities are in groups (either multi-entity or single-entity groups)
            groups = await self.storage.async_get_groups()
            entity_group_schedules = {}  # Maps entity_id -> (group_name, schedule_data)
            groups_migrated = False
            
            for group_name, group_data in groups.items():
                # Migrate existing groups - add enabled=True if missing
                if "enabled" not in group_data:
                    group_data["enabled"] = True
                    groups_migrated = True
                    _LOGGER.info(f"Migrated group '{group_name}' - added enabled=True")
                
                if not group_data.get("enabled", True):
                    _LOGGER.debug(f"Skipping disabled group '{group_name}'")
                    continue
                
                # Skip ignored groups (single-entity groups marked as ignored)
                if group_data.get("ignored", False):
                    _LOGGER.debug(f"Skipping ignored group '{group_name}'")
                    continue
                
                # Get group schedule for current day
                group_schedule = await self.storage.async_get_group_schedule(group_name, current_day)
                if group_schedule and "nodes" in group_schedule:
                    # Map all entities in this group to this schedule
                    for entity_id in group_data.get("entities", []):
                        entity_group_schedules[entity_id] = (group_name, group_schedule)
                        is_single = group_data.get("_is_single_entity_group", False)
                        group_type = "single-entity" if is_single else "multi-entity"
                        _LOGGER.info(f"{entity_id} will use enabled {group_type} group '{group_name}' schedule")
            
            # Save storage if any groups were migrated
            if groups_migrated:
                await self.storage.async_save()
                _LOGGER.info("Saved migrated group data")
            
            _LOGGER.info(f"Found {len(entity_group_schedules)} entities with enabled group schedules")
            
            results = {}
            
            # Process all entities that have group schedules (both single and multi-entity groups)
            for entity_id, (group_name, schedule_data) in entity_group_schedules.items():
                _LOGGER.info(f"Processing entity: {entity_id} from group '{group_name}'")
                
                # Check if entity has an active advance override
                if entity_id in self.override_until:
                    override_time = self.override_until[entity_id]
                    if datetime.now() < override_time:
                        _LOGGER.debug(f"Skipping {entity_id} - advance override active until {override_time}")
                        results[entity_id] = {
                            "updated": False,
                            "reason": "advance_override_active"
                        }
                        continue
                    else:
                        # Override expired, mark as completed in history
                        _LOGGER.info(f"Override expired for {entity_id}, resuming normal scheduling")
                        history_updated = False
                        if entity_id in self.advance_history and self.advance_history[entity_id]:
                            # Find the most recent uncompleted advance
                            for event in reversed(self.advance_history[entity_id]):
                                if event["cancelled_at"] is None:
                                    event["cancelled_at"] = datetime.now().isoformat()
                                    _LOGGER.info(f"Marked advance as completed for {entity_id}")
                                    history_updated = True
                                    break
                        if history_updated:
                            # Save updated history to storage
                            await self.storage.async_save_advance_history(self.advance_history)
                        del self.override_until[entity_id]
                
                # Entity is in a group (either multi-entity or single-entity group)
                _LOGGER.info(f"{entity_id} using group '{group_name}' schedule")
                
                _LOGGER.info(f"{entity_id} schedule data for {current_day}: {schedule_data}")
                if not schedule_data or "nodes" not in schedule_data:
                    _LOGGER.debug(f"No schedule nodes for {entity_id}")
                    continue
                
                nodes = schedule_data["nodes"]
                _LOGGER.info(f"{entity_id} has {len(nodes)} nodes for {current_day}")
                
                # Get active node (includes temp and other settings)
                active_node = self.storage.get_active_node(nodes, current_time)
                if not active_node:
                    _LOGGER.debug(f"No active node for {entity_id}")
                    continue
                    
                target_temp = active_node["temp"]
                _LOGGER.info(f"{entity_id} active node: {active_node}")
                
                # Clamp target temp to global min/max BEFORE creating signature
                # This prevents infinite update loops where unclamped signature differs from clamped output
                clamped_temp = target_temp
                if target_temp < min_temp:
                    clamped_temp = min_temp
                    _LOGGER.debug(f"Clamping {entity_id} target {target_temp} -> {clamped_temp}")
                elif target_temp > max_temp:
                    clamped_temp = max_temp
                    _LOGGER.debug(f"Clamping {entity_id} target {target_temp} -> {clamped_temp}")
                
                # Create a state signature for the node using CLAMPED temp + modes
                node_signature = {
                    "temp": clamped_temp,
                    "hvac_mode": active_node.get("hvac_mode"),
                    "fan_mode": active_node.get("fan_mode"),
                    "swing_mode": active_node.get("swing_mode"),
                    "preset_mode": active_node.get("preset_mode"),
                }
                
                # Check if we've transitioned to a new node
                last_node = self.last_node_states.get(entity_id)
                if last_node == node_signature:
                    # Still on same node, don't override manual changes
                    _LOGGER.debug(f"{entity_id} still on same node, skipping")
                    results[entity_id] = {
                        "updated": False,
                        "target_temp": target_temp,
                        "reason": "same_node"
                    }
                    continue
                
                # Node has changed, update the temperature and settings
                _LOGGER.info(f"{entity_id} node changed: {last_node} -> {node_signature}")
                self.last_node_states[entity_id] = node_signature
                
                # Get current state
                state = self.hass.states.get(entity_id)
                if state is None:
                    _LOGGER.warning(f"Entity {entity_id} not found")
                    continue
                
                _LOGGER.info(f"{entity_id} state found: {state.state}")
                # Get current target temperature
                current_target = state.attributes.get("temperature")
                current_temp = state.attributes.get("current_temperature")
                _LOGGER.info(f"{entity_id} current target: {current_target}°C, current temp: {current_temp}°C")
                
                # Check if we should start a performance tracking session
                # Only if target temp changes significantly (>0.5°C) and current temp is available
                if current_temp is not None and abs(target_temp - current_temp) > 0.5:
                    # End any existing session (interrupted by new target)
                    if entity_id in self.performance_sessions:
                        await self._end_performance_session(entity_id, current_temp, "new_target")
                    
                    # Start new session
                    await self._start_performance_session(
                        entity_id,
                        current_temp,
                        target_temp,
                        active_node,
                        group_name,
                        group_data.get("active_profile", "Default")
                    )
                
                # Get entity capabilities
                supported_features = state.attributes.get("supported_features", 0)
                hvac_modes = state.attributes.get("hvac_modes", [])
                fan_modes = state.attributes.get("fan_modes", [])
                swing_modes = state.attributes.get("swing_modes", [])
                preset_modes = state.attributes.get("preset_modes", [])
                
                # Check if we're turning off - if so, skip temperature and just turn off
                target_hvac_mode = active_node.get("hvac_mode")
                _LOGGER.info(f"{entity_id} target_hvac_mode: {target_hvac_mode}, supported modes: {hvac_modes}")
                if target_hvac_mode == "off":
                    _LOGGER.info(f"Turning off {entity_id}")
                    # Try using turn_off service first (more reliable for some integrations)
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "turn_off",
                            {
                                "entity_id": entity_id,
                            },
                            blocking=True,
                        )
                    except Exception as e:
                        # Fallback to set_hvac_mode if turn_off not supported
                        _LOGGER.debug(f"turn_off failed for {entity_id}, trying set_hvac_mode: {e}")
                        if "off" in hvac_modes:
                            await self.hass.services.async_call(
                                "climate",
                                "set_hvac_mode",
                                {
                                    "entity_id": entity_id,
                                    "hvac_mode": "off",
                                },
                                blocking=True,
                            )
                else:
                    # Update to new node temperature (already clamped in signature)
                    _LOGGER.info(
                        f"Updating {entity_id} to new node: temp={clamped_temp}°C"
                    )

                    # Build service data
                    service_data = {
                        "entity_id": entity_id,
                        ATTR_TEMPERATURE: clamped_temp,
                    }

                    # Call climate service to set temperature (handle per-entity errors)
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_temperature",
                            service_data,
                            blocking=True,
                        )
                    except Exception as exc:
                        _LOGGER.error(f"Failed to set_temperature for {entity_id}: {exc}")
                        results[entity_id] = {
                            "updated": False,
                            "target_temp": target_temp,
                            "applied_temp": None,
                            "error": str(exc),
                        }
                        # Skip further actions for this entity
                        continue
                    
                    # Apply HVAC mode if specified in node and supported by entity (except off, handled above)
                    if "hvac_mode" in active_node and active_node["hvac_mode"] != "off" and active_node["hvac_mode"] in hvac_modes:
                        _LOGGER.info(f"Setting HVAC mode to {active_node['hvac_mode']}")
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {
                                "entity_id": entity_id,
                                "hvac_mode": active_node["hvac_mode"],
                            },
                            blocking=True,
                        )
                    elif "hvac_mode" in active_node and active_node["hvac_mode"] != "off":
                        _LOGGER.debug(f"HVAC mode {active_node['hvac_mode']} not supported by {entity_id}")
                
                # Apply fan mode if specified in node and supported by entity
                if "fan_mode" in active_node and fan_modes and active_node["fan_mode"] in fan_modes:
                    _LOGGER.info(f"Setting fan mode to {active_node['fan_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_fan_mode",
                        {
                            "entity_id": entity_id,
                            "fan_mode": active_node["fan_mode"],
                        },
                        blocking=True,
                    )
                elif "fan_mode" in active_node and fan_modes:
                    _LOGGER.debug(f"Fan mode {active_node['fan_mode']} not supported by {entity_id}")
                
                # Apply swing mode if specified in node and supported by entity
                if "swing_mode" in active_node and swing_modes and active_node["swing_mode"] in swing_modes:
                    _LOGGER.info(f"Setting swing mode to {active_node['swing_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_swing_mode",
                        {
                            "entity_id": entity_id,
                            "swing_mode": active_node["swing_mode"],
                        },
                        blocking=True,
                    )
                elif "swing_mode" in active_node and swing_modes:
                    _LOGGER.debug(f"Swing mode {active_node['swing_mode']} not supported by {entity_id}")
                
                # Apply preset mode if specified in node and supported by entity
                if "preset_mode" in active_node and preset_modes and active_node["preset_mode"] in preset_modes:
                    _LOGGER.info(f"Setting preset mode to {active_node['preset_mode']}")
                    await self.hass.services.async_call(
                        "climate",
                        "set_preset_mode",
                        {
                            "entity_id": entity_id,
                            "preset_mode": active_node["preset_mode"],
                        },
                        blocking=True,
                    )
                elif "preset_mode" in active_node and preset_modes:
                    _LOGGER.debug(f"Preset mode {active_node['preset_mode']} not supported by {entity_id}")
                
                results[entity_id] = {
                    "updated": True,
                    "target_temp": target_temp,
                    "previous_temp": current_target,
                }
            
            # Update active performance sessions
            await self._update_performance_sessions()
            
            return results
            
        except Exception as err:
            _LOGGER.error(f"Error updating heating schedules: {err}")
            raise UpdateFailed(f"Error updating heating schedules: {err}")

    async def _start_performance_session(
        self,
        entity_id: str,
        start_temp: float,
        target_temp: float,
        active_node: Dict[str, Any],
        group_name: str,
        active_profile: str
    ) -> None:
        """Start tracking a performance session for heating/cooling analysis."""
        # Check if performance tracking is enabled
        settings = await self.performance_storage.async_get_settings()
        if not settings.get("enabled", False):
            return

        # Determine session type
        session_type = "heating" if target_temp > start_temp else "cooling"
        
        # Get outdoor temperature if configured
        outdoor_sensor = settings.get("outdoor_sensor")
        outdoor_temp_start = None
        if outdoor_sensor:
            outdoor_state = self.hass.states.get(outdoor_sensor)
            if outdoor_state:
                try:
                    outdoor_temp_start = float(outdoor_state.state)
                except (ValueError, TypeError):
                    _LOGGER.warning(f"Could not parse outdoor temperature from {outdoor_sensor}")

        # Get current datetime
        now = datetime.now()
        
        # Create session record
        session = {
            "entity_id": entity_id,
            "start_time": now.isoformat(),
            "start_temp": start_temp,
            "target_temp": target_temp,
            "session_type": session_type,
            "hvac_mode": active_node.get("hvac_mode", "unknown"),
            "active_profile": active_profile,
            "schedule_group": group_name,
            "day_of_week": now.strftime("%a").lower(),
            "time_category": self.performance_storage._determine_time_category(now.hour),
            "month": now.month,
            "season": self.performance_storage._determine_season(now.month),
            "fan_mode": active_node.get("fan_mode"),
            "preset_mode": active_node.get("preset_mode"),
            "outdoor_temp_start": outdoor_temp_start,
            "outdoor_temp_samples": [outdoor_temp_start] if outdoor_temp_start is not None else []
        }
        
        # Store active session
        self.performance_sessions[entity_id] = session
        _LOGGER.info(f"Started {session_type} session for {entity_id}: {start_temp}°C → {target_temp}°C")

    async def _update_performance_sessions(self) -> None:
        """Update active performance sessions during coordinator cycle."""
        # Check if performance tracking is enabled
        settings = await self.performance_storage.async_get_settings()
        if not settings.get("enabled", False):
            return

        # Get outdoor temperature if configured
        outdoor_sensor = settings.get("outdoor_sensor")
        current_outdoor_temp = None
        if outdoor_sensor:
            outdoor_state = self.hass.states.get(outdoor_sensor)
            if outdoor_state:
                try:
                    current_outdoor_temp = float(outdoor_state.state)
                except (ValueError, TypeError):
                    pass

        # Check each active session
        for entity_id in list(self.performance_sessions.keys()):
            session = self.performance_sessions[entity_id]
            
            # Sample outdoor temperature
            if current_outdoor_temp is not None:
                session["outdoor_temp_samples"].append(current_outdoor_temp)
            
            # Get current temperature
            state = self.hass.states.get(entity_id)
            if not state:
                continue
            
            current_temp = state.attributes.get("current_temperature")
            if current_temp is None:
                continue
            
            # Check if session should end
            target_temp = session["target_temp"]
            session_start = datetime.fromisoformat(session["start_time"])
            duration = (datetime.now() - session_start).total_seconds() / 60  # minutes
            
            # End conditions: reached target (within 0.5°C), timeout (4 hours), or interrupted by new target
            reached_target = abs(current_temp - target_temp) < 0.5
            timeout = duration > 240  # 4 hours
            
            if reached_target or timeout:
                await self._end_performance_session(entity_id, current_temp, "target_reached" if reached_target else "timeout")

    async def _end_performance_session(
        self,
        entity_id: str,
        end_temp: float,
        reason: str
    ) -> None:
        """End and save a performance session."""
        if entity_id not in self.performance_sessions:
            return
        
        session = self.performance_sessions[entity_id]
        
        # Calculate session metrics
        now = datetime.now()
        start_time = datetime.fromisoformat(session["start_time"])
        duration_minutes = (now - start_time).total_seconds() / 60
        temp_change = end_temp - session["start_temp"]
        
        # Validate session (minimum 5 minutes, minimum 0.5°C change)
        if duration_minutes < 5 or abs(temp_change) < 0.5:
            _LOGGER.debug(f"Session for {entity_id} too short or insufficient change, not saving")
            del self.performance_sessions[entity_id]
            return
        
        # Calculate rate (°C/hour)
        rate = (temp_change / duration_minutes) * 60
        
        # Calculate outdoor temperature metrics
        outdoor_temp_end = None
        outdoor_temp_avg = None
        indoor_outdoor_diff_start = None
        indoor_outdoor_diff_end = None
        
        if session["outdoor_temp_samples"]:
            outdoor_temp_end = session["outdoor_temp_samples"][-1]
            outdoor_temp_avg = sum(session["outdoor_temp_samples"]) / len(session["outdoor_temp_samples"])
            if session["outdoor_temp_start"] is not None:
                indoor_outdoor_diff_start = session["start_temp"] - session["outdoor_temp_start"]
            if outdoor_temp_end is not None:
                indoor_outdoor_diff_end = end_temp - outdoor_temp_end
        
        # Get humidity if available
        state = self.hass.states.get(entity_id)
        humidity_start = None
        humidity_end = None
        if state:
            humidity_end = state.attributes.get("current_humidity")
        
        # Build final session record
        final_session = {
            "entity_id": entity_id,
            "start_time": session["start_time"],
            "end_time": now.isoformat(),
            "duration_minutes": int(duration_minutes),
            "start_temp": session["start_temp"],
            "end_temp": end_temp,
            "temp_change": round(temp_change, 2),
            "target_temp": session["target_temp"],
            "session_type": session["session_type"],
            "rate": round(rate, 2),
            "outdoor_temp_start": session["outdoor_temp_start"],
            "outdoor_temp_end": outdoor_temp_end,
            "outdoor_temp_avg": round(outdoor_temp_avg, 2) if outdoor_temp_avg is not None else None,
            "indoor_outdoor_differential_start": round(indoor_outdoor_diff_start, 2) if indoor_outdoor_diff_start is not None else None,
            "indoor_outdoor_differential_end": round(indoor_outdoor_diff_end, 2) if indoor_outdoor_diff_end is not None else None,
            "hvac_mode": session["hvac_mode"],
            "active_profile": session["active_profile"],
            "schedule_group": session["schedule_group"],
            "day_of_week": session["day_of_week"],
            "time_category": session["time_category"],
            "month": session["month"],
            "season": session["season"],
            "completed": reason == "target_reached",
            "interruption_reason": reason if reason != "target_reached" else None,
            "fan_mode": session.get("fan_mode"),
            "preset_mode": session.get("preset_mode"),
            "humidity_start": humidity_start,
            "humidity_end": humidity_end
        }
        
        # Save to performance storage
        await self.performance_storage.async_add_session(final_session)
        
        # Remove from active sessions
        del self.performance_sessions[entity_id]
        
        _LOGGER.info(f"Completed {session['session_type']} session for {entity_id}: {temp_change:.1f}°C in {duration_minutes:.0f}min (rate: {rate:.2f}°C/h)")
