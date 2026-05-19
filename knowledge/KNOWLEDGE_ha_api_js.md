# KNOWLEDGE: ha-api.js

## Purpose
Home Assistant API wrapper class (`HomeAssistantAPI`). Provides dual-mode connectivity to HA: custom panel mode (using the `hass` object injected by HA's panel framework) and raw WebSocket mode (for iframe/standalone). Encapsulates all service calls, state querying, event subscriptions, and settings CRUD for the `climate_scheduler` integration.

## Key Functions (alphabetical)

### addToGroup(line 386)
- **Signature**: `(groupName, entityId)`
- **Contract**: Adds entity to group. Calls `climate_scheduler.add_to_group`.
- **Service calls**: `callService('climate_scheduler', 'add_to_group', {schedule_id, entity_id})`

### advanceGroup(line 299)
- **Signature**: `(groupName)`
- **Contract**: Advances group to next scheduled node. Calls `climate_scheduler.advance_group`.
- **Service calls**: `callService('climate_scheduler', 'advance_group', {schedule_id: groupName})`

### callService(line 205)
- **Signature**: `(domain, service, serviceData, returnResponse = false)`
- **Contract**: Calls an HA service. In hass-object mode: uses `hass.callWS` for `returnResponse=true` (avoids haptic feedback), or `hass.callService` for fire-and-forget. In WebSocket mode: sends `{type: 'call_service', domain, service, service_data}` with optional `return_response`.
- **State**: Reads `this.hass`, `this.usingHassObject`.
- **Edge cases**: `returnResponse` flag is critical — must be `true` for services that return data (get_schedule, get_groups, etc.). Wrong flag = no data returned.

### cancelAdvance(line 305)
- **Signature**: `(entityId)`
- **Contract**: Cancels active advance for an entity.
- **Service calls**: `callService('climate_scheduler', 'cancel_advance', {schedule_id})`

### clearAdvanceHistory(line 326)
- **Signature**: `(entityId)`
- **Contract**: Clears advance history markers.
- **Service calls**: `callService('climate_scheduler', 'clear_advance_history', {schedule_id})`

### clearSchedule(line 353)
- **Signature**: `(entityId)`
- **Contract**: Clears schedule for an entity.
- **Service calls**: `callService('climate_scheduler', 'clear_schedule', {schedule_id})`

### connect(line 25)
- **Signature**: `()`
- **Contract**: In hass-object mode, resolves immediately. In WebSocket mode, creates WebSocket to `/api/websocket`, handles auth flow. Returns promise that resolves on `auth_ok`.
- **State**: Reads `this.hass`, `this.usingHassObject`; writes `this.connection`.
- **Edge cases**: WebSocket mode requires auth token via `getAuthToken()`. If auth fails, rejects.

### cleanupDerivativeSensors(line 561)
- **Signature**: `(confirmDeleteAll = false)`
- **Contract**: Calls `climate_scheduler.cleanup_derivative_sensors`. Returns normalized response.
- **Service calls**: `callService('climate_scheduler', 'cleanup_derivative_sensors', {confirm_delete_all}, true)`

### cleanupOrphanedClimateEntities(line 573)
- **Signature**: `(deleteEntities = false)`
- **Contract**: Calls `climate_scheduler.cleanup_orphaned_climate_entities`. Dry-run if `deleteEntities=false`, actual delete if `true`.
- **Service calls**: `callService('climate_scheduler', 'cleanup_orphaned_climate_entities', {delete: deleteEntities}, true)`

### cleanupUnmonitoredStorage(line 585)
- **Signature**: `(deleteEntries = false)`
- **Contract**: Calls `climate_scheduler.cleanup_unmonitored_storage`. Dry-run if `false`, actual delete if `true`.
- **Service calls**: `callService('climate_scheduler', 'cleanup_unmonitored_storage', {delete: deleteEntries}, true)`

### createGroup(line 367)
- **Signature**: `(groupName)`
- **Contract**: Creates a new group.
- **Service calls**: `callService('climate_scheduler', 'create_group', {schedule_id: groupName})`

### createProfile(line 598)
- **Signature**: `(scheduleId, profileName)`
- **Contract**: Creates a new profile under a schedule/group.
- **Service calls**: `callService('climate_scheduler', 'create_profile', {schedule_id, profile_name})`

### deleteGroup(line 373)
- **Signature**: `(groupName)`
- **Contract**: Deletes a group. Entities move back to unmonitored.
- **Service calls**: `callService('climate_scheduler', 'delete_group', {schedule_id: groupName})`

### deleteProfile(line 605)
- **Signature**: `(scheduleId, profileName)`
- **Contract**: Deletes a profile from a schedule/group.
- **Service calls**: `callService('climate_scheduler', 'delete_profile', {schedule_id, profile_name})`

### disableGroup(line 478)
- **Signature**: `(groupName)`
- **Contract**: Disables scheduling for a group.
- **Service calls**: `callService('climate_scheduler', 'disable_group', {schedule_id})`

### disableSchedule(line 287)
- **Signature**: `(entityId)`
- **Contract**: Disables schedule for an entity.
- **Service calls**: `callService('climate_scheduler', 'disable_schedule', {schedule_id})`

### enableGroup(line 472)
- **Signature**: `(groupName)`
- **Contract**: Enables scheduling for a group.
- **Service calls**: `callService('climate_scheduler', 'enable_group', {schedule_id})`

### enableSchedule(line 281)
- **Signature**: `(entityId)`
- **Contract**: Enables schedule for an entity.
- **Service calls**: `callService('climate_scheduler', 'enable_schedule', {schedule_id})`

### getAdvanceStatus(line 311)
- **Signature**: `(entityId)`
- **Contract**: Gets advance status with return_response. Normalizes `{response}` vs raw result.
- **Service calls**: `callService('climate_scheduler', 'get_advance_status', {schedule_id}, true)`
- **Edge cases**: Returns default `{is_active: false, history: []}` on error.

### getAuthToken(line 101)
- **Signature**: `()`
- **Contract**: Tries 3 methods in order: `window.hassConnection`, `window.parent.hassConnection`, `localStorage.hassTokens`. Throws if none found.
- **Edge cases**: Mobile app needs `window.hassConnection`; browser needs localStorage.

### getClimateEntities(line 197)
- **Signature**: `()`
- **Contract**: Gets all climate entities from HA, excluding `climate.climate_scheduler_*` entities.
- **Service calls**: `getStates()`, then filters.

### getConfig(line 188)
- **Signature**: `()`
- **Contract**: Returns HA config (includes `unit_system.temperature`, `time_zone`). In hass mode returns `this.hass.config`.
- **Service calls**: `sendRequest({type: 'get_config'})` in WebSocket mode.

### getGroups(line 400)
- **Signature**: `()`
- **Contract**: Calls `climate_scheduler.get_groups` with `return_response`. Returns `{groups: {}}` on error.
- **Service calls**: `callService('climate_scheduler', 'get_groups', {}, true)`

### getHistory(line 484)
- **Signature**: `(entityId, startTime, endTime)`
- **Contract**: Fetches HA recorder history for an entity. Uses `/api/history/history_during_period`.
- **Service calls**: `sendRequest({type: 'history/history_during_period', ...})` in WebSocket mode only.
- **Edge cases**: In hass-object mode, this method does NOT have an equivalent path — it relies on `sendRequest` which uses `hass.callWS`. This works in panel mode since `callWS` is available.

### getOverrideStatus(line 341)
- **Signature**: `(entityId)`
- **Contract**: Gets override status for an entity.
- **Service calls**: `callService('climate_scheduler', 'get_override_status', {schedule_id}, true)`

### getProfiles(line 627)
- **Signature**: `(scheduleId)`
- **Contract**: Gets profiles for a schedule. Returns default on error.
- **Service calls**: `callService('climate_scheduler', 'get_profiles', {schedule_id}, true)`

### getSchedule(line 245)
- **Signature**: `(entityId, day = null)`
- **Contract**: Returns schedule for an entity (optionally for a specific day). Returns null on error.
- **Service calls**: `callService('climate_scheduler', 'get_schedule', {schedule_id, day?}, true)`

### getSettings(line 523)
- **Signature**: `()`
- **Contract**: Calls `climate_scheduler.get_settings` with `return_response`. Normalizes response: extracts `payload.settings` if response has `{settings, version}` shape, otherwise returns raw payload.
- **Service calls**: `callService('climate_scheduler', 'get_settings', {}, true)`
- **Edge cases**: Response normalization is critical — service returns `{settings: {...}, version: {...}}` but app.js expects the raw settings dict.

### getStates(line 179)
- **Signature**: `()`
- **Contract**: Returns all HA states. In hass mode returns `Object.values(this.hass.states)`.
- **Service calls**: `sendRequest({type: 'get_states'})` in WebSocket mode.

### handleMessage(line 69)
- **Signature**: `(message, authToken, resolveConnection, rejectConnection)`
- **Contract**: Processes WebSocket messages: `auth_required` → sends auth, `auth_ok` → resolves, `auth_invalid` → rejects, `result` → resolves/rejects pending request, `event` → notifies state update callbacks.

### onStateUpdate(line 649)
- **Signature**: `(callback)`
- **Contract**: Registers a callback for state updates. Callbacks stored in `this.stateUpdateCallbacks` array.

### notifyStateUpdate(line 653)
- **Signature**: `(data)`
- **Contract**: Calls all registered state update callbacks.

### renameGroup(line 379)
- **Signature**: `(oldName, newName)`
- **Contract**: Renames a group.
- **Service calls**: `callService('climate_scheduler', 'rename_group', {old_name, new_name})`

### renameProfile(line 612)
- **Signature**: `(scheduleId, oldName, newName)`
- **Contract**: Renames a profile.
- **Service calls**: `callService('climate_scheduler', 'rename_profile', {schedule_id, old_name, new_name})`

### removeFromGroup(line 393)
- **Signature**: `(groupName, entityId)`
- **Contract**: Removes entity from group.
- **Service calls**: `callService('climate_scheduler', 'remove_from_group', {schedule_id, entity_id})`

### runDiagnostics(line 639)
- **Signature**: `()`
- **Contract**: Runs integration diagnostics. Returns raw result.
- **Service calls**: `callService('climate_scheduler', 'diagnostics', {}, true)`

### saveSettings(line 551)
- **Signature**: `(settings)`
- **Contract**: Saves settings to backend. Serializes settings as JSON string in `settings` param.
- **Service calls**: `callService('climate_scheduler', 'save_settings', {settings: JSON.stringify(settings)})`
- **Edge cases**: Settings are JSON-stringified, not passed as structured data.

### send(line 142)
- **Signature**: `(message)`
- **Contract**: Sends a message over WebSocket. Throws if not connected.
- **Edge cases**: No reconnect logic — if connection drops, all subsequent calls fail silently.

### sendRequest(line 150)
- **Signature**: `(message)`
- **Contract**: Sends a request and waits for response. In hass mode uses `hass.callWS`. In WebSocket mode, assigns incrementing `messageId`, stores pending `{resolve, reject}` in `this.pendingRequests`, and sets 30s timeout.
- **State**: Reads `this.hass`, `this.usingHassObject`; writes `this.messageId`, `this.pendingRequests`.
- **Edge cases**: 30s timeout deletes pending request and rejects. If HA is slow, may time out.

### setActiveProfile(line 620)
- **Signature**: `(scheduleId, profileName)`
- **Contract**: Sets the active profile for a schedule/group.
- **Service calls**: `callService('climate_scheduler', 'set_active_profile', {schedule_id, profile_name})`

### setGroupSchedule(line 410)
- **Signature**: `(groupName, nodes, day = null, scheduleMode = null, profileName = null)`
- **Contract**: Saves a group schedule. Guards against null `groupName` (throws). Passes optional `day`, `schedule_mode`, `profile_name` in service data. Extensive debug logging with timing.
- **Service calls**: `callService('climate_scheduler', 'set_group_schedule', {schedule_id, nodes, day?, schedule_mode?, profile_name?})`
- **Edge cases**: Throws on null groupName — critical guard. Does NOT pass `return_response`, so backend errors are silently swallowed (callService returns undefined).

### setHassObject(line 20)
- **Signature**: `(hass)`
- **Contract**: Stores hass object and sets `usingHassObject = true`.

### setIgnored(line 359)
- **Signature**: `(entityId, ignored)`
- **Contract**: Sets entity ignored/monitored status.
- **Service calls**: `callService('climate_scheduler', 'set_ignored', {schedule_id, ignored})`

### setLogLevel(line 239)
- **Signature**: `(level = 'debug')`
- **Contract**: Sets `custom_components.climate_scheduler` log level.
- **Service calls**: `callService('logger', 'set_level', {'custom_components.climate_scheduler': level})`

### setSchedule(line 265)
- **Signature**: `(entityId, nodes, day = null, scheduleMode = null)`
- **Contract**: Saves an entity schedule (legacy path for entity-only, not groups).
- **Service calls**: `callService('climate_scheduler', 'set_schedule', {schedule_id, nodes, day?, schedule_mode?})`

### subscribeToEvents(line 663)
- **Signature**: `(eventType, callback)`
- **Contract**: Subscribes to HA events. In hass mode uses `hass.connection.subscribeEvents`. In WebSocket mode, warns and returns null.
- **Edge cases**: WebSocket mode event subscription is unimplemented — profile change events only work in custom panel mode.

### subscribeToStateChanges(line 507)
- **Signature**: `()`
- **Contract**: In hass mode, resolves immediately (state handled by hass). In WebSocket mode, sends `subscribe_events` request.
- **Edge cases**: WebSocket subscription result is not tracked for unsubscribe.

### testFireEvent(line 332)
- **Signature**: `(groupName, node, day)`
- **Contract**: Fires a test schedule event. Node is JSON-stringified.
- **Service calls**: `callService('climate_scheduler', 'test_fire_event', {schedule_id, node: JSON.stringify(node), day})`

## Critical State

| Variable | Type | Contract |
|---|---|---|
| `this.connection` | `WebSocket \| null` | Raw WebSocket connection (null in hass mode) |
| `this.hass` | `Object \| null` | HA hass object (set in custom panel mode) |
| `this.usingHassObject` | `boolean` | True = custom panel mode; False = WebSocket mode |
| `this.messageId` | `number` | Auto-incrementing request ID for WebSocket mode |
| `this.pendingRequests` | `Map<id, {resolve, reject}>` | Outstanding WebSocket requests |
| `this.stateUpdateCallbacks` | `Array<function>` | State change callback list |

## Service Call Reference

All `climate_scheduler` services called from this file:
| Service | Method(s) | return_response? |
|---|---|---|
| `get_schedule` | `getSchedule` | Yes |
| `set_schedule` | `setSchedule` | No |
| `enable_schedule` | `enableSchedule` | No |
| `disable_schedule` | `disableSchedule` | No |
| `advance_schedule` | `advanceSchedule` | No |
| `advance_group` | `advanceGroup` | No |
| `cancel_advance` | `cancelAdvance` | No |
| `get_advance_status` | `getAdvanceStatus` | Yes |
| `clear_advance_history` | `clearAdvanceHistory` | No |
| `test_fire_event` | `testFireEvent` | No |
| `get_override_status` | `getOverrideStatus` | Yes |
| `clear_schedule` | `clearSchedule` | No |
| `set_ignored` | `setIgnored` | No |
| `create_group` | `createGroup` | No |
| `delete_group` | `deleteGroup` | No |
| `rename_group` | `renameGroup` | No |
| `add_to_group` | `addToGroup` | No |
| `remove_from_group` | `removeFromGroup` | No |
| `get_groups` | `getGroups` | Yes |
| `set_group_schedule` | `setGroupSchedule` | No |
| `enable_group` | `enableGroup` | No |
| `disable_group` | `disableGroup` | No |
| `get_settings` | `getSettings` | Yes |
| `save_settings` | `saveSettings` | No |
| `cleanup_derivative_sensors` | `cleanupDerivativeSensors` | Yes |
| `cleanup_orphaned_climate_entities` | `cleanupOrphanedClimateEntities` | Yes |
| `cleanup_unmonitored_storage` | `cleanupUnmonitoredStorage` | Yes |
| `create_profile` | `createProfile` | No |
| `delete_profile` | `deleteProfile` | No |
| `rename_profile` | `renameProfile` | No |
| `set_active_profile` | `setActiveProfile` | No |
| `get_profiles` | `getProfiles` | Yes |
| `diagnostics` | `runDiagnostics` | Yes |

Also calls: `logger.set_level`, `climate.set_temperature`, `climate.set_hvac_mode`, `climate.set_fan_mode`, `climate.set_swing_mode`, `climate.set_preset_mode` (though latter group is in dead code in app.js).

## Known Bugs / Gaps

1. **No WebSocket reconnect**: If the raw WebSocket drops, there's no reconnection logic. All subsequent calls will throw.
2. **WebSocket event subscription is a stub**: `subscribeToEvents` in WebSocket mode warns and returns null — profile change events never arrive in iframe mode.
3. **getHistory WebSocket-only**: `getHistory` uses `sendRequest` but has no `hass` code path — actually it works because `sendRequest` delegates to `hass.callWS` in panel mode.
4. **setGroupSchedule silently swallows backend errors**: Does NOT use `return_response`, so backend validation errors return undefined instead of error details.
5. **30s hardcoded timeout**: WebSocket requests have a 30-second timeout; no way to configure.
6. **settings JSON-stringified**: `saveSettings` double-serializes if caller already passes a string.

## Cross-Module Dependencies

- **app.js**: `haAPI` singleton instance used throughout. Created in `initApp()`.
- **panel.js**: Calls `window.initClimateSchedulerApp(hass)` which calls `haAPI.setHassObject(hass)`.
- **utils.js**: No direct dependency (app.js bridges from utils).