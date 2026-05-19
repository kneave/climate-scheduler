# KNOWLEDGE: __init__.py

## Purpose
Entry point for the Climate Scheduler Home Assistant integration. Handles one-time initialization of storage, coordinator, services, and frontend card resources. Manages the config entry lifecycle (setup, unload, upgrade) and registers the bundled Lovelace frontend card as a static resource.

## Key Functions (alphabetical)

### _async_setup_common(hass) (line 25)
- **Signature**: `async def _async_setup_common(hass: HomeAssistant) -> None`
- **Contract**: Idempotent initialization of storage, coordinator, services, and frontend resources. Safe to call multiple times (e.g., on config entry reload). Guarantees that `hass.data[DOMAIN]` contains `"storage"`, `"coordinator"`, and `"services_registered"` keys when done.
- **Mutates**: `hass.data[DOMAIN]` — sets `"storage"`, `"coordinator"`, `"services_registered"`, `"frontend_static_registered"`, `"frontend_registered_version"`.
- **Calls**: `ScheduleStorage(hass)`, `storage.async_load()`, `HeatingSchedulerCoordinator(hass, storage, timedelta)`, `coordinator.async_refresh()`, `coordinator.force_update_all()`, `async_track_time_interval()`, `service_module.async_setup_services()`, `_register_frontend_resources()`.
- **Called by**: `async_setup_entry()`.
- **Edge cases**: 
  - If storage/coordinator already exist, skips re-creation but still checks for missing services.
  - The `expected_services` tuple (lines 70–109) must be kept in sync with `services.py` — drift causes unnecessary re-registration warnings.
  - Uses f-string in `logging.info()` (line 48) — not lazy formatting; acceptable but non-idiomatic.
- **Test coverage**: Partially tested via integration setup tests.

### _register_frontend_resources(hass) (line 133)
- **Signature**: `async def _register_frontend_resources(hass: HomeAssistant) -> None`
- **Contract**: Registers the bundled `climate-scheduler-card.js` as a Lovelace resource with cache-busting version query param. Handles: (1) HA 2025.2+ API vs older API for `lovelace_data.resources`, (2) YAML-mode Lovelace (creates persistent notification with manual instructions), (3) migration from old HACS/community card URLs, (4) idempotent repeated calls via `frontend_static_registered` flag.
- **Mutates**: `hass.data[DOMAIN]["frontend_static_registered"]`, `hass.data[DOMAIN]["frontend_registered_version"]`, Lovelace resources store (creates/deletes resource entries), persistent notifications.
- **Calls**: `hass.http.async_register_static_paths()`, `resources.async_items()`, `resources.async_delete_item()`, `resources.async_create_item()`, `resources.async_load()`, `hass.services.async_call("persistent_notification", ...)`.
- **Called by**: `_async_setup_common()`.
- **Edge cases**:
  - Lines 186–189: HA version parsing via `ha_version.split(".")[:2]` — will break on non-numeric version strings (unlikely in production).
  - Lines 257–262: `old_card_patterns` includes `f"/{DOMAIN}/static/"` which matches the new bundled URL too — but line 271 catches it first as `existing_entry` so it's safe.
  - Line 288: Bare `except Exception` (BLE001) when deleting existing entry — risks swallowing real errors.
  - Lovelace YAML mode detection (line 196) relies on `resources.store` being None — internal HA implementation detail that could change.
- **Test coverage**: Mostly untested; complex path-dependent logic is fragile.

### async_setup(hass, config) (line 312)
- **Signature**: `async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool`
- **Contract**: Home Assistant YAML setup entry point. If DOMAIN present in YAML config, creates a config flow import. Always returns `True` (never fails).
- **Mutates**: Creates an async task for config flow import.
- **Calls**: `hass.config_entries.flow.async_init()`.
- **Called by**: Home Assistant framework.
- **Edge cases**: If YAML config has DOMAIN but a config entry already exists, the flow will abort with `"already_configured"` — no error raised here.
- **Test coverage**: Untested.

### async_setup_entry(hass, entry) (line 324)
- **Signature**: `async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool`
- **Contract**: Sets up the integration from a config entry. Calls `_async_setup_common()`, detects first-install vs upgrade by comparing stored version with manifest version, forwards entry setup to `"sensor"`, `"climate"`, `"switch"` platforms, and schedules a delayed reload after first install or upgrade.
- **Mutates**: Updates `entry.data` with `"version"` key. Schedules `_delayed_reload` task. Forwards setup to 3 platforms.
- **Calls**: `_async_setup_common()`, `hass.config_entries.async_update_entry()`, `hass.config_entries.async_forward_entry_setups()`, `asyncio.sleep()`, `hass.config_entries.async_reload()`.
- **Called by**: Home Assistant framework.
- **Edge cases**:
  - **Self-reload on first install/upgrade** (lines 358–369): Creates an `asyncio.sleep(2)` then reloads the entire config entry. This is a workaround to ensure platforms are fully initialized before UI attempts to use them. Risk of infinite reload loop if setup keeps failing.
  - `import asyncio` is inside the function body (line 368) — should be at module top.
  - Line 361: `await asyncio.sleep(2)` — magic number delay; fragile if platforms take longer than 2s to initialize.
- **Test coverage**: Partially tested.

### async_unload_entry(hass, entry) (line 374)
- **Signature**: `async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool`
- **Contract**: Unloads all platforms (sensor, climate, switch). If this is the last config entry, also unregisters all services and removes `hass.data[DOMAIN]`. Returns the unload result.
- **Mutates**: Unregisters services from `hass.services`, removes `hass.data[DOMAIN]`.
- **Calls**: `hass.config_entries.async_unload_platforms()`, `hass.services.async_remove()`, `hass.config_entries.async_entries()`.
- **Called by**: Home Assistant framework.
- **Edge cases**:
  - Service list in `async_unload_entry` (lines 384–391) does not include all services from `expected_services` in `_async_setup_common` (missing: `recreate_all_sensors`, `cleanup_malformed_sensors`, `rename_group`, `list_groups`, `list_profiles`, `reregister_card`, `diagnostics`). Orphaned services may persist after unload.
  - Uses bare `except Exception: pass` when removing services (lines 397–398) — intentionally silent.
  - `len(entries) <= 1` check (line 381) is correct: during unload, the entry being removed is still in the list, so `< =1` means it's the only/last one.
- **Test coverage**: Partially tested.

## Invariants
1. **Single storage, single coordinator**: `_async_setup_common` ensures only one `ScheduleStorage` and one `HeatingSchedulerCoordinator` exist per HA runtime, regardless of how many config entries or reloads occur. (Proven by guard checks on lines 31–35, 38–39.)
2. **Services registered flag**: `hass.data[DOMAIN]["services_registered"]` must be `True` iff services are actually registered. Verified on re-entry by checking each service individually (lines 110–121). (Assumed; the check could miss newly-added services not in `expected_services`.)
3. **Frontend static path registered once**: The `frontend_static_registered` flag prevents re-registering the same static path, which would raise an error. (Proven by HA's `async_register_static_paths` idempotency contract.)

## Contract Connections
- **C-INIT-IDEMPOTENT**: `_async_setup_common` guarantees idempotent initialization.
- **C-SERVICE-REGISTRY**: Services are registered atomically and verified on reload.
- **C-FRONTEND-RESOURCE**: Frontend card is registered/re-registered with version-busting URL.
- **C-UPGRADE-RELOAD**: First install or version upgrade triggers an automatic reload.

## Known Bugs / Gaps
1. **Service list mismatch**: `async_unload_entry` doesn't unregister all services — missing ~8 services from the expected list. Orphans will persist in `hass.services` until HA restart.
2. **Self-reload hack**: The `asyncio.sleep(2)` + `async_reload` pattern in `async_setup_entry` is fragile and may cause startup loops.
3. **`import asyncio` inside function**: Line 368 imports `asyncio` inside `_delayed_reload` closure — should be at module level.
4. **Version parsing fragility**: Line 183 splits HA version on `.` and converts to int — will crash on versions like `"2025.2.0b1"`.
5. **No `async_migrate_entry`**: There's no config entry migration handler. Changing `STORAGE_VERSION` without a migration path will cause data loss.

## Cross-Module Dependencies
- **Imports from**: `.const` (DOMAIN, UPDATE_INTERVAL_SECONDS), `.coordinator` (HeatingSchedulerCoordinator), `.storage` (ScheduleStorage), `.services` (async_get_services, async_setup_services), `homeassistant.*`, `aiohttp`, `json`, `time`, `pathlib.Path`
- **Exported to**: Home Assistant framework (`async_setup`, `async_setup_entry`, `async_unload_entry`)