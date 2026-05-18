# Climate Scheduler Test Suite

## Running Tests

```bash
pip install pytest pytest-asyncio
pytest tests/ -v
```

Tests are pure-logic and run without a Home Assistant installation.
Heavy mocking is limited to a lightweight `FakeStore` (in-memory storage stub).

## Architecture

| File | What it tests |
|------|---------------|
| `conftest.py` | FakeStore mock, fixtures |
| `test_validate_node.py` | `validate_node()` — input validation |
| `test_scheduling_logic.py` | `_time_to_minutes`, `get_active_node`, `get_next_node`, `interpolate_temperature` |
| `test_storage_crud.py` | CRUD operations: schedules, groups, profiles, settings, history, factory reset |
| `test_migrations.py` | 5 storage migration paths |
| `test_advanced_storage.py` | `_get_nodes_for_day`, `_project_group_runtime_view`, `_resolve_group_active_global_profile`, `_sync_group_profile_views`, `_find_single_entity_group`, `async_set_group_schedule`, enable/disable routing |

## Known Bugs Discovered During Testing

### BUG: `async_clear_schedule` doesn't exist (services.py:995)
`handle_clear_schedule` calls `storage.async_clear_schedule(entity_id)` but this method
is not defined on `ScheduleStorage`. This causes an `AttributeError` at runtime when
the `clear_schedule` service is called. **Fixed** by replacing with
`storage.async_set_schedule(entity_id, [])`.

### BUG: `_sync_group_profile_views` clobbers migrated schedules
When `_migrate_to_day_schedules` runs on a group that has no profiles yet,
`async_save` → `_sync_group_profile_views` initializes empty global profiles and
overlays them onto the group, clobbering the just-migrated schedule data.
This is resolved when the full migration chain runs (subsequent migrations
create profiles first), but is a risk if a partial migration is interrupted.

### BUG: `validate_node` accepts NaN and infinity as temperatures
`float("NaN")` and `float("inf")` parse successfully, so `validate_node`
accepts them. These are not meaningful temperature values and should be rejected.

### BUG (Issue #186): 24:00 time format validation
`validate_node` normalizes `24:00` → `23:59`, but the switch component
still logs warnings about `Invalid time format: 24:00`. The validation
in `switch.py` does NOT apply the same normalization (`validate_node`
accepts it, but the switch's own validation rejects it).

## Coverage Map — GitHub Issues

| Issue | Description | Test Coverage |
|-------|-------------|---------------|
| #186 | 24:00 time format warning | `test_validate_node.py`: `test_24_00_normalized_to_23_59`, `test_24_01_rejected` |
| #187 | Schedule data bleeds between entities | `test_migrations.py`: migration chain integrity tests |
| #168 | Profile conversion wrong (corrupts data) | `test_migrations.py`: `test_migrates_group_profiles_to_global`, `test_name_collision_gets_suffix` |
| #160 | Entities have wrong profiles after rename | `test_advanced_storage.py`: `test_strips_legacy_suffix`, profile resolution tests |
| #144 | Deleted entities remain as phantoms | `test_storage_crud.py`: `test_remove_entity`, orphan cleanup tests |
| #130 | Orphaned devices/entities after group changes | `test_advanced_storage.py`: `test_find_single_entity_group_*` |
| #158 | Schedule enabled state not updating | `test_advanced_storage.py`: enable/disable routing tests |

## CI

`.github/workflows/tests.yml` runs on push/PR to `main` on Python 3.11 & 3.12.