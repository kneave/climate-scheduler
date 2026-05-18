# Climate Scheduler Tests

## Running

```bash
pip install pytest pytest-asyncio voluptuous aiohttp
pytest
```

No Home Assistant installation required — tests use lightweight mocking.

## Test Structure

| File | Coverage | Approach |
|---|---|---|
| `test_validate_node.py` | Node input validation | Pure function, no mocking |
| `test_scheduling_logic.py` | Time math, active/next node, interpolation | Pure function, no mocking |
| `test_storage_crud.py` | Storage CRUD, groups, profiles, settings | `FakeStore` mock |

## Known Issues Found

- **`async_clear_schedule` missing from storage.py** — `services.py:995` calls `storage.async_clear_schedule(entity_id)` but the method doesn't exist on `ScheduleStorage`. This will cause a runtime `AttributeError` when the `clear_schedule` service is invoked.

## Adding HA Integration Tests

The current suite covers pure logic and storage operations without Home Assistant. For full service-handler and coordinator coverage, a Docker-based HA instance can be added later via `pytest-homeassistant-custom-component`.

## CI

A GitHub Actions workflow runs `pytest` on every push and PR (see `.github/workflows/tests.yml`).