"""Coordinator for Climate Scheduler."""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.const import ATTR_TEMPERATURE
from homeassistant.util import dt as dt_util

from .const import DOMAIN, MIN_TEMP, MAX_TEMP, NO_CHANGE_TEMP
from .storage import ScheduleStorage

_LOGGER = logging.getLogger(__name__)


class HeatingSchedulerCoordinator(DataUpdateCoordinator):
    """Coordinator to manage heating schedule updates."""

    # Backwards-compatible service API wrappers
    # Services call these names (async_advance_schedule/async_advance_group/async_cancel_advance)
    # but the coordinator implementation uses advance_to_next_node/advance_group_to_next_node/cancel_advance.
    async def async_advance_schedule(self, entity_id: str) -> Dict[str, Any]:
        """Service wrapper: advance a single climate entity to its next node."""
        return await self.advance_to_next_node(entity_id)

    async def async_advance_group(self, group_name: str) -> Dict[str, Any]:
        """Service wrapper: advance all entities in a group to their next node."""
        return await self.advance_group_to_next_node(group_name)

    async def async_cancel_advance(self, entity_id: str) -> Dict[str, Any]:
        """Service wrapper: cancel an active advance override for an entity."""
        return await self.cancel_advance(entity_id)

    async def async_get_advance_status(self, entity_id: str) -> dict:
        """Return advance override status for a climate entity or a group schedule_id."""
        now = dt_util.now()

        # If this is a group schedule_id, aggregate across member entities.
        group = await self.storage.async_get_group(entity_id)
        if group is not None:
            member_ids = group.get("entities", [])
            latest_until: Optional[datetime] = None

            for member_id in member_ids:
                until = self.override_until.get(member_id)
                if until and until > now:
                    if latest_until is None or until > latest_until:
                        latest_until = until

            return {
                "entity_id": entity_id,
                "is_advanced": latest_until is not None,
                "advance_time": latest_until.isoformat() if latest_until else None,
                "original_node": None,
                "advanced_node": None,
            }

        # Non-group: check if the entity has an active override (advance)
        is_advanced = False
        advance_time = None
        original_node = None
        advanced_node = None

        if entity_id in self.override_until:
            until = self.override_until[entity_id]
            if until > now:
                is_advanced = True
                advance_time = until.isoformat()

        history = self.advance_history.get(entity_id, [])
        if history:
            last = history[-1]
            original_node = last.get("original_node")
            advanced_node = last.get("advanced_node")

        return {
            "entity_id": entity_id,
            "is_advanced": is_advanced,
            "advance_time": advance_time,
            "original_node": original_node,
            "advanced_node": advanced_node,
        }

    def __init__(
        self,
        hass: HomeAssistant,
        storage: ScheduleStorage,
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
        self.last_node_states = {}  # Track last node state (temp + modes) for each entity
        self.last_node_times = {}  # Track last node time for each entity to detect time transitions
        self.override_until = {}  # Track entities with advance override (entity_id -> time)
        self.advance_history = {}  # Track advance events (entity_id -> list of {activated_at, target_time, cancelled_at})

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
        # Clear last node states and times to force updates
        self.last_node_states.clear()
        self.last_node_times.clear()
        # Trigger immediate refresh
        await self.async_request_refresh()
    
    async def advance_to_next_node(self, entity_id: str) -> Dict[str, Any]:
        """Manually advance a specific entity to its next scheduled node."""
        _LOGGER.info(f"Advancing {entity_id} to next scheduled node")
        
        now = dt_util.now()
        current_time = now.time()
        current_day = now.strftime('%a').lower()
        
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
        override_until = dt_util.now().replace(hour=next_node_hours, minute=next_node_minutes, second=0, microsecond=0)
        # If next node time is earlier in the day than current time, it's tomorrow
        if override_until <= dt_util.now():
            override_until += timedelta(days=1)
        self.override_until[entity_id] = override_until
        
        # Record advance activation in history
        if entity_id not in self.advance_history:
            self.advance_history[entity_id] = []
        self.advance_history[entity_id].append({
            "activated_at": dt_util.now().isoformat(),
            "target_time": next_node_time_str,
            "target_node": next_node,
            "cancelled_at": None
        })
        
        # Save history to storage
        await self.storage.async_save_advance_history(self.advance_history)
        
        _LOGGER.info(f"Set override for {entity_id} until {override_until}")
        
        _LOGGER.info(f"{entity_id} next node: {next_node}")
        
        # Clamp target temp (or use None for no change)
        target_temp = next_node.get("temp")
        is_no_change = next_node.get("noChange", False)
        if is_no_change:
            clamped_temp = None
            _LOGGER.info(f"{entity_id} temp set to NO_CHANGE - will not modify temperature")
        else:
            clamped_temp = max(min_temp, min(max_temp, target_temp)) if target_temp is not None else None
        
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
            # Check if this is a preset-only entity
            current_temperature = state.attributes.get("current_temperature")
            is_preset_only = current_temperature is None
            
            # Set temperature (only if not NO_CHANGE and entity supports temperature)
            if clamped_temp is not None and not is_preset_only:
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
            elif clamped_temp is not None and is_preset_only:
                _LOGGER.info(f"Skipping temperature change for {entity_id} (preset-only entity)")
            else:
                _LOGGER.info(f"Skipping temperature change for {entity_id} (NO_CHANGE set)")
            
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
        
        # Fire event for manual advance
        # Get all entities in the group for event data
        group_entities = groups[group_name].get("entities", [])
        
        self.hass.bus.async_fire(
            f"{DOMAIN}_node_activated",
            {
                # TODO: Remove entity_id in future version - deprecated in favor of entities list
                "entity_id": entity_id,  # Specific entity that was advanced
                "entities": group_entities,  # All entities in the group
                "group_name": group_name,
                "node": {
                    "time": next_node.get("time"),
                    "temp": clamped_temp,
                    "hvac_mode": next_node.get("hvac_mode"),
                    "fan_mode": next_node.get("fan_mode"),
                    "swing_mode": next_node.get("swing_mode"),
                    "preset_mode": next_node.get("preset_mode"),
                    "A": next_node.get("A"),
                    "B": next_node.get("B"),
                    "C": next_node.get("C"),
                },
                "day": current_day,
                "trigger_type": "manual_advance",
            }
        )
        _LOGGER.info(f"Fired node_activated event for {entity_id} (manual_advance)")
        
        return {
            "success": True,
            "next_node": next_node,
            "applied_temp": clamped_temp
        }
    
    async def cancel_advance(self, entity_id: str) -> Dict[str, Any]:
        """Cancel an active advance override for an entity or a group schedule_id."""

        async def _cancel_single(target_entity_id: str) -> None:
            # Mark the most recent advance as cancelled in history (even if override expired)
            if target_entity_id in self.advance_history and self.advance_history[target_entity_id]:
                latest = self.advance_history[target_entity_id][-1]
                if latest.get("cancelled_at") is None:
                    latest["cancelled_at"] = dt_util.now().isoformat()

            # Remove override if it exists
            if target_entity_id in self.override_until:
                del self.override_until[target_entity_id]

            # Clear last node state to force immediate update to current schedule
            if target_entity_id in self.last_node_states:
                del self.last_node_states[target_entity_id]

        group = await self.storage.async_get_group(entity_id)
        if group is not None:
            member_ids = group.get("entities", [])
            for member_id in member_ids:
                await _cancel_single(member_id)

            # Cancel group-level history/override if present.
            await _cancel_single(entity_id)

            await self.storage.async_save_advance_history(self.advance_history)
            _LOGGER.info(f"Cancelled advance for group '{entity_id}' ({len(member_ids)} members)")
            await self.async_request_refresh()
            return {"success": True}

        _LOGGER.info(f"cancel_advance called for {entity_id}")

        if entity_id not in self.advance_history or not self.advance_history[entity_id]:
            _LOGGER.warning(f"No advance history found for {entity_id} to cancel")

        await _cancel_single(entity_id)
        await self.storage.async_save_advance_history(self.advance_history)
        _LOGGER.info(f"Cancelled advance for {entity_id}")
        await self.async_request_refresh()
        return {"success": True}
    
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
        
        cutoff = dt_util.now() - timedelta(hours=hours)
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
        first_success_entity_id: Optional[str] = None
        first_success_next_node: Optional[Dict[str, Any]] = None
        
        for entity_id in entity_ids:
            try:
                result = await self.advance_to_next_node(entity_id)
                results[entity_id] = result
                if result.get("success"):
                    success_count += 1
                    if first_success_entity_id is None:
                        first_success_entity_id = entity_id
                        first_success_next_node = result.get("next_node")
                else:
                    error_count += 1
            except Exception as e:
                results[entity_id] = {
                    "success": False,
                    "error": str(e)
                }
                error_count += 1

        # Record a group-level advance entry so schedule_id==group_name behaves consistently.
        if success_count > 0 and first_success_entity_id and first_success_next_node:
            if group_name not in self.advance_history:
                self.advance_history[group_name] = []
            self.advance_history[group_name].append(
                {
                    "activated_at": dt_util.now().isoformat(),
                    "target_time": first_success_next_node.get("time"),
                    "target_node": first_success_next_node,
                    "cancelled_at": None,
                }
            )

            # Mirror an override timestamp for the group id (used by status checks).
            member_until = self.override_until.get(first_success_entity_id)
            if member_until is not None:
                self.override_until[group_name] = member_until

            await self.storage.async_save_advance_history(self.advance_history)
        
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
            if dt_util.now() < override_time:
                return {
                    "has_override": True,
                    "override_until": override_time.isoformat()
                }
        return {"has_override": False}

    async def _async_update_data(self) -> Dict[str, Any]:
        """Update heating schedules."""
        _LOGGER.info("=== COORDINATOR UPDATE CYCLE START ===")
        try:
            now = dt_util.now()
            current_time = now.time()
            current_day = now.strftime('%a').lower()  # Get day: mon, tue, wed, etc.
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
                    # In individual or 5/2 mode, if current time is before all nodes today,
                    # we need to check previous day's schedule for the active node
                    schedule_mode = group_schedule.get("schedule_mode", "all_days")
                    nodes = group_schedule["nodes"]
                    
                    if schedule_mode in ["individual", "5/2"] and nodes:
                        # Check if current time is before all nodes today
                        sorted_nodes = sorted(nodes, key=lambda n: self.storage._time_to_minutes(n["time"]))
                        current_minutes = current_time.hour * 60 + current_time.minute
                        first_node_minutes = self.storage._time_to_minutes(sorted_nodes[0]["time"])
                        
                        if current_minutes < first_node_minutes:
                            # We're before the first node of today, need previous day/period's last node
                            _LOGGER.info(f"Group '{group_name}': Current time {current_time} is before first node today, checking previous period")
                            
                            # Calculate previous day
                            days_of_week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                            current_day_index = days_of_week.index(current_day)
                            prev_day = days_of_week[(current_day_index - 1) % 7]
                            
                            # Get previous day's schedule
                            prev_day_schedule = await self.storage.async_get_group_schedule(group_name, prev_day)
                            if prev_day_schedule and prev_day_schedule.get("nodes"):
                                # Use previous day's last node as the active node until first node today
                                prev_nodes = prev_day_schedule["nodes"]
                                sorted_prev_nodes = sorted(prev_nodes, key=lambda n: self.storage._time_to_minutes(n["time"]))
                                last_prev_node = sorted_prev_nodes[-1]
                                
                                # Prepend the previous day's last node to today's schedule with time "00:00"
                                # This way get_active_node will correctly use it as the active node until first node today
                                carryover_node = {**last_prev_node, "time": "00:00", "_from_previous_day": True}
                                group_schedule["nodes"] = [carryover_node] + nodes
                                _LOGGER.info(f"Group '{group_name}': Carrying over previous period's node (temp={last_prev_node.get('temp')}) to bridge to first node at {sorted_nodes[0]['time']}")
                    
                    entities_list = group_data.get("entities", [])
                    
                    if len(entities_list) == 0:
                        # Virtual group with no entities - track separately for event-only processing
                        entity_group_schedules[f"_virtual_{group_name}"] = (group_name, group_schedule, True)
                        _LOGGER.info(f"Virtual group '{group_name}' will fire events only (no entities)")
                    else:
                        # Map all entities in this group to this schedule
                        for entity_id in entities_list:
                            entity_group_schedules[entity_id] = (group_name, group_schedule, False)
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
            for entity_id, (group_name, schedule_data, is_virtual) in entity_group_schedules.items():
                # Handle virtual groups (no entities, events only)
                if is_virtual:
                    _LOGGER.info(f"Processing virtual group: '{group_name}'")
                    
                    nodes = schedule_data["nodes"]
                    active_node = self.storage.get_active_node(nodes, current_time)
                    if not active_node:
                        _LOGGER.debug(f"No active node for virtual group '{group_name}'")
                        continue
                    
                    # Create signature for virtual group tracking (includes time for comparison)
                    virtual_key = f"_virtual_{group_name}"
                    node_time = active_node.get("time")
                    node_signature = {
                        "time": node_time,
                        "temp": active_node.get("temp"),
                        "hvac_mode": active_node.get("hvac_mode"),
                        "fan_mode": active_node.get("fan_mode"),
                        "swing_mode": active_node.get("swing_mode"),
                        "preset_mode": active_node.get("preset_mode"),
                        "A": active_node.get("A"),
                        "B": active_node.get("B"),
                        "C": active_node.get("C"),
                    }
                    
                    # Check if we've transitioned to a new node (including time check)
                    last_node = self.last_node_states.get(virtual_key)
                    last_node_time = self.last_node_times.get(virtual_key)
                    
                    # For virtual groups, we include time in the signature itself
                    # so we can rely on signature comparison alone
                    if last_node == node_signature:
                        _LOGGER.debug(f"Virtual group '{group_name}' still on same node (time: {node_time}), skipping")
                        results[virtual_key] = {
                            "updated": False,
                            "reason": "same_node"
                        }
                        continue
                    
                    # Node has changed, fire event
                    self.last_node_states[virtual_key] = node_signature
                    self.last_node_times[virtual_key] = node_time
                    
                    self.hass.bus.async_fire(
                        f"{DOMAIN}_node_activated",
                        {
                            # TODO: Remove entity_id in future version - deprecated in favor of entities list
                            "entity_id": None,  # No entity for virtual groups
                            "entities": [],  # Empty list for virtual groups
                            "group_name": group_name,
                            "node": {
                                "time": active_node.get("time"),
                                "temp": active_node.get("temp"),
                                "hvac_mode": active_node.get("hvac_mode"),
                                "fan_mode": active_node.get("fan_mode"),
                                "swing_mode": active_node.get("swing_mode"),
                                "preset_mode": active_node.get("preset_mode"),
                                "A": active_node.get("A"),
                                "B": active_node.get("B"),
                                "C": active_node.get("C"),
                            },
                            "previous_node": last_node,
                            "day": current_day,
                            "trigger_type": "scheduled",
                        }
                    )
                    _LOGGER.info(f"Fired node_activated event for virtual group '{group_name}' (scheduled)")
                    
                    results[virtual_key] = {
                        "updated": True,
                        "virtual": True
                    }
                    continue
                
                # Check if entity exists in Home Assistant first
                state = self.hass.states.get(entity_id)
                if state is None:
                    _LOGGER.debug(f"Entity {entity_id} not found in Home Assistant, skipping (may have been removed or renamed)")
                    continue
                
                _LOGGER.info(f"Processing entity: {entity_id} from group '{group_name}'")
                
                # Check if entity has an active advance override
                if entity_id in self.override_until:
                    override_time = self.override_until[entity_id]
                    if dt_util.now() < override_time:
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
                                    event["cancelled_at"] = dt_util.now().isoformat()
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
                    
                target_temp = active_node.get("temp")
                _LOGGER.info(f"{entity_id} active node: {active_node}")
                
                # Clamp target temp to global min/max BEFORE creating signature
                # This prevents infinite update loops where unclamped signature differs from clamped output
                # Handle NO_CHANGE temperature (noChange flag)
                is_no_change = active_node.get("noChange", False)
                if is_no_change:
                    clamped_temp = None
                    _LOGGER.info(f"{entity_id} temp set to NO_CHANGE - will not modify temperature")
                else:
                    clamped_temp = target_temp
                    if target_temp is not None:
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
                
                # Get the node time to detect time-based transitions
                node_time = active_node.get("time")
                last_node_time = self.last_node_times.get(entity_id)
                
                # Check if we've transitioned to a new node (either state changed OR time changed)
                last_node = self.last_node_states.get(entity_id)
                node_time_changed = last_node_time != node_time
                node_state_changed = last_node != node_signature
                
                if last_node == node_signature and not node_time_changed:
                    # Still on same node with same time, don't override manual changes
                    _LOGGER.debug(f"{entity_id} still on same node (time: {node_time}), skipping")
                    results[entity_id] = {
                        "updated": False,
                        "target_temp": target_temp,
                        "reason": "same_node"
                    }
                    continue
                
                # Node has changed (state or time), update the temperature and settings
                if node_time_changed and not node_state_changed:
                    _LOGGER.info(f"{entity_id} node time changed ({last_node_time} -> {node_time}), reapplying same settings")
                elif node_state_changed:
                    _LOGGER.info(f"{entity_id} node state changed: {last_node} -> {node_signature}")
                else:
                    _LOGGER.info(f"{entity_id} node changed")
                    
                self.last_node_states[entity_id] = node_signature
                self.last_node_times[entity_id] = node_time
                
                # Re-get current state (we checked it exists earlier)
                _LOGGER.info(f"{entity_id} state found: {state.state}")
                # Get current target temperature
                current_target = state.attributes.get("temperature")
                _LOGGER.info(f"{entity_id} current target: {current_target}°C")
                
                # Check if this is a preset-only entity (no current_temperature sensor)
                current_temperature = state.attributes.get("current_temperature")
                is_preset_only = current_temperature is None
                if is_preset_only:
                    _LOGGER.info(f"{entity_id} is preset-only (no current_temperature), will skip temperature changes")
                
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
                    # Only set temperature if not NO_CHANGE and entity supports temperature
                    if clamped_temp is not None and not is_preset_only:
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
                    elif clamped_temp is not None and is_preset_only:
                        _LOGGER.info(f"Skipping temperature change for {entity_id} (preset-only entity)")
                    else:
                        _LOGGER.info(f"Skipping temperature change for {entity_id} (NO_CHANGE set)")
                    
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
                
                # Fire event for scheduled node activation ONLY if node actually changed
                if node_time_changed or node_state_changed:
                    # Get all entities in the group for event data
                    all_groups = await self.storage.async_get_groups()
                    group_entities = all_groups.get(group_name, {}).get("entities", [])
                    
                    self.hass.bus.async_fire(
                        f"{DOMAIN}_node_activated",
                        {
                            # TODO: Remove entity_id in future version - deprecated in favor of entities list
                            "entity_id": entity_id,
                            "entities": group_entities,  # All entities in the group
                            "group_name": group_name,
                            "node": {
                                "time": active_node.get("time"),
                                "temp": clamped_temp,
                                "hvac_mode": active_node.get("hvac_mode"),
                                "fan_mode": active_node.get("fan_mode"),
                                "swing_mode": active_node.get("swing_mode"),
                                "preset_mode": active_node.get("preset_mode"),
                                "A": active_node.get("A"),
                                "B": active_node.get("B"),
                                "C": active_node.get("C"),
                            },
                            "previous_node": last_node,
                            "day": current_day,
                            "trigger_type": "scheduled",
                        }
                    )
                    _LOGGER.info(f"Fired node_activated event for {entity_id} (scheduled transition)")
                else:
                    _LOGGER.debug(f"Skipping event for {entity_id} - no node transition detected")
                
                results[entity_id] = {
                    "updated": True,
                    "target_temp": target_temp,
                    "previous_temp": current_target,
                }
            
            return results
            
        except Exception as err:
            _LOGGER.error(f"Error updating heating schedules: {err}")
            raise UpdateFailed(f"Error updating heating schedules: {err}")
