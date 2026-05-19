# KNOWLEDGE: config_flow.py

## Purpose
Implements the Home Assistant config flow for the Climate Scheduler integration. Handles user-initiated setup (via UI) and YAML import. Enforces a single-config-entry constraint — only one instance of the integration can exist at a time.

## Key Functions (alphabetical)

### ClimateSchedulerConfigFlow.async_step_import(user_input) (line 24)
- **Signature**: `async def async_step_import(self, user_input: dict | None = None) -> ConfigFlowResult`
- **Contract**: Handles YAML configuration import for backward compatibility. If an entry already exists, aborts with `"already_configured"`. Otherwise creates a config entry with empty data and title "Climate Scheduler". Always succeeds (no validation — YAML import is implicit trust).
- **Mutates**: Creates a new config entry in HA's config entry store.
- **Calls**: `self._async_current_entries()`, `self.async_abort()`, `self.async_create_entry()`.
- **Called by**: Home Assistant config flow framework (triggered by `__init__.py` `async_setup` when YAML config detected).
- **Edge cases**:
  - Race condition: if two imports fire concurrently, both could pass the `_async_current_entries()` check. HA's ConfigFlow manager serializes flows, so this is mitigated in practice.
  - `user_input` parameter is ignored — all YAML config is handled by the integration's own storage.
- **Test coverage**: Untested.

### ClimateSchedulerConfigFlow.async_step_user(user_input) (line 13)
- **Signature**: `async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult`
- **Contract**: Handles the user-initiated config flow step. If a config entry already exists, aborts with `"already_configured"`. If `user_input` is provided (form submitted), creates a config entry with empty data dict. If `user_input` is None (first step), shows an empty form schema (confirmation-only).
- **Mutates**: Creates a new config entry in HA's config entry store.
- **Calls**: `self._async_current_entries()`, `self.async_abort()`, `self.async_show_form()`, `self.async_create_entry()`.
- **Called by**: Home Assistant config flow framework (user clicks "Add Integration" in HA UI).
- **Edge cases**:
  - The form schema is `vol.Schema({})` — empty dict means the form has no fields. This is intentional confirmation-only UX.
  - `data={}` in `async_create_entry` — all configuration is managed via the integration's own storage/services, not config entry data (except `version` written by `__init__.py`).
- **Test coverage**: Untested.

### ClimateSchedulerConfigFlow (class, line 10)
- **Signature**: `class ClimateSchedulerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN)`
- **Contract**: Single-instance config flow. `VERSION = 1` is the flow schema version (distinct from STORAGE_VERSION). Enforces single-entry via `_async_current_entries()` check in both steps.
- **Mutates**: N/A
- **Calls**: N/A
- **Called by**: HA config flow framework
- **Edge cases**:
  - No `async_step_options` — there's no options flow. All settings are managed via services/storage, not config entry options.
  - No `async_migrate_entry` — flow version changes have no migration path.
- **Test coverage**: Untested.

## Invariants
1. **Single entry guarantee**: At most one config entry for DOMAIN can exist. Enforced by `_async_current_entries()` checks. (Proven — both steps abort on duplicate.)
2. **Empty config data**: All config entries have `data={}` — no configuration is stored in the config entry itself (except `version` added by `__init__.py`). (Assumed — future code could populate this.)

## Contract Connections
- **C-SINGLE-ENTRY**: Only one config entry allowed. Both `async_step_user` and `async_step_import` enforce this.
- **C-YAML-COMPAT**: `async_step_import` provides backward compatibility for YAML-based configuration.

## Known Bugs / Gaps
1. **No options flow**: Users cannot reconfigure the integration via HA UI after initial setup. All configuration happens through services and the frontend card.
2. **No input validation**: The config flow performs zero validation — the empty form just confirms creation. All real validation is deferred to the services layer.
3. **Flow VERSION vs STORAGE_VERSION confusion risk**: `VERSION = 1` on line 11 is the config flow schema version, different from `STORAGE_VERSION = 1` in `const.py`. They happen to match but serve different purposes.

## Cross-Module Dependencies
- **Imports from**: `.const` (DOMAIN), `voluptuous` (vol), `homeassistant.config_entries`, `homeassistant.core.HomeAssistant`
- **Imported by**: Home Assistant framework (discovered via `manifest.json` `config_flow: true`)