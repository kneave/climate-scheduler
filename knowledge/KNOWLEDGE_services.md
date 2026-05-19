# KNOWLEDGE: services.py

## Purpose
This module defines and registers all Home Assistant services for the Climate Scheduler integration. It provides the service definitions (with dynamic selectors populated at setup time), voluptuous validation schemas, and handler functions for ~30 services covering schedule CRUD, group management, profile management, advance/skip scheduling, entity cleanup, diagnostics, card registration, factory reset, and settings. It acts as the sole bridge between HA's service call mechanism and the integration's internal `ScheduleStorage` and `HeatingSchedulerCoordinator`.

## Key Functions (alphabetical)

### _advance_target(line 1045)
- **Signature**: `async def _advance_target(target_id: str) -> None`
- **Contract**: If `target_id` matches a stored group name, delegates to `coordinator.async_advance_group(target_id)`. Otherwise treats `target_id` as a single climate entity ID and calls `coordinator.async_advance_schedule(target_id)`.
- **Mutates**: Coordinator advance state (via coordinator methods)
- **Calls**: `storage.async_get_group`, `coordinator.async_advance_group`, `coordinator.async_advance_schedule`
- **Called by**: `handle_advance_schedule` (line 1277), `handle_advance_group` (line 1282)
- **Edge cases**: If `target_id` is a group name that also looks like an entity ID (e.g. `climate.living_room`), group match takes precedence because `async_get_group` is checked first.
- **Test coverage**: Partially tested — group path and entity path need separate test coverage

### _disable_target(line 1026)
- **Signature**: `async def _disable_target(target_id: str) -> None`
- **Contract**: If `target_id` is a group name, disables all member entities via `storage.async_set_enabled(entity_id, False)` for each. Otherwise disables single entity. Does NOT call `coordinator.async_request_refresh()` — caller must trigger refresh separately if needed.
- **Mutates**: Storage enabled flags for each entity in group or the single entity
- **Calls**: `storage.async_get_group`, `storage.async_set_enabled`
- **Called by**: `handle_disable_schedule` (line 1068), `handle_disable_group` (line 1216)
- **Edge cases**: No coordinator refresh is triggered, unlike `_enable_target`. This is an asymmetry — enable refreshes, disable does not. Also, no `last_node_states` cleanup on disable.
- **Test coverage**: Untested asymmetry vs _enable_target

### _enable_target(line 998)
- **Signature**: `async def _enable_target(target_id: str) -> None`
- **Contract**: If `target_id` is a group name, enables all member entities via `storage.async_set_enabled(entity_id, True)` for each, clears their `last_node_states`, and refreshes the coordinator. Otherwise enables a single entity, clears its `last_node_states`, and refreshes.
- **Mutates**: Storage enabled flags, coordinator.last_node_states (entries deleted), triggers coordinator refresh
- **Calls**: `storage.async_get_group`, `storage.async_set_enabled`, `coordinator.async_request_refresh`
- **Called by**: `handle_enable_schedule` (line 1063), `handle_enable_group` (line 1205)
- **Edge cases**: Group path clears `last_node_states` for each entity but calls `async_request_refresh` only once after loop. Single-entity path also clears and refreshes.
- **Test coverage**: Partially tested

### async_get_services(line 21)
- **Signature**: `async def async_get_services(hass: HomeAssistant) -> dict[str, Any]`
- **Contract**: Returns a dict of service definitions with runtime-populated selectors (group names, profile options). Called by HA to discover dynamic service metadata. Does NOT register services — only defines their metadata/fields/selectors.
- **Mutates**: None
- **Calls**: `storage.async_get_groups`, `storage.async_get_global_profiles`
- **Called by**: HA framework (service definition discovery)
- **Edge cases**: Group names are filtered to exclude `__entity_` prefixed and `_is_single_entity_group` groups. If no groups/profiles exist, selectors fall back to plain text at registration time (line 942-949).
- **Test coverage**: Untested

### async_setup_services(line 597)
- **Signature**: `async def async_setup_services(hass: HomeAssistant) -> None`
- **Contract**: Registers all Climate Scheduler services with HA. Defines voluptuous validation schemas, builds dynamic selectors, creates all handler closures (capturing `storage` and `coordinator` from `hass.data`), and registers each service via `hass.services.async_register`. Returns None.
- **Mutates**: HA service registry (registers ~30 services)
- **Calls**: `storage.async_get_groups`, `storage.async_get_global_profiles`, `hass.services.async_register` (×30)
- **Called by**: Integration setup (__init__.py)
- **Edge cases**: Schema for `cleanup_orphaned_climate_entities` is defined (line 603) but the service is registered (line 1868) yet has no handler defined in `async_get_services` metadata. The `reregister_card` schema (line 656-659) is defined but not present in `async_get_services` return dict — it won't appear in UI service picker.
- **Test coverage**: Partially tested

### handle_add_to_group(line 1107)
- **Signature**: `async def handle_add_to_group(call: ServiceCall) -> None`
- **Contract**: Adds a climate entity to a named group. Raises ValueError from storage if entity already in group.
- **Mutates**: Storage group membership
- **Calls**: `storage.async_add_entity_to_group`
- **Called by**: HA service `add_to_group`
- **Edge cases**: ValueError from storage is re-raised (not caught into a response)
- **Test coverage**: Partially tested

### handle_advance_group(line 1279)
- **Signature**: `async def handle_advance_group(call: ServiceCall) -> None`
- **Contract**: Advances all entities in a group to next scheduled node. Delegates to `_advance_target`.
- **Mutates**: Coordinator advance state
- **Calls**: `_advance_target`
- **Called by**: HA service `advance_group`
- **Edge cases**: Same group-vs-entity ambiguity as `_advance_target`
- **Test coverage**: Untested

### handle_advance_schedule(line 1274)
- **Signature**: `async def handle_advance_schedule(call: ServiceCall) -> None`
- **Contract**: Advances a single entity to its next scheduled node. Delegates to `_advance_target`.
- **Mutates**: Coordinator advance state
- **Calls**: `_advance_target`
- **Called by**: HA service `advance_schedule`
- **Edge cases**: If schedule_id happens to match a group name, will advance the group instead
- **Test coverage**: Partially tested

### handle_cancel_advance(line 1284)
- **Signature**: `async def handle_cancel_advance(call: ServiceCall) -> None`
- **Contract**: Cancels an active advance override on an entity, returning it to scheduled settings.
- **Mutates**: Coordinator advance state
- **Calls**: `coordinator.async_cancel_advance`
- **Called by**: HA service `cancel_advance`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_clear_advance_history(line 1405)
- **Signature**: `async def handle_clear_advance_history(call: ServiceCall) -> None`
- **Contract**: Clears all advance history markers for a climate entity.
- **Mutates**: Coordinator advance history
- **Calls**: `coordinator.clear_advance_history`
- **Called by**: HA service `clear_advance_history`
- **Edge cases**: None
- **Test coverage**: Untested

### handle_clear_schedule(line 992)
- **Signature**: `async def handle_clear_schedule(call: ServiceCall) -> None`
- **Contract**: Removes the schedule for a climate entity by setting nodes to empty list `[]`. Triggers coordinator refresh.
- **Mutates**: Storage schedule data, triggers coordinator refresh
- **Calls**: `storage.async_set_schedule(entity_id, [])`, `coordinator.async_request_refresh`
- **Called by**: HA service `clear_schedule`
- **Edge cases**: Line 995: Uses `async_set_schedule(entity_id, [])` because `async_clear_schedule` does not exist on `ScheduleStorage`. This is a partial fix — the original code called a nonexistent method. Does NOT clear `last_node_states` for the entity before refresh, unlike `handle_set_schedule`.
- **Test coverage**: Tested (partial — missing last_node_states invalidation)

### handle_cleanup_derivative_sensors(line 1484)
- **Signature**: `async def handle_cleanup_derivative_sensors(call: ServiceCall) -> dict`
- **Contract**: Removes orphaned derivative sensors. If `confirm_delete_all=True`, deletes all derivative sensors. Returns a result dict from storage.
- **Mutates**: Entity registry (if confirm_delete_all), storage derivative sensor data
- **Calls**: `storage.async_cleanup_derivative_sensors`
- **Called by**: HA service `cleanup_derivative_sensors`
- **Edge cases**: Delegates entirely to storage — no local validation
- **Test coverage**: Partially tested

### handle_cleanup_malformed_sensors(line 693)
- **Signature**: `async def handle_cleanup_malformed_sensors(call: ServiceCall) -> dict`
- **Contract**: Scans for unexpected Climate Scheduler sensor entities. If `delete=True`, removes them from entity registry. Returns expected and unexpected entity lists. Dry-run by default.
- **Mutates**: Entity registry (only if delete=True)
- **Calls**: `storage.async_get_groups`, entity_registry operations
- **Called by**: HA service `cleanup_malformed_sensors`
- **Edge cases**: Derivative sensor detection (lines 720-754) uses complex heuristic: checks if `create_derivative_sensors` setting is True, then for each climate entity, looks for `_rate` sensors and floor-temperature sensors on the same device. Floor sensor matching by entity name prefix (line 747-750) tries to avoid duplicated segments but the logic is fragile. Also accesses `storage._data` directly (line 720) instead of using a public API.
- **Test coverage**: Untested

### handle_cleanup_orphaned_climate_entities(line 798)
- **Signature**: `async def handle_cleanup_orphaned_climate_entities(call: ServiceCall) -> dict`
- **Contract**: Identifies and optionally removes orphaned entities (entities in the HA registry that have no matching group/entity in storage). Dry-run by default.
- **Mutates**: Entity registry (only if delete=True)
- **Calls**: `storage.async_get_groups`, entity_registry operations
- **Called by**: HA service `cleanup_orphaned_climate_entities`
- **Edge cases**: Uses MD5 hash of group name (line 843) to compute expected switch unique IDs, matching the logic in sensor entity creation. Accesses `storage._data` directly (line 816). Floor sensor matching uses `"floor" in e.entity_id.lower()` (line 865) which may match unintended entities.
- **Test coverage**: Untested

### handle_cleanup_unmonitored_storage(line 1490)
- **Signature**: `async def handle_cleanup_unmonitored_storage(call: ServiceCall) -> dict`
- **Contract**: Removes stale schedules/profiles/entity references for unmonitored or missing entities from storage. If `delete=True`, also clears coordinator state and refreshes.
- **Mutates**: Storage data, coordinator.last_node_states (if delete=True)
- **Calls**: `storage.async_cleanup_unmonitored_storage`, `coordinator.async_request_refresh` (if delete=True)
- **Called by**: HA service `cleanup_unmonitored_storage`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_create_group(line 1076)
- **Signature**: `async def handle_create_group(call: ServiceCall) -> None`
- **Contract**: Creates a new thermostat group. Re-raises ValueError from storage (e.g. if group name already exists).
- **Mutates**: Storage groups
- **Calls**: `storage.async_create_group`
- **Called by**: HA service `create_group`
- **Edge cases**: ValueError propagated to caller
- **Test coverage**: Partially tested

### handle_create_profile(line 1411)
- **Signature**: `async def handle_create_profile(call: ServiceCall) -> None`
- **Contract**: Creates a new schedule profile for an entity or group. Re-raises ValueError.
- **Mutates**: Storage profile data
- **Calls**: `storage.async_create_profile`
- **Called by**: HA service `create_profile`
- **Edge cases**: `schedule_id` can be either an entity ID or a group name — storage handles the dispatch
- **Test coverage**: Partially tested

### handle_delete_group(line 1086)
- **Signature**: `async def handle_delete_group(call: ServiceCall) -> None`
- **Contract**: Deletes a thermostat group. Re-raises ValueError from storage.
- **Mutates**: Storage groups
- **Calls**: `storage.async_delete_group`
- **Called by**: HA service `delete_group`
- **Edge cases**: ValueError propagated
- **Test coverage**: Partially tested

### handle_delete_profile(line 1422)
- **Signature**: `async def handle_delete_profile(call: ServiceCall) -> None`
- **Contract**: Deletes a schedule profile. Re-raises ValueError.
- **Mutates**: Storage profile data
- **Calls**: `storage.async_delete_profile`
- **Called by**: HA service `delete_profile`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_diagnostics(line 1628)
- **Signature**: `async def handle_diagnostics(call: ServiceCall) -> dict`
- **Contract**: Runs comprehensive diagnostics returning integration version, card registration status, card accessibility (HTTP fetch with 5s timeout), storage data summary, climate entity registry dump with states, and device registry dump. Always returns a dict (never raises).
- **Mutates**: None
- **Calls**: `storage.async_get_groups`, entity_registry, device_registry, aiohttp (for card accessibility check)
- **Called by**: HA service `diagnostics`
- **Edge cases**: Creates an `aiohttp.ClientSession` without using `hass.helpers.aiohttp_client` — potentially leaks session or conflicts with HA's session management (lines 1729-1754). The accessibility check hits the server's own HTTP endpoint which may fail in some HA deployments. HA version detection (line 1557-1558) uses `major * 1000 + minor` math which could break for future versions.
- **Test coverage**: Untested

### handle_disable_group(line 1210)
- **Signature**: `async def handle_disable_group(call: ServiceCall) -> None`
- **Contract**: Disables automatic scheduling for all thermostats in a group. Delegates to `_disable_target`.
- **Mutates**: Storage enabled flags
- **Calls**: `_disable_target`
- **Called by**: HA service `disable_group`
- **Edge cases**: See `_disable_target` — no coordinator refresh triggered
- **Test coverage**: Partially tested

### handle_disable_schedule(line 1065)
- **Signature**: `async def handle_disable_schedule(call: ServiceCall) -> None`
- **Contract**: Disables automatic scheduling for an entity or group. Delegates to `_disable_target`.
- **Mutates**: Storage enabled flags
- **Calls**: `_disable_target`
- **Called by**: HA service `disable_schedule`
- **Edge cases**: See `_disable_target` — no coordinator refresh triggered
- **Test coverage**: Partially tested

### handle_enable_group(line 1199)
- **Signature**: `async def handle_enable_group(call: ServiceCall) -> None`
- **Contract**: Enables automatic scheduling for all thermostats in a group. Delegates to `_enable_target`.
- **Mutates**: Storage enabled flags, coordinator.last_node_states, triggers refresh
- **Calls**: `_enable_target`
- **Called by**: HA service `enable_group`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_enable_schedule(line 1060)
- **Signature**: `async def handle_enable_schedule(call: ServiceCall) -> None`
- **Contract**: Enables automatic scheduling for an entity or group. Delegates to `_enable_target`.
- **Mutates**: Storage enabled flags, coordinator.last_node_states, triggers refresh
- **Calls**: `_enable_target`
- **Called by**: HA service `enable_schedule`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_factory_reset(line 1501)
- **Signature**: `async def handle_factory_reset(call: ServiceCall) -> None`
- **Contract**: Resets ALL Climate Scheduler data if `confirm=True`. Clears coordinator state, calls `storage.async_factory_reset()`, and refreshes coordinator. Raises ValueError if not confirmed.
- **Mutates**: All storage data, coordinator.last_node_states
- **Calls**: `storage.async_factory_reset`, `coordinator.async_request_refresh`
- **Called by**: HA service `factory_reset`
- **Edge cases**: Destructive and irreversible. No entity registry cleanup — sensor/switch entities will remain orphaned in HA until manually removed or integration reload.
- **Test coverage**: Partially tested

### handle_get_advance_status(line 1290)
- **Signature**: `async def handle_get_advance_status(call: ServiceCall) -> dict`
- **Contract**: Returns advance status for an entity including `is_active`, `history`, and legacy fields (`is_advanced`, `advance_time`, `original_node`, `advanced_node`).
- **Mutates**: None
- **Calls**: `coordinator.async_get_advance_status`, `coordinator.get_advance_history`
- **Called by**: HA service `get_advance_status`
- **Edge cases**: `get_advance_history` is a sync method (not async) on coordinator. The `is_active` key is derived from `status.get("is_advanced")`, not from a dedicated field.
- **Test coverage**: Partially tested

### handle_get_groups(line 1125)
- **Signature**: `async def handle_get_groups(call: ServiceCall) -> dict`
- **Contract**: Returns all groups including internal `__entity_` groups.
- **Mutates**: None
- **Calls**: `storage.async_get_groups`
- **Called by**: HA service `get_groups`
- **Edge cases**: Returns raw groups dict — includes internal single-entity groups unlike `list_groups`
- **Test coverage**: Tested

### handle_get_profiles(line 1474)
- **Signature**: `async def handle_get_profiles(call: ServiceCall) -> dict`
- **Contract**: Returns profiles and active profile name for a target (entity or group).
- **Mutates**: None
- **Calls**: `storage.async_get_profiles`, `storage.async_get_active_profile_name`
- **Called by**: HA service `get_profiles`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_get_schedule(line 970)
- **Signature**: `async def handle_get_schedule(call: ServiceCall) -> dict`
- **Contract**: Returns schedule data for a climate entity: schedules dict, schedule_mode, enabled flag, profiles, active_profile. If no schedule exists, returns `{"schedule": None, "enabled": False}`.
- **Mutates**: None
- **Calls**: `storage.async_get_schedule`
- **Called by**: HA service `get_schedule`
- **Edge cases**: The "no schedule" response shape (`{"schedule": None, "enabled": False}`) differs from the "has schedule" response shape (`{"schedules": ..., "schedule_mode": ...}`) — the key is `schedule` (singular) vs `schedules` (plural). This inconsistency may confuse API consumers.
- **Test coverage**: Partially tested

### handle_get_settings(line 1221)
- **Signature**: `async def handle_get_settings(call: ServiceCall) -> dict`
- **Contract**: Returns global settings plus version info (integration version from manifest, HA version).
- **Mutates**: None
- **Calls**: `storage.async_get_settings`, `homeassistant.loader.async_get_integration`
- **Called by**: HA service `get_settings`
- **Edge cases**: Version retrieval can silently fail (except clause on line 1234 returns "unknown"). Imports `homeassistant.const.__version__` inside the handler.
- **Test coverage**: Tested

### handle_list_groups(line 1130)
- **Signature**: `async def handle_list_groups(call: ServiceCall) -> dict`
- **Contract**: Returns a simple list of group names, excluding `__entity_` prefixed groups and `_is_single_entity_group` groups. Intended for populating UI selectors.
- **Mutates**: None
- **Calls**: `storage.async_get_groups`
- **Called by**: HA service `list_groups`
- **Edge cases**: Same filtering logic as in `async_get_services` — duplicated
- **Test coverage**: Tested

### handle_list_profiles(line 1140)
- **Signature**: `async def handle_list_profiles(call: ServiceCall) -> dict`
- **Contract**: Returns all global profiles as `{value, label}` dicts for populating selectors.
- **Mutates**: None
- **Calls**: `storage.async_get_global_profiles`
- **Called by**: HA service `list_profiles`
- **Edge cases**: None
- **Test coverage**: Tested

### handle_recreate_all_sensors(line 663)
- **Signature**: `async def handle_recreate_all_sensors(call: ServiceCall) -> dict`
- **Contract**: Deletes ALL Climate Scheduler sensor entities from the entity registry and reloads the integration. Requires `confirm=True`. Returns deleted count and any errors.
- **Mutates**: Entity registry, triggers config entry reload
- **Calls**: `entity_registry.async_remove`, `hass.config_entries.async_reload`
- **Called by**: HA service `recreate_all_sensors`
- **Edge cases**: Deletes ONLY sensor entities (`e.domain == "sensor"` and `e.platform == DOMAIN`), not switch or climate entities. Integration reload may be slow. Errors during deletion are collected but not thrown.
- **Test coverage**: Partially tested

### handle_reload_integration(line 1266)
- **Signature**: `async def handle_reload_integration(call: ServiceCall) -> None`
- **Contract**: Reloads all Climate Scheduler config entries.
- **Mutates**: HA config entry state
- **Calls**: `hass.config_entries.async_reload`
- **Called by**: HA service `reload_integration`
- **Edge cases**: If multiple config entries exist, reloads all. No confirmation required.
- **Test coverage**: Tested

### handle_remove_from_group(line 1118)
- **Signature**: `async def handle_remove_from_group(call: ServiceCall) -> None`
- **Contract**: Removes a climate entity from a group. Does not re-raise exceptions (unlike add_to_group).
- **Mutates**: Storage group membership
- **Calls**: `storage.async_remove_entity_from_group`
- **Called by**: HA service `remove_from_group`
- **Edge cases**: Inconsistent error handling relative to `handle_add_to_group` — no try/except here
- **Test coverage**: Partially tested

### handle_rename_group(line 1096)
- **Signature**: `async def handle_rename_group(call: ServiceCall) -> None`
- **Contract**: Renames a thermostat group. Re-raises ValueError.
- **Mutates**: Storage groups
- **Calls**: `storage.async_rename_group`
- **Called by**: HA service `rename_group`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_rename_profile(line 1433)
- **Signature**: `async def handle_rename_profile(call: ServiceCall) -> None`
- **Contract**: Renames a schedule profile. Re-raises ValueError.
- **Mutates**: Storage profile data
- **Calls**: `storage.async_rename_profile`
- **Called by**: HA service `rename_profile`
- **Edge cases**: None
- **Test coverage**: Partially tested

### handle_reregister_card(line 1521)
- **Signature**: `async def handle_reregister_card(call: ServiceCall) -> dict`
- **Contract**: Deletes any existing Lovelace resource entries for the Climate Scheduler card and re-registers it. Auto-generates URL from manifest version if not provided. Handles YAML mode gracefully (returns instructions). Returns removed/added resource info.
- **Mutates**: Lovelace resources
- **Calls**: `resources.async_delete_item`, `resources.async_create_item`, `resources.async_update_item`, `resources.async_load`
- **Called by**: HA service `reregister_card`
- **Edge cases**: HA version detection (line 1557-1558) uses `major*1000 + minor` (e.g. 2025.2 → 2025002) which could overflow or mis-parse. If `lovelace_data` is None, raises RuntimeError. If resources are in YAML mode, returns instruction dict instead of error. `existing_entry` logic (lines 1594-1603) sets `existing_entry` on base-url match but continues loop — if multiple entries match, last one wins. Schema defined (line 656) but NOT in `async_get_services` metadata — won't appear in UI.
- **Test coverage**: Untested

### handle_save_settings(line 1245)
- **Signature**: `async def handle_save_settings(call: ServiceCall) -> None`
- **Contract**: Saves global integration settings. Accepts settings as JSON string. Defensive: if the payload looks like `{settings: {...}, version: {...}}`, extracts the inner `settings` dict.
- **Mutates**: Storage settings
- **Calls**: `storage.async_save_settings`
- **Called by**: HA service `save_settings`
- **Edge cases**: JSON parsing on line 1249 uses `json.loads` without try/except — malformed JSON will raise unhandled exception. The defensive extraction (line 1253) checks for nested `settings` key AND `version` key both existing.
- **Test coverage**: Partially tested

### handle_set_active_profile(line 1445)
- **Signature**: `async def handle_set_active_profile(call: ServiceCall) -> None`
- **Contract**: Switches to a different schedule profile, fires `climate_scheduler_profile_changed` event, clears `last_node_states` for all entities in the target group, and triggers coordinator refresh.
- **Mutates**: Storage active profile, coordinator.last_node_states, fires HA event
- **Calls**: `storage.async_set_active_profile`, `hass.bus.async_fire`, `storage.async_get_groups`, `coordinator.async_request_refresh`
- **Called by**: HA service `set_active_profile`
- **Edge cases**: If `target_id` is an entity ID (not a group name), `target_id in group_data` on line 1464 won't match, so `last_node_states` won't be cleared. This is a bug for entity-level profile switching.
- **Test coverage**: Partially tested

### handle_set_group_schedule(line 1153)
- **Signature**: `async def handle_set_group_schedule(call: ServiceCall) -> None`
- **Contract**: Sets schedule for all thermostats in a group. Accepts optional `profile_name`. Clears `last_node_states` for group members and triggers coordinator refresh. Re-raises ValueError and generic Exception from storage.
- **Mutates**: Storage schedule data, coordinator.last_node_states, triggers refresh
- **Calls**: `storage.async_set_group_schedule`, `storage.async_get_groups`, `coordinator.async_request_refresh`
- **Called by**: HA service `set_group_schedule`
- **Edge cases**: Debug logging (lines 1160-1167) is verbose. The `len(nodes)` on line 1163 will crash with TypeError if `nodes` is a JSON string (not yet parsed) at this point — but storage handles parsing internally.
- **Test coverage**: Partially tested

### handle_set_ignored(line 1259)
- **Signature**: `async def handle_set_ignored(call: ServiceCall) -> None`
- **Contract**: Marks an entity as ignored (not monitored) or un-ignores it.
- **Mutates**: Storage ignored flag
- **Calls**: `storage.async_set_ignored`
- **Called by**: HA service `set_ignored`
- **Edge cases**: No coordinator refresh after changing ignored status — changes may not take effect until next scheduled refresh
- **Test coverage**: Partially tested

### handle_set_schedule(line 956)
- **Signature**: `async def handle_set_schedule(call: ServiceCall) -> None`
- **Contract**: Sets schedule for a climate entity. Clears `last_node_states` for that entity and triggers coordinator refresh.
- **Mutates**: Storage schedule data, coordinator.last_node_states, triggers refresh
- **Calls**: `storage.async_set_schedule`, `coordinator.async_request_refresh`
- **Called by**: HA service `set_schedule`
- **Edge cases**: `day` and `schedule_mode` come from `call.data.get(...)` and may be None — storage must handle None defaults.
- **Test coverage**: Tested

### handle_sync_all(line 1070)
- **Signature**: `async def handle_sync_all(call: ServiceCall) -> None`
- **Contract**: Forces synchronization of all enabled thermostats with their schedules by clearing ALL `last_node_states` and triggering a coordinator refresh.
- **Mutates**: coordinator.last_node_states (fully cleared)
- **Calls**: `coordinator.async_request_refresh`
- **Called by**: HA service `sync_all`
- **Edge cases**: Clears ALL state — this forces every monitored entity to be re-evaluated, which could cause a burst of climate service calls
- **Test coverage**: Tested

### handle_test_fire_event(line 1310)
- **Signature**: `async def handle_test_fire_event(call: ServiceCall) -> None`
- **Contract**: Fires a `climate_scheduler_node_activated` event without applying settings. For testing automations. Accepts optional `node` (JSON string) and `day`. If entity not found in any group, logs error and returns silently.
- **Mutates**: Fires HA bus event
- **Calls**: `storage.async_get_groups`, `hass.bus.async_fire`
- **Called by**: HA service `test_fire_event`
- **Edge cases**: Node data is parsed from JSON string if string. If no day provided, uses current weekday. Only looks in groups for entity — standalone entities not in groups will fail. The TODO comment (line 1344) indicates `entity_id` field is deprecated in favor of `entities` list. When a group has exactly 1 entity, the legacy `entity_id` field is populated; otherwise it's None. The event always includes all entities in the group, not just the targeted entity.
- **Test coverage**: Untested

## Invariants

### Proven
1. All service handlers are registered exactly once in `async_setup_services` (lines 1866-1907).
2. Services requiring confirmation (`recreate_all_sensors`, `factory_reset`) raise ValueError if not confirmed.
3. Cleanup services default to dry-run (`delete=False` / `confirm_delete_all=False`).
4. `_enable_target` always triggers a coordinator refresh; `_disable_target` does NOT — this asymmetry is by inspection.
5. Group names in `async_get_services` and `handle_list_groups` are always filtered to exclude `__entity_` prefix and `_is_single_entity_group=True`.

### Assumed
1. `hass.data[DOMAIN]["storage"]` and `hass.data[DOMAIN]["coordinator"]` are populated before `async_setup_services` is called.
2. `storage.async_get_groups()` returns a dict keyed by group name.
3. `storage.async_get_group(name)` returns `None` if group does not exist (used as group-vs-entity discriminator).
4. Registered HA services persist until integration unload (no explicit unregistration).

## Contract Connections

- **C-SCHEDULE-CRUD**: `handle_set_schedule` / `handle_get_schedule` / `handle_clear_schedule` implement the schedule CRUD contract. `clear_schedule` uses `async_set_schedule(entity_id, [])` instead of a dedicated `async_clear_schedule` (which doesn't exist).
- **C-GROUP-MANAGEMENT**: `handle_create_group`, `handle_delete_group`, `handle_rename_group`, `handle_add_to_group`, `handle_remove_from_group` implement group CRUD. All delegate to storage and re-raise ValueError.
- **C-ENABLE-DISABLE**: `handle_enable_schedule`/`handle_disable_schedule` and `handle_enable_group`/`handle_disable_group` all go through `_enable_target`/`_disable_target`. Asymmetric refresh behavior (enable refreshes, disable does not).
- **C-ADVANCE**: Advance/skip schedule contract is handled by `_advance_target` → coordinator, and `cancel_advance` → coordinator.
- **C-PROFILE**: Profile CRUD (create, delete, rename, set_active, get) delegates entirely to storage. `set_active_profile` additionally fires event and refreshes coordinator.
- **C-SETTINGS**: `handle_save_settings` includes defensive unwrapping for clients that send the full `get_settings` payload.

## Known Bugs / Gaps

1. **Line 995**: `async_clear_schedule(entity_id)` — this method does NOT exist on `storage.py`. Replaced with `async_set_schedule(entity_id, [])` as a partial fix. Missing `last_node_states` invalidation before refresh (unlike `handle_set_schedule`).

2. **Mixed schedule_id semantics**: The `schedule_id` parameter means different things in different services:
   - For `set_schedule`/`get_schedule`/`clear_schedule`: always a climate entity ID
   - For `enable_schedule`/`disable_schedule`: can be entity ID OR group name (resolved at runtime by checking storage)
   - For `create_group`/`delete_group`/`add_to_group`/`remove_from_group`/`set_group_schedule`/`enable_group`/`disable_group`: always a group name
   - For `create_profile`/`delete_profile`/`rename_profile`/`set_active_profile`/`get_profiles`: can be entity ID OR group name
   - For `advance_schedule`/`advance_group`/`cancel_advance`/`clear_advance_history`/`get_advance_status`: entity ID or group name depending on service
   This overloading causes ambiguity when a group name coincidentally looks like an entity ID.

3. **_disable_target doesn't refresh coordinator** (line 1026-1043): After disabling entities, no `coordinator.async_request_refresh()` is called. Disabled entities may continue to show stale state until the next scheduled coordinator tick.

4. **handle_set_active_profile entity-level bug** (line 1464): When `target_id` is an entity ID, `target_id in group_data` won't match any key (since keys are group names), so `last_node_states` won't be cleared. The profile change will take effect in storage but the coordinator won't re-evaluate the entity immediately.

5. **handle_save_settings no JSON error handling** (line 1249): `json.loads(settings_json)` with no try/except. Malformed JSON causes unhandled exception.

6. **handle_diagnostics session leak** (lines 1729-1754): Creates `aiohttp.ClientSession()` directly instead of using HA's managed session (`aiohttp_client.async_get_clientsession(hass)`). The session is closed in a `finally` block, but this bypasses HA's connection pooling.

7. **handle_reregister_card not in async_get_services**: The `reregister_card` service schema is defined (line 656) and registered (line 1906), but its metadata is not in the `async_get_services` return dict, so it won't appear in the HA UI service picker.

8. **handle_cleanup_orphaned_climate_entities not in async_get_services**: Similarly registered (line 1868) but not in `async_get_services` metadata.

9. **HA version math overflow risk** (line 1557-1558): `version_parts[0] * 1000 + version_parts[1]` works for current HA versions (e.g., 2025.2 → 2025002) but could produce unexpected results if major version format changes.

10. **Inconsistent error handling**: `handle_add_to_group` wraps in try/except and re-raises ValueError; `handle_remove_from_group` does NOT wrap in try/except at all. `handle_set_group_schedule` catches both ValueError and generic Exception.

11. **get_schedule response shape inconsistency** (lines 975-990): When no schedule exists, response is `{"schedule": None, "enabled": False}` (singular `schedule`). When schedule exists, response uses `{"schedules": ..., "schedule_mode": ..., "enabled": ...}` (plural `schedules`).

12. **storage._data direct access** (lines 720, 816): `handle_cleanup_malformed_sensors` and `handle_cleanup_orphaned_climate_entities` access `storage._data` directly instead of using a public storage API method, breaking encapsulation.

## Cross-Module Dependencies

### Imports
- `homeassistant.core`: `HomeAssistant`, `ServiceCall`, `SupportsResponse`
- `homeassistant.config_entries`: `ConfigEntry`
- `homeassistant.helpers.selector`: `EntitySelector`, `EntitySelectorConfig`, `SelectSelector`, `SelectSelectorConfig`, `SelectSelectorMode`
- `homeassistant.util.json`: `json_util` (imported but never used)
- `voluptuous`: `vol` (validation schemas)
- `homeassistant.helpers.config_validation`: `cv` (coercion validators)
- `json` (stdlib, used locally in handlers)
- `pathlib.Path` (used in reregister_card and diagnostics)
- `.const`: `DOMAIN`
- `.coordinator`: `HeatingSchedulerCoordinator`
- `.storage`: `ScheduleStorage`

### Runtime dependencies on storage.py methods
- `storage.async_get_groups()`, `storage.async_get_group()`, `storage.async_get_global_profiles()`
- `storage.async_set_schedule()`, `storage.async_get_schedule()`
- `storage.async_set_enabled()`, `storage.async_set_ignored()`
- `storage.async_create_group()`, `storage.async_delete_group()`, `storage.async_rename_group()`
- `storage.async_add_entity_to_group()`, `storage.async_remove_entity_from_group()`
- `storage.async_set_group_schedule()`
- `storage.async_get_settings()`, `storage.async_save_settings()`
- `storage.async_create_profile()`, `storage.async_delete_profile()`, `storage.async_rename_profile()`
- `storage.async_set_active_profile()`, `storage.async_get_profiles()`, `storage.async_get_active_profile_name()`
- `storage.async_cleanup_derivative_sensors()`, `storage.async_cleanup_unmonitored_storage()`
- `storage.async_factory_reset()`
- `storage._data` (direct private attribute access — two locations)

### Runtime dependencies on coordinator.py
- `coordinator.last_node_states` (dict, read/write — entries deleted for invalidation)
- `coordinator.async_request_refresh()`
- `coordinator.async_advance_schedule()`, `coordinator.async_advance_group()`
- `coordinator.async_cancel_advance()`
- `coordinator.async_get_advance_status()`, `coordinator.get_advance_history()`, `coordinator.clear_advance_history()`

## Service Registry

| Service Name | Schema Fields | SupportsResponse | Defined in async_get_services | Handler |
|---|---|---|---|---|
| `recreate_all_sensors` | confirm (req, bool) | ONLY | ✅ | handle_recreate_all_sensors |
| `cleanup_malformed_sensors` | delete (opt, bool, default=False) | ONLY | ✅ | handle_cleanup_malformed_sensors |
| `cleanup_orphaned_climate_entities` | delete (opt, bool, default=False) | ONLY | ❌ | handle_cleanup_orphaned_climate_entities |
| `set_schedule` | schedule_id (req, str), nodes (req, Any(str/list/dict)), day (opt, str, default="all_days"), schedule_mode (opt, str, default="all_days") | NONE | ✅ | handle_set_schedule |
| `get_schedule` | schedule_id (req, str) | ONLY | ✅ | handle_get_schedule |
| `clear_schedule` | schedule_id (req, str) | NONE | ✅ | handle_clear_schedule |
| `enable_schedule` | schedule_id (req, str) | NONE | ✅ | handle_enable_schedule |
| `disable_schedule` | schedule_id (req, str) | NONE | ✅ | handle_disable_schedule |
| `set_ignored` | schedule_id (req, str), ignored (req, bool) | NONE | ✅ | handle_set_ignored |
| `sync_all` | (none) | NONE | ✅ | handle_sync_all |
| `create_group` | schedule_id (req, str) | NONE | ✅ | handle_create_group |
| `delete_group` | schedule_id (req, str) | NONE | ✅ | handle_delete_group |
| `rename_group` | old_name (req, str), new_name (req, str) | NONE | ✅ | handle_rename_group |
| `add_to_group` | schedule_id (req, str), entity_id (req, str) | NONE | ✅ | handle_add_to_group |
| `remove_from_group` | schedule_id (req, str), entity_id (req, str) | NONE | ✅ | handle_remove_from_group |
| `get_groups` | (none) | ONLY | ✅ | handle_get_groups |
| `list_groups` | (none) | ONLY | ✅ | handle_list_groups |
| `list_profiles` | (none) | ONLY | ✅ | handle_list_profiles |
| `set_group_schedule` | schedule_id (req, str), nodes (req, Any), day (opt, str), schedule_mode (opt, str), profile_name (opt, str) | NONE | ✅ | handle_set_group_schedule |
| `enable_group` | schedule_id (req, str) | NONE | ✅ | handle_enable_group |
| `disable_group` | schedule_id (req, str) | NONE | ✅ | handle_disable_group |
| `get_settings` | (none) | ONLY | ✅ | handle_get_settings |
| `save_settings` | settings (req, str) | NONE | ✅ | handle_save_settings |
| `reload_integration` | (none) | NONE | ✅ | handle_reload_integration |
| `advance_schedule` | schedule_id (req, str) | NONE | ✅ | handle_advance_schedule |
| `advance_group` | schedule_id (req, str) | NONE | ✅ | handle_advance_group |
| `cancel_advance` | schedule_id (req, str) | NONE | ✅ | handle_cancel_advance |
| `get_advance_status` | schedule_id (req, str) | ONLY | ✅ | handle_get_advance_status |
| `clear_advance_history` | schedule_id (req, str) | NONE | ✅ | handle_clear_advance_history |
| `test_fire_event` | schedule_id (req, str), node (opt, str), day (opt, str) | NONE | ✅ | handle_test_fire_event |
| `create_profile` | schedule_id (req, str), profile_name (req, str) | NONE | ✅ | handle_create_profile |
| `delete_profile` | schedule_id (req, str), profile_name (req, str) | NONE | ✅ | handle_delete_profile |
| `rename_profile` | schedule_id (req, str), old_name (req, str), new_name (req, str) | NONE | ✅ | handle_rename_profile |
| `set_active_profile` | schedule_id (req, str), profile_name (req, str) | NONE | ✅ | handle_set_active_profile |
| `get_profiles` | schedule_id (req, str) | ONLY | ✅ | handle_get_profiles |
| `cleanup_derivative_sensors` | confirm_delete_all (opt, bool, default=False) | ONLY | ✅ | handle_cleanup_derivative_sensors |
| `cleanup_unmonitored_storage` | delete (opt, bool, default=False) | ONLY | ✅ | handle_cleanup_unmonitored_storage |
| `factory_reset` | confirm (req, bool) | NONE | ✅ | handle_factory_reset |
| `reregister_card` | resource_url (opt, str), resource_type (opt, str, default="module") | ONLY | ❌ | handle_reregister_card |
| `diagnostics` | (none) | ONLY | ✅ | handle_diagnostics |