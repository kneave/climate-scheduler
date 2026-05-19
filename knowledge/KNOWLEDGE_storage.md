# KNOWLEDGE: storage.py

## Purpose

`storage.py` is the persistence and data-model layer for the Climate Scheduler Home Assistant integration. It manages all CRUD operations for heating schedules, groups, profiles, settings, and advance history via HA's `Store` abstraction. It owns a multi-step migration pipeline (entities→day-schedules→profiles→groups→global-profiles→legacy-name-normalization) that runs on every load, and provides schedule resolution (step-function interpolation, cross-day lookahead) used by the coordinator and climate entity at runtime.

---

## Key Functions (alphabetical)

### _build_schedules_from_template(line 342)
- **Signature**: `_build_schedules_from_template(self, default_schedule: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]`
- **Contract**: Takes a validated list of default nodes; returns `{"all_days": <deep-copied nodes>}`. Always returns a dict with exactly one key.
- **Mutates**: None (pure function on self).
- **Calls**: `copy.deepcopy`
- **Called by**: `_ensure_global_profiles_initialized`, `async_set_ignored`
- **Edge cases**: Empty list input yields `{"all_days": []}`; no validation of the input nodes here (assumed pre-validated by caller).
- **Test coverage**: Indirectly tested via migration and profile init tests.

### _ensure_global_profiles_initialized(line 346)
- **Signature**: `_ensure_global_profiles_initialized(self) -> None`
- **Contract**: After call, `self._data["profiles"]` is a non-empty dict with at least a "Default" profile seeded from the configured or fallback default schedule.
- **Mutates**: `self._data["profiles"]` — creates and/or populates it.
- **Calls**: `_get_default_schedule_template`, `_build_schedules_from_template`
- **Called by**: `_sync_group_profile_views`, `async_load`, `_project_group_runtime_view`, `async_set_group_schedule`, `async_create_profile`, `async_delete_profile`, `async_rename_profile`, `async_set_active_profile`, `async_get_profiles`, `async_get_active_profile_name`, `async_get_global_profiles`
- **Edge cases**: If `self._data["profiles"]` exists but is not a dict (e.g., `None` or a list), it is silently replaced with `{}` — data loss. No logging on overwrite.
- **Test coverage**: Tested in migration tests and advanced storage tests.

### _find_single_entity_group(line 593)
- **Signature**: `_find_single_entity_group(self, entity_id: str) -> Optional[str]`
- **Contract**: Returns the group name for a single-entity group containing `entity_id`, or `None`. Checks old `__entity_{entity_id}` format first, then all groups with `_is_single_entity_group=True` and exactly one entity.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `async_get_schedule`, `async_set_schedule`, `async_remove_entity`, `async_set_ignored`
- **Edge cases**: If multiple single-entity groups contain the same entity_id (data corruption), returns the first found (old-format wins over friendly-name format). No dedup guard.
- **Test coverage**: Tested in test_storage_crud and test_migrations.

### _get_default_schedule_template(line 326)
- **Signature**: `_get_default_schedule_template(self) -> List[Dict[str, Any]]`
- **Contract**: Returns a validated list of default schedule nodes. Checks `settings.defaultSchedule` then `settings.default_schedule`; if either is a non-empty list, validates each node and returns valid ones. Falls back to `DEFAULT_SCHEDULE` from const.py.
- **Mutates**: None.
- **Calls**: `validate_node`, `copy.deepcopy`
- **Called by**: `_ensure_global_profiles_initialized`, `async_set_ignored`
- **Edge cases**: If configured default has some valid and some invalid nodes, only valid ones are returned (silent partial loss). If all configured nodes are invalid, falls back to `DEFAULT_SCHEDULE` (which is `[]`).
- **Test coverage**: Partially tested (no explicit test for partial-validity case).

### _get_nodes_for_day(line 659)
- **Signature**: `_get_nodes_for_day(self, entity_data: Dict[str, Any], day: str) -> List[Dict[str, Any]]`
- **Contract**: Given entity/group data and a day abbreviation, returns the schedule nodes for that day respecting `schedule_mode`. For `"all_days"` → `schedules.all_days`; `"5/2"` → maps `mon-fri`→`weekday`, `sat-sun`→`weekend`; `"individual"` → `schedules[day]`.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `async_get_schedule`
- **Edge cases**: Unrecognized `schedule_mode` returns `[]`. Day abbreviations not matching any known key also return `[]` silently. No validation that `schedules` dict has the expected keys.
- **Test coverage**: Tested in test_scheduling_logic.

### _migrate_entities_to_groups(line 270)
- **Signature**: `async _migrate_entities_to_groups(self) -> None`
- **Contract**: Migrates legacy `self._data["entities"]` dict into single-entity groups under `self._data["groups"]`. After migration, deletes `self._data["entities"]`. Each entity not already in a multi-entity group gets a group named `__entity_{entity_id}`.
- **Mutates**: `self._data["groups"]` (adds entries), `self._data["entities"]` (deleted after migration).
- **Calls**: `copy.deepcopy`, `async_save`
- **Called by**: `async_load`
- **Edge cases**: If entity already belongs to a multi-entity group, it is skipped. The `entities` key is deleted even if it was empty-but-truthy (line 312: checks `self._data["entities"]` truthiness, not `self._data.get("entities")` — a `{}` dict is falsy so won't trigger deletion). Uses `list()` to iterate safely while mutating.
- **Test coverage**: Tested in test_migrations.

### _migrate_legacy_profile_name_suffixes(line 477)
- **Signature**: `async _migrate_legacy_profile_name_suffixes(self) -> None`
- **Contract**: Renames profile keys ending in `" [legacy]"` to the base name (stripping suffix). Sets `legacy: True` metadata on the profile data. Updates `active_profile` and `active_profile_legacy` pointers. Collision handling: if base name already exists in the normalized set, keeps original key.
- **Mutates**: Group `profiles` dicts, group `active_profile` and `active_profile_legacy`.
- **Calls**: `copy.deepcopy`, `async_save`
- **Called by**: `async_load`
- **Edge cases**: Collision on line 518 — if `target_name` already exists in `normalized_profiles`, falls back to `profile_name` (original key). But `normalized_profile` is then re-deepcopied from source, potentially losing the `legacy: True` flag set on line 515. The order of iteration over dict keys is deterministic (Python 3.7+), but if both `"Foo"` and `"Foo [legacy]"` exist, `"Foo"` is processed first, then `"Foo [legacy]"` would collide and keep its original key.
- **Test coverage**: Tested in test_migrations.

### _migrate_profiles_to_global(line 394)
- **Signature**: `async _migrate_profiles_to_global(self) -> None`
- **Contract**: Moves per-group legacy profile dicts into `self._data["profiles"]` (global registry). Creates unique names via `"{group_name} - {profile_name}"` pattern with dedup suffixes `(2)`, `(3)`, etc. Preserves old profiles on groups with `legacy: True` metadata for downgrade compatibility. Sets `active_profile_global` on groups.
- **Mutates**: `self._data["profiles"]`, each group's `profiles`, `active_profile_legacy`, `active_profile`, `active_profile_global`.
- **Calls**: `copy.deepcopy`, `_sync_group_profile_views`, `async_save`
- **Called by**: `async_load`
- **Edge cases**: Only runs when `global_profiles` is empty/truthy-false — if partially populated from a prior interrupted migration, it won't re-migrate. `make_unique_profile_name` only avoids collisions with existing `global_profiles` keys, not across the names being generated in the same migration pass (but since it's called sequentially per group per profile, each new name is added to `global_profiles` before the next call, so this is safe). The migration calls `_sync_group_profile_views()` which overwrites `schedule_mode` and `schedules` from the active global profile — this can clobber schedule data that was just being migrated if the view sync uses stale group data.
- **Test coverage**: Tested in test_migrations.

### _migrate_to_day_schedules(line 195)
- **Signature**: `async _migrate_to_day_schedules(self) -> None`
- **Contract**: Converts flat `nodes` lists on entities and groups into day-based `schedules` dict with `schedule_mode` key. Default mode: `"all_days"`.
- **Mutates**: Entity/group data: adds `schedule_mode`, `schedules`; deletes `nodes`.
- **Calls**: `async_save`
- **Called by**: `async_load`
- **Edge cases**: If entity already has `schedule_mode`, it's skipped (idempotent). Old `nodes` key is only deleted if it exists.
- **Test coverage**: Tested in test_migrations.

### _migrate_to_profiles(line 229)
- **Signature**: `async _migrate_to_profiles(self) -> None`
- **Contract**: Adds `profiles` and `active_profile` fields to entities and groups that lack them. Creates a "Default" profile from the current schedule. Deep-copies schedules.
- **Mutates**: Entity/group data: adds `profiles`, `active_profile`.
- **Calls**: `copy.deepcopy`, `async_save`
- **Called by**: `async_load`
- **Edge cases**: If `profiles` key exists but `active_profile` doesn't, the entity is *not* migrated (condition is AND: `if "profiles" not in ... or "active_profile" not in ...`). Partial state could exist.
- **Test coverage**: Tested in test_migrations.

### _project_group_runtime_view(line 1524)
- **Signature**: `_project_group_runtime_view(self, group_data: Dict[str, Any]) -> Dict[str, Any]`
- **Contract**: Returns a deep copy of `group_data` with `profiles` replaced by the global profiles dict, and `active_profile`/`active_profile_global` set to the resolved active global profile. Does NOT mutate stored data.
- **Mutates**: None (returns fresh copy).
- **Calls**: `copy.deepcopy`, `_ensure_global_profiles_initialized`, `_resolve_group_active_global_profile`
- **Called by**: `async_get_schedule`, `async_get_groups`, `async_get_group`
- **Edge cases**: The returned view's `profiles` key points to the *global* profiles, not the group's own legacy profiles. Consumers expecting group-scoped profiles will see unexpected data. The deep copy is expensive for large profile sets.
- **Test coverage**: Indirectly tested via group retrieval tests.

### _resolve_group_active_global_profile(line 361)
- **Signature**: `_resolve_group_active_global_profile(self, group_data: Dict[str, Any], global_profiles: Dict[str, Any]) -> Optional[str]`
- **Contract**: Returns the effective active global profile name for a group. Priority: `active_profile_global` (if in global_profiles) → `active_profile` (if in global_profiles) → "Default" (if exists) → first key in global_profiles → `None`.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `_sync_group_profile_views`, `_project_group_runtime_view`, `async_set_group_schedule`, `async_set_active_profile`, `async_get_active_profile_name`
- **Edge cases**: Empty `global_profiles` returns `None`. If `active_profile_global` and `active_profile` both exist but point to deleted profiles, falls through to "Default" or first.
- **Test coverage**: Indirectly tested.

### _sync_group_profile_views(line 373)
- **Signature**: `_sync_group_profile_views(self) -> None`
- **Contract**: For every group, resolves the active global profile and overwrites the group's `schedule_mode` and `schedules` to match the active global profile's data. Sets `active_profile_global`.
- **Mutates**: Every group's `schedule_mode`, `schedules`, `active_profile_global`.
- **Calls**: `_ensure_global_profiles_initialized`, `_resolve_group_active_global_profile`, `copy.deepcopy`
- **Called by**: `async_load`, `async_save`, `async_get_groups`, `_migrate_profiles_to_global`
- **Edge cases**: **BUG RISK** — This is called on `async_save()`, which means any unsaved schedule changes on a group that differ from its active global profile will be silently overwritten by the profile data before persisting. This can clobber in-progress edits if `async_save` is called before the caller finishes updating both the group and the global profile. Also called during `_migrate_profiles_to_global` which can clobber just-migrated schedule data.
- **Test coverage**: Partially tested.

### _time_to_minutes(line 1348)
- **Signature**: `_time_to_minutes(time_str: str) -> int` (static method)
- **Contract**: Converts "HH:MM" string to minutes since midnight (0–1439). No validation — assumes well-formed input.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `interpolate_temperature`, `get_active_node`, `get_next_node`, `get_active_node_for_group`
- **Edge cases**: "24:00" would produce 1440 (out of 0–1439 range). However, `validate_node` normalizes 24:00→23:59 before storage. If invalid data bypasses validation, `_time_to_minutes` will produce values > 1439 with unpredictable sort behavior.
- **Test coverage**: Indirectly tested via scheduling logic tests.

### async_add_entity(line 728)
- **Signature**: `async async_add_entity(self, entity_id: str) -> None`
- **Contract**: Creates a single-entity group for `entity_id` with default schedule. Uses `friendly_name` from HA state if available as the group name. Does nothing if group already exists.
- **Mutates**: `self._data["groups"]` — may add new group.
- **Calls**: `hass.states.get`, `DEFAULT_SCHEDULE.copy()`, `async_save`
- **Called by**: External (services.py, __init__.py)
- **Edge cases**: Uses `DEFAULT_SCHEDULE.copy()` (shallow copy) for `all_days` but `copy.deepcopy` is not used — nested dicts in nodes would be shared references. The `DEFAULT_SCHEDULE` constant is `[]`, so `.copy()` is a no-op list copy. If `DEFAULT_SCHEDULE` were changed to contain mutable dicts in future, this would be a bug.
- **Test coverage**: Tested in test_storage_crud.

### async_add_entity_to_group(line 1407)
- **Signature**: `async async_add_entity_to_group(self, group_name: str, entity_id: str) -> None`
- **Contract**: Adds `entity_id` to `group_name`. If entity is in another group, removes it from there; if that group was a single-entity group, deletes it. Updates `_is_single_entity_group` flag on target group.
- **Mutates**: Both target group and source group (removes entity), may delete source group.
- **Calls**: `async_save`
- **Called by**: External (services.py)
- **Edge cases**: If entity is in another multi-entity group (not single-entity), it's removed from that group but the group is *not* cleaned up even if it becomes empty. No validation that `entity_id` is a real HA climate entity. Only removes from *first* matching group (breaks after finding one).
- **Test coverage**: Partially tested.

### async_cleanup_derivative_sensors(line 913)
- **Signature**: `async async_cleanup_derivative_sensors(self, confirm_delete_all: bool = False) -> Dict[str, Any]`
- **Contract**: Deletes derivative sensor entities from HA entity registry. If auto-creation is disabled and `confirm_delete_all=True`, deletes all. Otherwise only deletes sensors whose source climate entity no longer exists. Returns result dict with counts and messages.
- **Mutates**: HA entity registry (removes sensor entities). Does NOT mutate `self._data`.
- **Calls**: `homeassistant.helpers.entity_registry.async_get`, `entity_registry.async_remove`, `async_get_all_entities`
- **Called by**: External (services.py)
- **Edge cases**: The `unique_id` format `climate_scheduler_{name}_rate` is assumed; if a sensor has a different unique_id pattern, it won't be found. The `climate_entity_id` reconstruction from `unique_id` simply strips prefixes/suffixes, which breaks for entity names containing underscores (e.g., `climate.living_room` → `entity_name="living_room"` → `climate.living_room` works, but the replace logic is fragile).
- **Test coverage**: Not directly tested (no unit test found).

### async_cleanup_unmonitored_storage(line 996)
- **Signature**: `async async_cleanup_unmonitored_storage(self, delete: bool = False) -> Dict[str, Any]`
- **Contract**: Scans groups for: ignored groups, missing climate entities, invalid entity refs, invalid profiles, broken active_profile pointers, orphaned advance_history entries. If `delete=False`, returns preview. If `delete=True`, applies changes and saves. Repairs profiles, normalizes `_is_single_entity_group` flag.
- **Mutates**: `self._data["groups"]`, `self._data["advance_history"]`, deletes `self._data["entities"]` (legacy key).
- **Calls**: `hass.states.async_entity_ids`, `copy.deepcopy`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Uses `self.hass.states.async_entity_ids("climate")` — this is the current HA state, not the stored data. If HA hasn't loaded a climate entity yet, it would be incorrectly treated as missing. Deep copies each group before processing, then assigns back to `kept_groups`; original group data that wasn't modified is still replaced (copy vs reference). The `_is_single_entity_group` flag is normalized based on entity count after cleanup, which may differ from the original intent.
- **Test coverage**: Not directly tested (no unit test found).

### async_create_group(line 1358)
- **Signature**: `async async_create_group(self, group_name: str) -> None`
- **Contract**: Creates a new empty group with a single "00:00 → 18°C" Default profile. Raises `ValueError` if group already exists.
- **Mutates**: `self._data["groups"]` — adds new entry.
- **Calls**: `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Creates group with no entities. The schedule has a hardcoded `{"time": "00:00", "temp": 18}` node — not from `DEFAULT_SCHEDULE` or user-configured defaults.
- **Test coverage**: Tested in test_advanced_storage.

### async_create_profile(line 1727)
- **Signature**: `async async_create_profile(self, target_id: str, profile_name: str) -> None`
- **Contract**: Creates a new global profile seeded from `target_id` group's current schedule. Raises `ValueError` if group doesn't exist or profile name already exists.
- **Mutates**: `self._data["profiles"]` — adds new entry.
- **Calls**: `_ensure_global_profiles_initialized`, `copy.deepcopy`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: `target_id` is a group name but is used to verify group existence; the profile is created globally, not scoped to the target group.
- **Test coverage**: Tested in test_advanced_storage.

### async_delete_group(line 1387)
- **Signature**: `async async_delete_group(self, group_name: str) -> None`
- **Contract**: Removes a group from storage. No-op if group doesn't exist.
- **Mutates**: `self._data["groups"]` — removes entry.
- **Calls**: `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Does not check if any entity references this group. Does not remove advance_history for entities in the deleted group.
- **Test coverage**: Tested in test_advanced_storage.

### async_delete_profile(line 1749)
- **Signature**: `async async_delete_profile(self, target_id: str, profile_name: str) -> None`
- **Contract**: Deletes a global profile. Refuses to delete the last profile or a profile that is active for any group. Raises `ValueError` on precondition failures.
- **Mutates**: `self._data["profiles"]` — removes entry.
- **Calls**: `_ensure_global_profiles_initialized`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Checks `group_data.get("active_profile")` against `profile_name`, but the active profile visible to consumers is the *resolved* global profile (via `_resolve_group_active_global_profile`). A group's `active_profile` might be a legacy name that maps to a different global profile, so the guard could miss cases where the profile is effectively active.
- **Test coverage**: Tested in test_advanced_storage.

### async_disable_group(line 1690)
- **Signature**: `async async_disable_group(self, group_name: str) -> None`
- **Contract**: Sets `enabled=False` on a group. Raises `ValueError` if group doesn't exist.
- **Mutates**: Group `enabled` field.
- **Calls**: `async_save`
- **Called by**: `async_disable_schedule`; external (services.py)
- **Edge cases**: None significant.
- **Test coverage**: Indirectly tested.

### async_disable_schedule(line 1712)
- **Signature**: `async async_disable_schedule(self, schedule_id: str) -> None`
- **Contract**: Disables a schedule by group name or entity_id. If `schedule_id` is a group name, disables that group. Otherwise finds the entity's group and disables it.
- **Mutates**: Group `enabled` field via `async_disable_group`.
- **Calls**: `async_get_entity_group`, `async_disable_group`
- **Called by**: External (services.py)
- **Edge cases**: Raises `ValueError` if `schedule_id` is neither a group name nor an entity_id in any group. Does not distinguish between entity_id strings that happen to match group names.
- **Test coverage**: Partially tested.

### async_enable_group(line 1681)
- **Signature**: `async async_enable_group(self, group_name: str) -> None`
- **Contract**: Sets `enabled=True` on a group. Raises `ValueError` if group doesn't exist.
- **Mutates**: Group `enabled` field.
- **Calls**: `async_save`
- **Called by**: `async_enable_schedule`; external (services.py)
- **Edge cases**: None significant.
- **Test coverage**: Indirectly tested.

### async_enable_schedule(line 1699)
- **Signature**: `async async_enable_schedule(self, schedule_id: str) -> None`
- **Contract**: Enables a schedule by group name or entity_id. Mirror of `async_disable_schedule`.
- **Mutates**: Group `enabled` field via `async_enable_group`.
- **Calls**: `async_get_entity_group`, `async_enable_group`
- **Called by**: External (services.py)
- **Edge cases**: Same as `async_disable_schedule`.
- **Test coverage**: Partially tested.

### async_factory_reset(line 566)
- **Signature**: `async async_factory_reset(self) -> None`
- **Contract**: Resets all storage data to freshly-installed defaults. Clears groups, settings, advance_history. Sets default min/max temps and `create_derivative_sensors`.
- **Mutates**: `self._data` — replaced entirely.
- **Calls**: `async_save`, re-imports `UnitOfTemperature` (unnecessary duplicate import)
- **Called by**: External (services.py)
- **Edge cases**: Does NOT call `_ensure_global_profiles_initialized` or `_sync_group_profile_views` after reset, so the reset state lacks `self._data["profiles"]` until next `async_load`. The re-import of `UnitOfTemperature` on line 579 is redundant (already imported at top).
- **Test coverage**: Not directly tested.

### async_get_active_profile_name(line 1867)
- **Signature**: `async async_get_active_profile_name(self, target_id: str) -> Optional[str]`
- **Contract**: Returns the resolved active global profile name for the group identified by `target_id`. Returns `None` if group doesn't exist.
- **Mutates**: None.
- **Calls**: `_ensure_global_profiles_initialized`, `_resolve_group_active_global_profile`
- **Called by**: External (services.py, UI)
- **Edge cases**: `target_key` is hardcoded to `"groups"`.
- **Test coverage**: Partially tested.

### async_get_advance_history(line 556)
- **Signature**: `async async_get_advance_history(self) -> Dict[str, Any]`
- **Contract**: Returns the full advance_history dict from storage.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: External (coordinator.py, services.py)
- **Edge cases**: Returns reference (not copy) — caller can mutate stored data accidentally.
- **Test coverage**: Not directly tested.

### async_get_all_entities(line 611)
- **Signature**: `async async_get_all_entities(self) -> List[str]`
- **Contract**: Returns deduplicated list of all entity_ids across all groups.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `async_cleanup_derivative_sensors`; external (coordinator.py)
- **Edge cases**: Uses `set()` for dedup, so order is non-deterministic. Returns a new list each call.
- **Test coverage**: Partially tested.

### async_get_entity_group(line 1538)
- **Signature**: `async async_get_entity_group(self, entity_id: str) -> Optional[str]`
- **Contract**: Returns the group name containing `entity_id`, or `None` if not in any group. Returns first match only.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: `async_enable_schedule`, `async_disable_schedule`; external (services.py)
- **Edge cases**: If entity is in multiple groups (data corruption), returns first found only.
- **Test coverage**: Partially tested.

### async_get_global_profiles(line 1879)
- **Signature**: `async async_get_global_profiles(self) -> Dict[str, Any]`
- **Contract**: Returns the global profiles dict after ensuring it's initialized.
- **Mutates**: May initialize profiles if missing (via `_ensure_global_profiles_initialized`).
- **Calls**: `_ensure_global_profiles_initialized`
- **Called by**: External (services.py, UI)
- **Edge cases**: Returns reference to `self._data["profiles"]` — caller can mutate.
- **Test coverage**: Partially tested.

### async_get_group(line 1516)
- **Signature**: `async async_get_group(self, group_name: str) -> Optional[Dict[str, Any]]`
- **Contract**: Returns a projected runtime view of a single group (global profiles injected). Calls `_sync_group_profile_views` first.
- **Mutates**: May update groups via `_sync_group_profile_views` (which overwrites schedule_mode/schedules).
- **Calls**: `_sync_group_profile_views`, `_project_group_runtime_view`
- **Called by**: External (services.py, UI)
- **Edge cases**: The `_sync_group_profile_views` side-effect here means a read operation can mutate data. If the caller is between modifying a group and saving, this read could clobber unsaved changes.
- **Test coverage**: Partially tested.

### async_get_group_schedule(line 1654)
- **Signature**: `async async_get_group_schedule(self, group_name: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]`
- **Contract**: Returns schedule info for a group. Includes `nodes`, `enabled`, `schedule_mode`, `schedules`. If group doesn't exist, returns `None`.
- **Mutates**: None.
- **Calls**: None (same day-resolution logic as `_get_nodes_for_day` but inline).
- **Called by**: `get_active_node_for_group`; external (coordinator.py)
- **Edge cases**: Day mapping logic is duplicated from `_get_nodes_for_day` but with differences — `async_get_group_schedule` returns `schedules` (all), while `_get_nodes_for_day` returns a specific day's nodes. Inconsistency: if `day="weekday"` in 5/2 mode, `_get_nodes_for_day` returns `schedules.get("weekday", [])` but `async_get_group_schedule` also returns `schedules.get("weekday", [])`; however the latter also returns the full `schedules` dict.
- **Test coverage**: Tested in test_scheduling_logic.

### async_get_groups(line 1504)
- **Signature**: `async async_get_groups(self) -> Dict[str, Any]`
- **Contract**: Returns all groups with projected runtime views. Calls `_sync_group_profile_views` first.
- **Mutates**: May update groups via `_sync_group_profile_views`.
- **Calls**: `_sync_group_profile_views`, `_project_group_runtime_view`
- **Called by**: External (services.py, UI, __init__.py)
- **Edge cases**: Same mutation-on-read concern as `async_get_group`.
- **Test coverage**: Partially tested.

### async_get_profiles(line 1859)
- **Signature**: `async async_get_profiles(self, target_id: str) -> Dict[str, Any]`
- **Contract**: Returns global profiles dict. `target_id` must be an existing group name (else returns `{}`).
- **Mutates**: May initialize profiles via `_ensure_global_profiles_initialized`.
- **Calls**: `_ensure_global_profiles_initialized`
- **Called by**: External (services.py, UI)
- **Edge cases**: Returns reference to `self._data["profiles"]` — caller can mutate.
- **Test coverage**: Partially tested.

### async_get_schedule(line 619)
- **Signature**: `async async_get_schedule(self, entity_id: str, day: Optional[str] = None) -> Optional[Dict[str, Any]]`
- **Contract**: Returns schedule info for an entity. Searches single-entity groups first, then multi-entity groups. If `day` is specified, returns `{"nodes": ..., "enabled": ..., "schedule_mode": ...}`. Without day, returns the full projected group data.
- **Mutates**: None (returns projected view).
- **Calls**: `_find_single_entity_group`, `_project_group_runtime_view`, `_get_nodes_for_day`
- **Called by**: External (services.py, coordinator.py, climate.py)
- **Edge cases**: Entity in both a single-entity group and a multi-entity group — single-entity group is found first, multi-entity group is ignored. This shouldn't happen normally but is a data integrity risk.
- **Test coverage**: Tested in test_storage_crud and test_scheduling_logic.

### async_get_settings(line 542)
- **Signature**: `async async_get_settings(self) -> Dict[str, Any]`
- **Contract**: Returns the global settings dict.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: External (coordinator.py, services.py, __init__.py)
- **Edge cases**: Returns reference — caller can mutate stored settings.
- **Test coverage**: Not directly tested.

### async_is_enabled(line 1219)
- **Signature**: `async async_is_enabled(self, entity_id: str) -> bool`
- **Contract**: Returns `True` if any group containing `entity_id` has `enabled=True`. Returns `False` if entity not in any group.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: External (coordinator.py)
- **Edge cases**: First-match wins — if entity is in multiple groups (corruption), only the first group's `enabled` flag is checked.
- **Test coverage**: Partially tested.

### async_is_ignored(line 873)
- **Signature**: `async async_is_ignored(self, entity_id: str) -> bool`
- **Contract**: Returns `True` if any group containing `entity_id` has `ignored=True`. `False` if not found.
- **Mutates**: None.
- **Calls**: None.
- **Called by**: External (coordinator.py, services.py)
- **Edge cases**: Same first-match issue as `async_is_enabled`.
- **Test coverage**: Partially tested.

### async_load(line 65)
- **Signature**: `async async_load(self) -> None`
- **Contract**: Loads persisted data from HA Store, runs the full migration pipeline, ensures structure defaults, sets temperature unit defaults, saves if settings were cleaned.
- **Mutates**: `self._data` — may be entirely replaced.
- **Calls**: `Store.async_load`, `_migrate_to_day_schedules`, `_migrate_to_profiles`, `_migrate_entities_to_groups`, `_migrate_profiles_to_global`, `_migrate_legacy_profile_name_suffixes`, `_ensure_global_profiles_initialized`, `_sync_group_profile_views`, `async_save`
- **Called by**: `__init__.py` (during async_setup_entry), `coordinator.py`
- **Edge cases**: The nested settings unwrapping logic (lines 88-139) can silently lose data if `performance_tracking` key is in the best layer (it's explicitly filtered out on line 127). The `changed_settings` local variable uses `locals().get("changed_settings")` on line 187 which only works if the `else` branch was taken (if data is `None`, `changed_settings` is never set and `locals().get` returns `None`). If `_migrate_profiles_to_global` calls `_sync_group_profile_views` which calls `async_save`, and then `async_load` also saves, there's a double-save on the same load path.
- **Test coverage**: Tested in test_migrations, test_advanced_storage, test_scheduling_logic.

### async_remove_entity(line 762)
- **Signature**: `async async_remove_entity(self, entity_id: str) -> None`
- **Contract**: Deletes the single-entity group for `entity_id`. No-op if no such group.
- **Mutates**: `self._data["groups"]` — removes entry.
- **Calls**: `_find_single_entity_group`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Does not remove entity from multi-entity groups. Only removes single-entity groups.
- **Test coverage**: Tested in test_storage_crud.

### async_remove_entity_from_group(line 1460)
- **Signature**: `async async_remove_entity_from_group(self, group_name: str, entity_id: str) -> None`
- **Contract**: Removes `entity_id` from `group_name` and creates a new single-entity group for it, inheriting the parent group's schedule/profile data. If group reduces to 1 entity, converts it to single-entity group.
- **Mutates**: Source group (removes entity, may set `_is_single_entity_group`), `self._data["groups"]` (adds new single-entity group).
- **Calls**: `hass.states.get`, `copy.deepcopy`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: The new single-entity group inherits the *parent's* schedule data, not the global profile's. This means the removed entity gets a copy of the group's current active profile schedule, losing access to profile switching until a profile is reassigned. No "Default" profile with legacy metadata is created for the new group's `profiles` dict — it copies the parent's `profiles` as-is, which may include legacy markers.
- **Test coverage**: Partially tested.

### async_rename_group(line 1394)
- **Signature**: `async async_rename_group(self, old_name: str, new_name: str) -> None`
- **Contract**: Renames a group key. Raises `ValueError` if old doesn't exist or new already exists.
- **Mutates**: `self._data["groups"]` — key rename via pop/assign.
- **Calls**: `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Does NOT update any references in `self._data["profiles"]` — global profiles named after the old group (from `make_unique_profile_name`) won't be renamed. Does NOT update `active_profile_global` on other groups that reference the old name.
- **Test coverage**: Tested in test_advanced_storage.

### async_rename_profile(line 1773)
- **Signature**: `async async_rename_profile(self, target_id: str, old_name: str, new_name: str) -> None`
- **Contract**: Renames a global profile. Updates `active_profile` on all groups that had the old name.
- **Mutates**: `self._data["profiles"]` (key rename), group `active_profile` fields.
- **Calls**: `_ensure_global_profiles_initialized`, `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Does NOT update `active_profile_global` or `active_profile_legacy` on groups, only `active_profile`. This means the resolved active profile may still work (via `_resolve_group_active_global_profile`), but the metadata is stale.
- **Test coverage**: Tested in test_advanced_storage.

### async_save(line 320)
- **Signature**: `async async_save(self) -> None`
- **Contract**: Syncs group profile views, then persists `self._data` to HA Store.
- **Mutates**: All groups' `schedule_mode` and `schedules` (via `_sync_group_profile_views`), then writes to disk.
- **Calls**: `_sync_group_profile_views`, `Store.async_save`
- **Called by**: Nearly every async method in this class, and by all migrations.
- **Edge cases**: The `_sync_group_profile_views` call on every save means group schedule data is always overwritten to match the active global profile before writing. This is the main vector for the clobber bug: if a caller modifies a group's `schedules` directly without also updating the active global profile, the save will overwrite their changes.
- **Test coverage**: Indirectly tested via all tests that save.

### async_save_advance_history(line 560)
- **Signature**: `async async_save_advance_history(self, history: Dict[str, Any]) -> None`
- **Contract**: Replaces the advance_history dict entirely, then saves.
- **Mutates**: `self._data["advance_history"]` — replaced.
- **Calls**: `async_save`
- **Called by**: External (coordinator.py)
- **Edge cases**: The full dict is replaced, not merged. Caller must provide complete state.
- **Test coverage**: Not directly tested.

### async_save_settings(line 546)
- **Signature**: `async async_save_settings(self, settings: Dict[str, Any]) -> None`
- **Contract**: Merges provided settings dict into existing settings (key-by-key), then saves.
- **Mutates**: `self._data["settings"]` — merge.
- **Calls**: `async_save`
- **Called by**: External (services.py, __init__.py)
- **Edge cases**: Merge semantics mean individual keys cannot be deleted via this method (setting a key to `None` stores `None`, doesn't remove the key).
- **Test coverage**: Not directly tested.

### async_set_active_profile(line 1797)
- **Signature**: `async async_set_active_profile(self, target_id: str, profile_name: str) -> None`
- **Contract**: Sets the active global profile for a group. Updates both `active_profile_global` and best-matching legacy `active_profile`/`active_profile_legacy`. Loads the profile's schedule into the group's runtime `schedule_mode`/`schedules`.
- **Mutates**: Group's `active_profile_global`, `active_profile`, `active_profile_legacy`, `schedule_mode`, `schedules`.
- **Calls**: `_ensure_global_profiles_initialized`, `copy.deepcopy`, `async_save`
- **Called by**: External (services.py, UI)
- **Edge cases**: The legacy active profile resolution (lines 1815-1846) has complex fallback logic. If `profile_name` doesn't match any key in `legacy_profiles`, it tries stripping the `"{target_id} - "` prefix and looking for a `legacy: True` profile, then a `[legacy]` suffixed name. If none match, it keeps the current `legacy_active` if it's still in `legacy_profiles`, else falls back to first legacy profile. This is a best-effort heuristic, not a guaranteed mapping.
- **Test coverage**: Tested in test_advanced_storage.

### async_set_enabled(line 883)
- **Signature**: `async async_set_enabled(self, entity_id: str, enabled: bool) -> None`
- **Contract**: Sets `enabled` on the group containing `entity_id`. No-op if entity not in any group (logs warning).
- **Mutates**: Group `enabled` field.
- **Calls**: `async_save`
- **Called by**: External (services.py)
- **Edge cases**: Does not set `ignored` flag. An entity can be `enabled=True` and `ignored=True` simultaneously if set via different code paths.
- **Test coverage**: Partially tested.

### async_set_ignored(line 773)
- **Signature**: `async async_set_ignored(self, entity_id: str, ignored: bool) -> None`
- **Contract**: Sets `ignored` on the group containing `entity_id`. When setting `ignored=True`, also sets `enabled=False`. When setting `ignored=False`, sets `enabled=True` and populates empty schedules with defaults. Creates a new single-entity group if entity not in any group.
- **Mutates**: Group `ignored`, `enabled`, potentially `schedule_mode`, `schedules`, `profiles`, `active_profile`. May create a new group.
- **Calls**: `_get_default_schedule_template`, `_build_schedules_from_template`, `hass.states.get`, `copy.deepcopy`, `async_save`
- **Called by**: External (services.py, __init__.py)
- **Edge cases**: When un-ignoring an entity with empty schedules, the Default profile is populated but other profiles aren't. The `active_profile` field is set via `group_data.get("active_profile") or "Default"` — if `active_profile` is an empty string, it becomes `"Default"`, which may not exist in the profiles dict if it was empty. Setting `ignored=False` + `enabled=True` is coupled, but `async_set_enabled` doesn't set `ignored=False`, creating an asymmetry.
- **Test coverage**: Partially tested.

### async_set_group_schedule(line 1545)
- **Signature**: `async async_set_group_schedule(self, group_name: str, nodes: List[Dict[str, Any]], day: Optional[str] = None, schedule_mode: Optional[str] = None, profile_name: Optional[str] = None) -> None`
- **Contract**: Sets schedule nodes for a group, with optional day, mode, and target profile. If `profile_name` is specified and differs from the active profile, saves to that profile without changing the group's active profile or runtime schedule. Otherwise, updates both the group's runtime schedule and the active global profile.
- **Mutates**: Group `schedule_mode`, `schedules`; global profile `schedule_mode`, `schedules`.
- **Calls**: `_ensure_global_profiles_initialized`, `_resolve_group_active_global_profile`, `copy.deepcopy`, `async_save`
- **Called by**: `async_set_schedule`; external (services.py)
- **Edge cases**: The inner `apply_nodes_to_schedules` function handles day→schedule-key mapping for different modes. When `day=None` and mode is "individual", it defaults to writing `mon` (line 1571) — this silently targets Monday. When writing to a non-active profile, the group's runtime schedule is re-synced from the *active* profile (lines 1640-1642), which is correct but could confuse callers who see their non-active-profile write not reflected in the group's runtime state.
- **Test coverage**: Tested in test_advanced_storage and test_storage_crud.

### async_set_schedule(line 682)
- **Signature**: `async async_set_schedule(self, entity_id: str, nodes: List[Dict[str, Any]], day: Optional[str] = None, schedule_mode: Optional[str] = None) -> None`
- **Contract**: Sets schedule nodes for an entity. If entity is in a multi-entity group, delegates to `async_set_group_schedule`. Otherwise creates/finds single-entity group and delegates.
- **Mutates**: May create a new single-entity group; delegates all other mutation to `async_set_group_schedule`.
- **Calls**: `_find_single_entity_group`, `hass.states.get`, `async_set_group_schedule`
- **Called by**: External (services.py — line 962 and line 995 for "clear" via empty list)
- **Edge cases**: Uses `friendly_name` from HA state for new group names. If `friendly_name` changes (entity renamed), the old group name remains and a second group with the new name could be created on next call. No dedup of entity across groups.
- **Test coverage**: Tested in test_storage_crud.

### get_active_node(line 1256)
- **Signature**: `get_active_node(self, nodes: List[Dict[str, Any]], current_time: time) -> Optional[Dict[str, Any]]`
- **Contract**: Returns the node whose time is most recent ≤ `current_time`. Wraps to last node if current time is before all nodes. Returns `None` for empty node list.
- **Mutates**: None.
- **Calls**: `_time_to_minutes`
- **Called by**: `get_active_node_for_group`; external (coordinator.py)
- **Edge cases**: If two nodes have the same time, the later one in the sorted list wins (last-writer semantics from sort stability). Works on step-function (hold) model — not linear interpolation.
- **Test coverage**: Tested in test_scheduling_logic.

### get_active_node_for_group(line 1283)
- **Signature**: `async get_active_node_for_group(self, group_name: str, current_time: Optional[time] = None, current_day: Optional[str] = None) -> Optional[Dict[str, Any]]`
- **Contract**: Gets the active node for a group, handling cross-day transitions in individual/5/2 mode. If current time is before the first node of the day, looks up yesterday's last node.
- **Mutates**: None.
- **Calls**: `async_get_group_schedule`, `_time_to_minutes`, `get_active_node`
- **Called by**: External (coordinator.py)
- **Edge cases**: Uses `datetime.now()` (local time, not HA's configured timezone) when `current_time` is `None`. The previous-day lookup only goes back one day (no recursive lookback), so if yesterday also had an empty schedule, it returns `None`. `days_of_week.index(current_day)` will raise `ValueError` if `current_day` is not in the expected set.
- **Test coverage**: Tested in test_scheduling_logic.

### get_next_node(line 1328)
- **Signature**: `get_next_node(self, nodes: List[Dict[str, Any]], current_time: time) -> Optional[Dict[str, Any]]`
- **Contract**: Returns the first node with time > `current_time`. Wraps to first node if none found. Returns `None` for empty list.
- **Mutates**: None.
- **Calls**: `_time_to_minutes`
- **Called by**: External (coordinator.py)
- **Edge cases**: Wrapping behavior means "next" can be the very first node of the same day (for scheduling purposes, this represents tomorrow).
- **Test coverage**: Tested in test_scheduling_logic.

### interpolate_temperature(line 1229)
- **Signature**: `interpolate_temperature(self, nodes: List[Dict[str, Any]], current_time: time) -> float`
- **Contract**: Returns the temperature at `current_time` using step-function (hold-last) semantics. Returns `18.0` for empty nodes. Wraps to last node if before all.
- **Mutates**: None.
- **Calls**: `_time_to_minutes`
- **Called by**: External (coordinator.py)
- **Edge cases**: The "24:00 → 23:59" normalization in `validate_node` means a node at 24:00 is stored as 23:59. The fallback value `18.0` is hardcoded Celsius with no unit awareness. Duplicate time nodes — later one wins after sort.
- **Test coverage**: Tested in test_scheduling_logic.

### validate_node(line 17)
- **Signature**: `validate_node(node: Dict[str, Any]) -> bool`
- **Contract**: Returns `True` if `node` is a dict with "time" (valid "HH:MM", 0–23h, 0–59m; 24:00 normalized to 23:59) and "temp" (passes `float()` conversion). Returns `False` and logs error otherwise.
- **Mutates**: Does NOT mutate — the 24:00→23:59 normalization is NOT written back to the node. The normalization is only used for range checking.
- **Calls**: None.
- **Called by**: `_get_default_schedule_template`; external (services.py for validation)
- **Edge cases**: **BUG**: `float()` accepts `NaN`, `inf`, `-inf` as valid temperatures. No range check against `MIN_TEMP`/`MAX_TEMP` constants. Temperature validation is effectively nonexistent beyond "is it a number-like thing?" The 24:00 normalization on lines 37-38 is computed but never stored — the node's `"time"` value remains `"24:00"` if it was originally `"24:00"`, which would cause `_time_to_minutes` to return 1440 (out of range).
- **Test coverage**: Tested in test_validate_node.

---

## Invariants

### Proven
1. **Group entity membership**: After `async_load` completes, every entity tracked by the integration is in exactly one group (single-entity or multi-entity). This is established by `_migrate_entities_to_groups`.
2. **Global profiles existence**: After `async_load` or any method that calls `_ensure_global_profiles_initialized`, `self._data["profiles"]` is a non-empty dict with at least a "Default" profile.
3. **Save syncs views**: Every `async_save` call runs `_sync_group_profile_views`, ensuring group runtime schedules match their active global profile on disk.

### Assumed (not enforced by code)
1. **Single group membership**: The code assumes an entity is in at most one group, but multiple methods (`async_get_schedule`, `async_is_enabled`, `async_is_ignored`) use first-match semantics without enforcing uniqueness.
2. **Profile name uniqueness**: Global profile names are assumed unique (enforced on create/rename) but `async_set_group_schedule` can create a profile implicitly (line 1601) without duplicate checking.
3. **Node list sorted**: Scheduling methods sort nodes before use, but the stored list is not guaranteed sorted. `_sync_group_profile_views` deep-copies schedules without sorting.
4. **No NaN/inf temperatures**: The system assumes temperatures are reasonable floats, but `validate_node` allows NaN and infinity.

---

## Contract Connections

This module **enforces**:
- **Persistence contract**: All state changes are persisted via `async_save` → `Store.async_save`. The save always includes view sync.
- **Migration ordering**: `_migrate_to_day_schedules` → `_migrate_to_profiles` → `_migrate_entities_to_groups` → `_migrate_profiles_to_global` → `_migrate_legacy_profile_name_suffixes`. This order is fixed and important (each depends on the previous structure).
- **Read returns projected view**: `async_get_schedule`, `async_get_group`, `async_get_groups` all return projected views with global profiles, not raw stored data.

This module **depends on**:
- HA Store (persistence layer)
- HA entity registry (for derivative sensor cleanup)
- HA state machine (for `friendly_name` lookups and entity existence checks)
- `const.py` for `DOMAIN`, `STORAGE_VERSION`, `STORAGE_KEY`, `DEFAULT_SCHEDULE`, `MIN_TEMP`, `MAX_TEMP`

---

## Known Bugs / Gaps

1. **async_clear_schedule does NOT exist as a method**, but services.py line 995 originally called it. It has been replaced with `async_set_schedule(entity_id, [])` but this is a PARTIAL fix — it only clears the current day in individual mode (via `apply_nodes_to_schedules`), not all days. For "all_days" mode it works; for "individual" mode, `day=None` defaults to writing `mon` only (line 1571).

2. **validate_node accepts NaN and inf as temperatures** — `float()` does not reject these. No range check against `MIN_TEMP`/`MAX_TEMP` constants that are imported but unused in validation.

3. **_sync_group_profile_views can clobber schedule data during partial migrations** — Called by `async_save` (line 322) and by `_migrate_profiles_to_global` (line 473). If a migration updates some groups' schedules but hasn't yet updated the corresponding global profile, saving will overwrite those schedules with the (stale) active global profile data. This weakens migration invariants.

4. **24:00 normalization is not persisted** — `validate_node` normalizes 24:00→23:59 for range checking but does NOT write this back to the node dict. Nodes with `"time": "24:00"` will pass validation but cause `_time_to_minutes` to return 1440, leading to incorrect sort order and scheduling behavior.

5. **async_factory_reset does not initialize profiles** — After reset, `self._data["profiles"]` is missing until next `async_load` or method that calls `_ensure_global_profiles_initialized`.

6. **Read operations can mutate data** — `async_get_group` and `async_get_groups` call `_sync_group_profile_views` which overwrites group schedule data. Any code holding a reference to a group's schedule between modification and save may have its changes silently overwritten.

7. **async_rename_group doesn't update global profile references** — Global profiles named after the old group name (from `make_unique_profile_name` in migration) are not renamed, nor are `active_profile_global` pointers on other groups updated.

8. **async_rename_profile doesn't update `active_profile_global`** — Only updates `active_profile` on groups, leaving `active_profile_global` and `active_profile_legacy` stale (though `_resolve_group_active_global_profile` may still resolve correctly).

9. **Shallow copy in async_add_entity** — Uses `DEFAULT_SCHEDULE.copy()` (shallow) which is currently safe since `DEFAULT_SCHEDULE` is `[]`, but would break if the constant were changed to contain mutable dicts.

10. **async_remove_entity_from_group inherits parent profiles, not global** — The new single-entity group gets the parent's legacy `profiles` dict, which may not align with global profiles and lacks `active_profile_global`.

11. **interpolate_temperature returns hardcoded 18.0°C** — Not unit-aware. In Fahrenheit installations, 18.0°C is 64.4°F, which is not the intended fallback.

12. **datetime.now() not timezone-aware** — `get_active_node_for_group` uses `datetime.now().time()` without HA's configured timezone.

---

## Cross-Module Dependencies

### Imports
- `homeassistant.core.HomeAssistant` — Hass instance for state access and config entry reload
- `homeassistant.helpers.storage.Store` — HA's persistent storage abstraction
- `homeassistant.const.UnitOfTemperature` — Temperature unit enum for defaults
- `.const` — `DOMAIN`, `STORAGE_VERSION`, `STORAGE_KEY`, `DEFAULT_SCHEDULE`, `MIN_TEMP`, `MAX_TEMP`
- `logging` — Stdlib logger
- `copy` — Deep copy for data isolation
- `re` — Regex for version string parsing in settings migration
- `typing` — Type hints
- `datetime` — `datetime`, `time` for scheduling logic
- `homeassistant.helpers.entity_registry` (lazy import in `async_cleanup_derivative_sensors`)

### Consumers (who import storage.py)
- `__init__.py` — Creates `ScheduleStorage` instance during setup entry
- `climate.py` — Uses `ScheduleStorage` for schedule lookups
- `coordinator.py` — Uses `ScheduleStorage` for active node lookups, entity enumeration
- `services.py` — Calls nearly all async methods for service handlers
- `tests/conftest.py` — Test fixtures
- `tests/test_advanced_storage.py` — Profile/group CRUD tests
- `tests/test_migrations.py` — Migration pipeline tests
- `tests/test_scheduling_logic.py` — Interpolation/scheduling algorithm tests
- `tests/test_storage_crud.py` — Basic CRUD tests
- `tests/test_validate_node.py` — Node validation tests