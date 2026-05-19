# KNOWLEDGE: app.js

## Purpose
Orchestrator for the Climate Scheduler frontend. 7580 lines managing all application state, schedule CRUD, group/profile management, timeline graph coordination, save pipeline, history loading, UI rendering, event wiring, and settings. Single global-scope file with no modules — all functions and state are in the window/closure scope.

## Key Functions (alphabetical)

### attachEditorEventListeners(line 3150)
- **Signature**: `(editorElement)`
- **Contract**: Wires click handlers on the dynamically-created inline schedule editor (clear, enable, close, delete-node, save-node, advance, ignore, node-time, node-temp up/down, hvac/fan/swing/preset selects, day-period-btn, schedule-mode-dropdown).
- **State**: Reads `currentGroup`, `currentSchedule`, `allGroups`, `currentScheduleMode`, `currentDay`, `editingProfile`, `graph`, `defaultScheduleSettings`.
- **Service calls**: `haAPI.setGroupSchedule`, `haAPI.advanceGroup`, `haAPI.cancelAdvance`, `haAPI.clearAdvanceHistory`, `haAPI.setIgnored`, `haAPI.enableGroup`/`disableGroup`, `haAPI.clearSchedule`, `haAPI.setActiveProfile`.
- **Edge cases**: Listener duplication risk — called every time `editGroupSchedule` runs, and elements inside the editor are fresh each time, but if editors aren't properly removed, listeners could leak. Also uses `.cloneNode(true)` + `replaceChild` on some buttons to avoid duplicate listeners.

### checkWorkdayIntegration(line 6415)
- **Signature**: `(settings)`
- **Contract**: Checks HA for `binary_sensor.workday_sensor`. If found, enables workday checkbox; if not, disables with install link. Populates saved setting.
- **State**: Reads `haAPI.hass`, writes `#use-workday-integration` checkbox state.
- **Service calls**: None directly; reads `hass.states`.
- **Edge cases**: Waits 1s and retries if `hass` not ready — race condition possible.

### clearScheduleForEntity(line 4041)
- **Signature**: `(entityId)`
- **Contract**: Resets entity schedule to `defaultScheduleSettings`, saves via `haAPI.setSchedule`, updates local state + graph.
- **State**: Reads `defaultScheduleSettings`, `currentDay`, `currentScheduleMode`; writes `entitySchedules`, `currentSchedule`.
- **Service calls**: `haAPI.setSchedule`.
- **Edge cases**: Entity-only path is legacy; most scheduling now goes through groups.

### clearScheduleForGroup(line 4068)
- **Signature**: `(groupName)`
- **Contract**: Resets group schedule to default for all days based on `scheduleMode` (all_days, 5/2, individual). Makes separate `setGroupSchedule` calls per day.
- **State**: Reads `allGroups[groupName]`, `defaultScheduleSettings`; writes `allGroups[groupName].schedules`, `currentSchedule`.
- **Service calls**: `haAPI.setGroupSchedule` (1 call for all_days, 2 for 5/2, 7 for individual).
- **Edge cases**: Individual mode makes 7 sequential API calls — slow, no batching.

### cloneScheduleNodes(line 960)
- **Signature**: `(nodes)`
- **Contract**: Shallow-clones each node `{ ...node }`. Does NOT deep-clone nested arrays.

### collapseAllEditors(line 3125)
- **Signature**: `()`
- **Contract**: Removes all `.schedule-editor-inline` elements from DOM, resets `currentGroup = null`, hides `#node-settings-panel`, clears `nodeSettingsTimeline = null`.
- **State**: Writes `currentGroup`, `nodeSettingsTimeline`.

### convertAllSchedules(line 6370)
- **Signature**: `(fromUnit, toUnit)`
- **Contract**: Converts all entity schedules and group schedules between °C/°F. Iterates every entity in `entitySchedules` and every group in `allGroups`, reading and rewriting schedules day by day.
- **State**: Reads `entitySchedules`, `allGroups`.
- **Service calls**: `haAPI.getSchedule`, `haAPI.setSchedule`, `haAPI.getGroups`, `haAPI.setGroupSchedule`.

### convertScheduleNodes(line 36)
- **Signature**: `(nodes, fromUnit, toUnit)`
- **Contract**: Returns new array with `temp` converted and normalized via `graphSnapStep`.

### copySchedule(line ~3990)
- **Signature**: `()`
- **Contract**: Copies `currentSchedule` (or graph keyframes → nodes) into global `scheduleClipboard`. Updates paste button states.
- **State**: Reads `currentSchedule`, `graph.keyframes`; writes `scheduleClipboard`.
- **Edge cases**: Copies whatever is in `currentSchedule` — if profile editing is active, copies the profile's schedule.

### createGroupContainer(line 559)
- **Signature**: `(groupName, groupData)`
- **Contract**: Builds DOM for a group header with toggle, profile dropdown, enable/disable switch, rename button. Returns container element.
- **State**: Reads `allGroups[groupName]`; writes click handlers that call `editGroupSchedule`, `haAPI.enableGroup`/`disableGroup`, `haAPI.setActiveProfile`.
- **Edge cases**: Profile dropdown `change` handler reloads all groups then re-edits if current group matches — potential for cascading reloads.

### createScheduleEditor(line 3015)
- **Signature**: `()`
- **Contract**: Creates and returns a div `.schedule-editor-inline` with HTML for entity status, graph container, node-settings panel, editor header. Does NOT wire events (that's `attachEditorEventListeners`).
- **State**: None directly; returns DOM element.

### createSettingsPanel(line 1621)
- **Signature**: `(groupData, editor)`
- **Contract**: Builds schedule settings panel (Undo, Copy, Paste, Clear Advance, Unmonitor, Clear, Enabled toggle) as a collapsible section. Returns container.
- **State**: Reads `groupData.entities.length` for single-entity check.

### createTimelineEditor(line 2906)
- **Signature**: `(config{idPrefix, buttons, minValue, maxValue, snapValue, title, yAxisLabel, xAxisLabel, showCurrentTime, tooltipMode, showHeader, allowCollapse, showModeDropdown?})`
- **Contract**: Creates a `<keyframe-timeline>` element, builds a header with mode dropdown + day buttons, and a toolbar with the specified buttons. Returns `{container, timeline, controls}`.
- **State**: Reads `currentScheduleMode`, `currentDay`; writes mode change handler that calls `switchScheduleMode`.

### createPresetOnlyNotice(line 2335)
- **Signature**: `(entityIds, groupName)`
- **Contract**: Checks if any entities in the group are preset-mode-only (no temperature support). Returns a notice div or null.
- **State**: Reads `climateEntities`.

### createGroupMembersTable(line 2425)
- **Signature**: `(entityIds)`
- **Contract**: Builds an HTML table of group members showing entity name, current temp, target temp, scheduled temp, override status, advance status. Returns table element.

### editGroupSchedule(line 1321)
- **Signature**: `(groupName, day = null)`
- **Contract**: Main entry point for editing a group. Fetches fresh groups data, sets `isLoadingSchedule=true`, collapses other editors, sets `currentGroup`/`currentScheduleMode`/`currentDay`, creates editor, creates timeline, loads nodes for the day, loads history, loads advance status, updates UI, then sets `isLoadingSchedule=false` + `flushPendingSaveIfNeeded()`.
- **State**: Reads `allGroups`; writes `currentGroup`, `currentScheduleMode`, `currentDay`, `currentSchedule`, `isLoadingSchedule`, `graph`, `editingProfile`, `nodeSettingsTimeline`.
- **Service calls**: `haAPI.getGroups`, `haAPI.setGroupSchedule` (via save), `haAPI.getHistory` (via `loadGroupHistoryData`), `haAPI.getAdvanceStatus`.
- **Edge cases**: **currentSchedule-overwrite risk** — sets `currentSchedule = nodes.map(n => ({...n}))` which overwrites any unsaved in-memory edits. If a debounced save hasn't flushed, the overwrite is silent. The `isLoadingSchedule` flag is meant to block saves during loading, but there's a window between setting `isLoadingSchedule=false` and `flushPendingSaveIfNeeded()` executing.

### flushPendingSaveIfNeeded(line 139)
- **Signature**: `()`
- **Contract**: If `!isLoadingSchedule && !isSaveInProgress && pendingSaveNeeded`, clears flag and calls `saveSchedule()`.
- **State**: Reads/writes `isLoadingSchedule`, `isSaveInProgress`, `pendingSaveNeeded`.

### getDocumentRoot(line 7)
- **Signature**: `()`
- **Contract**: Returns `window.climateSchedulerPanelRoot?.shadowRoot` or panel element or `document`. Determines DOM query scope for all UI operations.
- **Edge cases**: Must be called every time — the root may change.

### getGraphNodes(line 880)
- **Signature**: `()`
- **Contract**: Returns `currentSchedule` (NOT graph keyframes) to preserve all non-temp properties.
- **State**: Reads `currentSchedule`.
- **Edge cases**: **Critical** — returns `currentSchedule` not graph.keyframes, because keyframes don't carry hvac_mode, fan_mode, etc. If `currentSchedule` is stale, saved data will be stale.

### getMainEditorDisplayedDay(line 1041)
- **Signature**: `(scheduleMode)`
- **Contract**: Returns the day key currently displayed in the main editor UI. Falls back to today's day based on server time.

### getModeTransitionSeedNodes(line 967)
- **Signature**: `({schedules, previousMode, previousDay, newMode, newDay, currentNodes})`
- **Contract**: Returns cloned nodes to seed a mode/day transition. Priority: target day in new mode → other days in new mode → current nodes → previous mode fallback → any populated schedule.
- **Edge cases**: Complex 6-level fallback — may return unexpected nodes if schedule data is sparse.

### getPreviousDayLastTemp(line 4326)
- **Signature**: `(groupData, currentDayParam)`
- **Contract**: Looks up the last non-noChange temperature node from the previous day's schedule. Returns null for all_days mode.

### getScheduleNodesForDay(line 948)
- **Signature**: `(schedules, dayKey)`
- **Contract**: Returns `schedules[dayKey]` with fallbacks: weekday→mon, weekend→sat.
- **Edge cases**: Falls back silently — may return wrong day's nodes without warning.

### handleDefaultNodeSettings(line 7268)
- **Signature**: `(event)`
- **Contract**: Populates default schedule node settings panel with aggregated modes from all climate entities. Auto-saves on dropdown change.

### handleDefaultScheduleChange(line 6681)
- **Signature**: `(event)`
- **Contract**: Converts keyframes to schedule nodes, updates `defaultScheduleSettings`, auto-saves settings.

### handleGraphChange(line 4784)
- **Signature**: `(event, force = false)`
- **Contract**: Updates scheduled temp display, calls `saveSchedule()`. **Dead code after line 4793** — `await saveSchedule(); return savePromise;` exits early, so the thermostat immediate-update logic below is unreachable.
- **Edge cases**: The thermostat sync code (lines 4796-4983) is DEAD CODE — never executes because of early return.

### handleKeyframeTimelineChange(line 4987)
- **Signature**: `(event)`
- **Contract**: On canvas graph change, converts keyframes to schedule nodes, updates `currentSchedule`, sets a debounce timer (SAVE_DEBOUNCE_MS), then calls `saveSchedule()`.
- **State**: Reads `isLoadingSchedule`; writes `currentSchedule`, `saveTimeout`.
- **Edge cases**: **node-action-wrong-timeline risk** — this handler is shared across main, profile, and default timelines via `addEventListener`. If `graph` points to wrong timeline, `currentSchedule` gets wrong data.

### handleNodeSettings(line 5848)
- **Signature**: `(event)`
- **Contract**: Builds the node settings dialog using `climate-control-dialog` custom element. Captures undo state before discrete changes (hvac-mode, noChange, fan, preset, swing, aux_heat). Auto-saves on discrete changes; defers save to slider-commit for continuous changes (temperature, humidity).
- **State**: Reads `currentSchedule`, `currentGroup`, `allGroups`, `climateEntities`, `inputTempStep`, `humidityStep`; writes `graph`, `nodeSettingsTimeline`, `currentSchedule` (via dialog event handlers).
- **Service calls**: `saveSchedule()` (via dialog event handlers).
- **Edge cases**: **profile-edit-leak risk** — dialog event handlers write to `scheduleNode` (a reference into `currentSchedule`) and also to `keyframe`. If the user edits a profile and then switches away, the dialog handlers still reference the old scheduleNode. The `captureDialogUndoState` guards against some undo issues but is only per-dialog-open.

### handleProfileChanged(line 6206)
- **Signature**: `(event)`
- **Contract**: Responds to `climate_scheduler_profile_changed` events from backend. Reloads groups, updates dropdown, re-edits if current group matches.

### handleStateUpdate(line 5096)
- **Signature**: `(data)`
- **Contract**: On HA state change, updates `climateEntities` array, calls `updateEntityCard` and `updateGroupMemberRow`.

### initApp(line 222)
- **Signature**: `()`
- **Contract**: Main async init. Creates `haAPI`, connects, gets config (temp unit, timezone), loads climate entities, loads all schedules, loads groups, subscribes to state changes and profile events, sets up event listeners.
- **State**: Writes `haAPI`, `temperatureUnit`, `serverTimeZone`, `climateEntities`, `allGroups`, `entitySchedules`.
- **Service calls**: `haAPI.connect`, `haAPI.getConfig`, `haAPI.getClimateEntities`, `haAPI.getSchedule` (N times), `haAPI.getGroups`, `haAPI.subscribeToStateChanges`, `haAPI.subscribeToEvents`.
- **Edge cases**: If any step fails, shows error UI and stops.

### initializeDefaultScheduleGraph(line 6240)
- **Signature**: `()`
- **Contract**: Creates the default schedule timeline editor in the Settings panel. Loads keyframe-timeline, builds timeline, sets keyframes from `defaultScheduleSettings`, wires change listeners.
- **State**: Reads `defaultScheduleSettings`, `minTempSetting`, `maxTempSetting`, `graphSnapStep`, `tooltipMode`; writes `defaultScheduleGraph`.

### keyframesToScheduleNodes(line 840)
- **Signature**: `(keyframes)`
- **Contract**: Converts canvas keyframes `{time: decimal, value, ...}` to schedule nodes `{time: "HH:MM", temp, ...}`. Clamps time to 23:59. Merges non-temp properties from `currentSchedule` (finds by matching time). Mirrors keyframe metadata (hvac_mode, fan_mode, etc.) back.
- **State**: Reads `currentSchedule` to find existing nodes and merge properties.
- **Edge cases**: **Critical merge** — if two nodes share the same time string, `currentSchedule.find(n => n.time === timeStr)` returns the FIRST match, which may not be the correct one if the schedule has duplicate times.

### loadAllSchedules(line 309)
- **Signature**: `()`
- **Contract**: Sequentially fetches schedules for all climate entities, stores in `entitySchedules` Map if they have nodes and aren't ignored.
- **State**: Writes `entitySchedules`.
- **Service calls**: `haAPI.getSchedule` per entity.
- **Edge cases**: Sequential loop — O(N) API calls, no parallelism.

### loadClimateEntities(line 297)
- **Signature**: `()`
- **Contract**: Fetches climate entities, renders entity list.
- **State**: Writes `climateEntities`.
- **Service calls**: `haAPI.getClimateEntities`.

### loadClimateDialog(line 3102)
- **Signature**: `()`
- **Contract**: Loads `climate-dialog.js` script if not already loaded. Sets `window.climateDialogLoaded`.

### loadGroupHistoryData(line 4589)
- **Signature**: `(entityIds)`
- **Contract**: Fetches HA history for each entity in group, converts to server timezone, builds `backgroundGraphs` data for graph overlay.
- **State**: Reads `serverTimeZone`, `climateEntities`.
- **Service calls**: `haAPI.getHistory` per entity.

### loadGroups(line 334)
- **Signature**: `()`
- **Contract**: Fetches groups, normalizes payload, renders groups + ignored entities + global profile editor + entity list.
- **State**: Writes `allGroups`.
- **Service calls**: `haAPI.getGroups`.

### loadHistoryData(line 4527)
- **Signature**: `(entityId)`
- **Contract**: Fetches HA history for a single entity, parses `current_temperature` from attributes, converts timestamps.
- **Service calls**: `haAPI.getHistory`.

### loadKeyframeTimeline(line 762)
- **Signature**: `()`
- **Contract**: Dynamically loads `keyframe-timeline.js` module script. Sets `keyframeTimelineLoaded = true`.

### loadProfiles(line 2291)
- **Signature**: `(container, targetId)`
- **Contract**: Fetches groups, populates profile dropdown, wires new/rename/delete profile buttons.

### loadSettings(line 6500)
- **Signature**: `()`
- **Contract**: Fetches settings, handles temperature unit conversion (if stored unit differs from HA config unit), loads default schedule, tooltip mode, derivative sensor setting, workday integration, min/max temps.
- **State**: Writes `storedTemperatureUnit`, `temperatureUnit`, `defaultScheduleSettings`, `tooltipMode`, `minTempSetting`, `maxTempSetting`.
- **Service calls**: `haAPI.getSettings`, `haAPI.saveSettings` (if unit conversion needed), `convertAllSchedules` (if unit conversion needed).

### normalizeGroupsPayload(line 16)
- **Signature**: `(result)`
- **Contract**: Extracts `.groups` from `{groups: {...}}` wrapper, returns `{}` on failure.

### normalizeTemperature(line 65)
- **Signature**: `(value, step = null)`
- **Contract**: Snaps value to step if provided, roundToPrecision based on step precision. Falls back to 4 decimal places.

### pasteSchedule(line 4012)
- **Signature**: `()`
- **Contract**: Deep-copies `scheduleClipboard` into `currentSchedule`, updates graph, immediately saves.
- **State**: Writes `currentSchedule`, calls `setGraphNodes`.
- **Edge cases**: **pending-save-dropped risk** — calls `await saveSchedule()` directly, which goes through debounce. If a pending save was flagged, it may conflict.

### performSave(line 4703)
- **Signature**: `()`
- **Contract**: Actual save logic. Sets `isSaveInProgress=true`. For group saves: gets nodes from `getGraphNodes()`, determines target profile (editing vs active), calls `haAPI.setGroupSchedule`, updates local cache, calls enable/disable group. On failure, shows toast. Finally sets `isSaveInProgress=false` and re-triggers `saveSchedule()` if `pendingSaveNeeded`.
- **State**: Reads `currentGroup`, `currentSchedule` (via `getGraphNodes`), `allGroups`, `editingProfile`, `isLoadingSchedule`; writes `allGroups[groupName].schedules[currentDay]`, `isSaveInProgress`, `pendingSaveNeeded`.
- **Service calls**: `haAPI.setGroupSchedule`, `haAPI.enableGroup`/`disableGroup`.
- **Edge cases**: **pending-save-dropped risk** — if `performSave` fails but `isSaveInProgress` is set to false, the pending save retry in `finally` may not execute correctly. Also, local cache update `allGroups[currentGroup].schedules[currentDay] = JSON.parse(JSON.stringify(nodes))` may race with a concurrent `loadGroups` refresh.

### refreshGlobalProfileEditor(line 1765)
- **Signature**: `()`
- **Contract**: Calls `setupProfileHandlers` on the global profile container.

### renderEntityList(line 2883)
- **Signature**: `()`
- **Contract**: Renders the entity list in the sidebar. Groups entities by whether they're in a monitored group.
- **State**: Reads `climateEntities`, `allGroups`, `entitySchedules`.

### renderGroups(line 358)
- **Signature**: `()`
- **Contract**: Rebuilds the groups list DOM. Saves/restores expanded state. Filters out single-entity ignored groups.
- **State**: Reads `allGroups`.

### renderIgnoredEntities(line 423)
- **Signature**: `()`
- **Contract**: Shows entities not in any monitored group under "Unmonitored" section.
- **State**: Reads `climateEntities`, `allGroups`.
- **Service calls**: `haAPI.setIgnored`, `haAPI.getSchedule`, `haAPI.addToGroup` (via modal confirm).

### resolveModeTransitionDay(line 1060)
- **Signature**: `(previousMode, previousDay, newMode)`
- **Contract**: Maps the current editing day from old mode to new mode (e.g., individual 'fri' → 5/2 'weekday').

### resolveNoChangeLockedTemp(line 78)
- **Signature**: `(nodes, targetNode)`
- **Contract**: For noChange nodes, resolves what temperature to display. Single-node → own temp. Multi-node → previous node's temp (sorted by time).

### saveSchedule(line 4674)
- **Signature**: `()`
- **Contract**: Debounced save entry point. If `isLoadingSchedule`, queues `pendingSaveNeeded`. If `isSaveInProgress`, queues `pendingSaveNeeded`. Otherwise, clears any existing timeout and sets a new one for `SAVE_DEBOUNCE_MS` → `performSave()`.
- **State**: Reads `isLoadingSchedule`, `isSaveInProgress`; writes `pendingSaveNeeded`, `saveTimeout`.
- **Edge cases**: **pending-save-dropped risk** — if `isLoadingSchedule` is true AND a save is queued, the flag `pendingSaveNeeded` is set. But if the loading finishes and `flushPendingSaveIfNeeded` is called before the user makes another change, the save goes through. However, if multiple changes happen during loading, only one pending save is tracked.

### saveSettings(line 6622)
- **Signature**: `()`
- **Contract**: Reads UI inputs, builds settings object, calls `haAPI.saveSettings`, updates runtime globals (`minTempSetting`, `maxTempSetting`) and graph ranges.

### scheduleNodesToKeyframes(line 798)
- **Signature**: `(nodes)`
- **Contract**: Converts `{time: "HH:MM", temp, ...}` to `{time: decimalHours, value, noChange, hvac_mode, fan_mode, ...}` sorted by time.

### setGraphNodes(line 888)
- **Signature**: `(nodes)`
- **Contract**: Converts nodes to keyframes via `scheduleNodesToKeyframes`, sets `graph.keyframes = [...keyframes]`.

### setMainEditingContext(line 1131)
- **Signature**: `(editorRoot = null)`
- **Contract**: Clears `editingProfile`, switches `graph` to main timeline, optionally reloads `currentSchedule` from group cache (only when transitioning from profile editing).
- **State**: Reads/writes `editingProfile`, `graph`, `currentSchedule`, `currentGroup`.
- **Edge cases**: **profile-edit-leak risk** — only reloads `currentSchedule` from cache if `wasEditingProfile` was true. If the profile editor modified `currentSchedule` and the user clicks a timeline node (triggering setMainEditingContext), those profile edits leak into the main timeline.

### setupEventListeners(line 5268)
- **Signature**: `()`
- **Contract**: Wires all global DOM event listeners: schedule mode radios, day buttons, menu/dropdown, ignored toggle, profile toggle, filter, create group modal, add-to-group modal, convert temp modal, edit group modal. Calls `setupSettingsPanel()`.
- **Edge cases**: **listener-duplication risk** — called once during init but some handlers are not idempotent (e.g., `document.addEventListener('click', ...)` for closing dropdowns).

### setupProfileHandlers(line 1773)
- **Signature**: `(container, groupData)`
- **Contract**: Sets up the profile editor UI: dropdown, New/Rename/Delete buttons, profile timeline with day buttons, save/close, mode dropdown, persist logic.
- **State**: Writes `editingProfile`, `currentSchedule`, `currentScheduleMode`, `currentDay`, `graph`, `profileCurrentSchedule` (closure-local).
- **Service calls**: `haAPI.getGroups`, `haAPI.setGroupSchedule`, `haAPI.createProfile`, `haAPI.deleteProfile`, `haAPI.renameProfile`, `haAPI.setActiveProfile`.
- **Edge cases**: **profile-edit-leak risk** — `syncProfileScheduleFromTimeline` writes to global `currentSchedule`. If the main timeline is active, it may get overwritten.

### setupSettingsPanel(line 6711)
- **Signature**: `()`
- **Contract**: Loads settings, wires settings panel toggles: collapse, debug, tooltip mode, snap step, input step, humidity step, min/max temps, reset, workday, clear default schedule, derivative sensor, cleanup buttons, diagnostics, orphaned entity cleanup, storage cleanup.

### showNodeSettingsPanel(line 1268)
- **Signature**: `(editor, keyframeIndex, keyframe, sourceTimeline = graph)`
- **Contract**: Opens node settings by converting keyframe to node, finding matching schedule node, building event, calling `handleNodeSettings`.
- **State**: Writes `nodeSettingsTimeline`, `graph`.

### showEditingProfileIndicator(line 1689)
- **Signature**: `(editingProfile, activeProfile)`
- **Contract**: Shows/hides "Editing Profile: X" indicator with "Done" button. "Done" loads active profile back and clears `editingProfile`.

### switchDay(line 4470)
- **Signature**: `(day)`
- **Contract**: Switches the day being edited. Updates `currentDay`, reloads nodes from cached group data, sets `isLoadingSchedule` for 100ms, updates graph, updates profile indicator.
- **State**: Reads `allGroups`; writes `currentDay`, `currentSchedule`, `isLoadingSchedule`, `editingProfile`.
- **Edge cases**: **currentSchedule-overwrite** — `currentSchedule = nodes.map(n => ({...n}))` overwrites unsaved changes from the previous day if auto-save hasn't flushed.

### switchScheduleMode(line 4380)
- **Signature**: `(newMode)`
- **Contract**: Switches schedule mode (all_days, 5/2, individual). Resolves transition day, saves seed nodes to backend with new mode, reloads groups, reloads schedule, updates UI.
- **State**: Reads/writes `currentScheduleMode`, `currentDay`, `currentSchedule`, `editingProfile`.
- **Service calls**: `haAPI.setGroupSchedule`, `haAPI.getGroups`.
- **Edge cases**: **node-action-wrong-timeline risk** — saves immediately with seed nodes, which may differ from what's displayed.

### syncAllTemperatures(line 6174)
- **Signature**: `()`
- **Contract**: Calls `climate_scheduler.sync_all` service, shows feedback.

### toggleEntityInclusion(line 5205)
- **Signature**: `(entityId, include)`
- **Contract**: Adds/removes entity from scheduler. Legacy path — mostly unused now that all entities go through groups.

### updateScheduledTemp(line 5008)
- **Signature**: `()`
- **Contract**: Displays current scheduled temperature based on time-of-day interpolation of `currentSchedule` nodes.

### updateScheduleModeUI(line 4142)
- **Signature**: `()`
- **Contract**: Updates mode dropdown, day selector buttons, and graph title to reflect `currentScheduleMode` and `currentDay`.

## Critical State

| Variable | Type | Contract | Risk |
|---|---|---|---|
| `currentSchedule` | `Array<{time, temp, ...}>` | The currently-edited schedule nodes. Written to by many paths — graph changes, profile edits, day switches, mode switches, paste. | **currentSchedule-overwrite** — multiple writers, no authoritative source of truth |
| `currentGroup` | `string \| null` | Name of the group being edited. Set in `editGroupSchedule`, cleared in `collapseAllEditors`. | Single writer pattern, mostly safe |
| `currentDay` | `string` | Day key being edited ('all_days', 'weekday', 'mon', etc.) | Written by `switchDay`, `switchScheduleMode`, `editGroupSchedule`, profile editor |
| `currentScheduleMode` | `string` | 'all_days', '5/2', or 'individual' | Written by `switchScheduleMode`, `editGroupSchedule`, profile editor |
| `editingProfile` | `string \| null` | Profile being edited (null = active profile) | **profile-edit-leak** — write to global `currentSchedule` from profile context |
| `graph` | `HTMLElement \| null` | Reference to the active `<keyframe-timeline>` element | Switched between main, profile, and default timelines |
| `nodeSettingsTimeline` | `HTMLElement \| null` | Timeline that owns the open node settings panel | Can become stale if timeline is removed |
| `isLoadingSchedule` | `boolean` | Blocks saves during schedule loading | Window between false and flush |
| `isSaveInProgress` | `boolean` | Blocks concurrent saves | Properly managed in `performSave` finally block |
| `pendingSaveNeeded` | `boolean` | Queues a retry save if save is blocked | Single-bit — only one pending save tracked |
| `saveTimeout` | `number \| null` | Debounce timeout ID | Cleared and reset properly |
| `allGroups` | `Object` | All group data from backend. Refreshed on many operations. | Stale between refreshes; local cache updates may conflict |
| `entitySchedules` | `Map` | Entity → schedule nodes mapping | Mostly for legacy path |
| `scheduleClipboard` | `Array` | Clipboard for copy/paste | Copied by reference to `currentSchedule` on paste |
| `temperatureUnit` | `string` | '°C' or '°F' from HA config | Set once on init, re-set by conversion |
| `storedTemperatureUnit` | `string \| null` | Unit that schedules are stored in on server | Used for conversion detection |
| `serverTimeZone` | `string \| null` | HA server timezone from config | Set once on init |
| `defaultScheduleSettings` | `Array` | Default schedule nodes for new/cleared schedules | Shared reference risk |
| `minTempSetting` / `maxTempSetting` | `number \| null` | Graph Y-axis range | Updated from settings load/save |
| `graphSnapStep` | `number` | Temperature snap step (0.1, 0.5, 1.0) | Persisted in localStorage |
| `inputTempStep` | `number` | Input field step | Persisted in localStorage |
| `humidityStep` | `number` | Humidity slider step | Persisted in localStorage |

## Save Pipeline

1. **Trigger**: `handleKeyframeTimelineChange` fires on `keyframe-moved`/`keyframe-added`/`keyframe-deleted`/`keyframes-cleared`/`keyframe-restored` events from `<keyframe-timeline>`.
2. **Sync**: `currentSchedule = keyframesToScheduleNodes(keyframes)` updates in-memory nodes from graph keyframes.
3. **Debounce**: `saveSchedule()` checks `isLoadingSchedule` → queue pending. Checks `isSaveInProgress` → queue pending. Otherwise clears existing `saveTimeout` and sets a new `setTimeout(performSave, SAVE_DEBOUNCE_MS)`.
4. **Execute**: `performSave()` sets `isSaveInProgress = true`, gets nodes via `getGraphNodes()` (which returns `currentSchedule`), determines target profile, calls `haAPI.setGroupSchedule(currentGroup, nodes, currentDay, currentScheduleMode, targetProfile)`.
5. **Post-save**: On success, updates local cache `allGroups[currentGroup].schedules[currentDay]`. Calls enable/disable group. Sets `isSaveInProgress = false`. If `pendingSaveNeeded`, re-triggers `saveSchedule()`.
6. **Flush**: `flushPendingSaveIfNeeded()` is called after `isLoadingSchedule` is set to false. If no save is in progress and a pending save exists, it triggers `saveSchedule()`.

**Debounce timing**: `SAVE_DEBOUNCE_MS = 300ms`. Graph changes set their own timeout (also `SAVE_DEBOUNCE_MS`) before calling `saveSchedule()`, resulting in up to 600ms effective debounce.

## Known Bugs / Gaps

1. **DEAD CODE in handleGraphChange** (line 4791-4983): After `await saveSchedule(); return savePromise;` the thermostat immediate-update code is unreachable. This means editing a schedule node does NOT immediately push the new temperature to the thermostat.

2. **profile-edit-leak**: `syncProfileScheduleFromTimeline` writes to global `currentSchedule`. `setProfileEditingContext` also writes global state. If the user is on the main timeline and opens a profile edit, the global `currentSchedule` gets overwritten with profile data.

3. **currentSchedule-overwrite**: `editGroupSchedule` unconditionally sets `currentSchedule = nodes.map(n => ({...n}))`, overwriting any unsaved edits from the current session. The `isLoadingSchedule` flag prevents saves during loading, but doesn't prevent the overwrite.

4. **pending-save-dropped**: `pendingSaveNeeded` is a boolean — only one pending save can be tracked. If multiple changes happen while a save is in progress, only the last one is retried.

5. **listener-duplication**: Some event listeners (document click, profile dropdowns) could accumulate if `setupEventListeners` or `setupProfileHandlers` are called multiple times without cleanup.

6. **Sequential API calls in loadAllSchedules**: O(N) `getSchedule` calls per entity, no parallelism.

7. **clearScheduleForGroup individual mode**: Makes 7 sequential `setGroupSchedule` calls instead of one batched call.

8. **Duplicate time string matching in keyframesToScheduleNodes**: `currentSchedule.find(n => n.time === timeStr)` returns first match, which may not be correct if schedule has duplicate-time nodes.

9. **switchDay doesn't save current day before switching**: Relies on auto-save having already persisted. If debounce hasn't flushed, changes to the previous day are lost silently.

## Cross-Module Dependencies

- **utils.js**: `getServerDate`, `getServerNow`, `utcToServerDate`, `celsiusToFahrenheit`, `fahrenheitToCelsius`, `convertTemperature`, `timeToMinutes`, `minutesToTime`, `formatTimeString`, `adjustTime`, `interpolateTemperature`
- **ha-api.js**: `HomeAssistantAPI` class — all backend communication. `haAPI` is the singleton instance.
- **panel.js**: `ClimateSchedulerPanel` custom element — provides `window.climateSchedulerPanelRoot` DOM root, calls `window.initClimateSchedulerApp(hass)` on connect, calls `window.updateHassConnection(hass)` on hass updates.
- **keyframe-timeline.js**: External `<keyframe-timeline>` web component loaded dynamically. Provides graph rendering, keyframe CRUD events, undo stack, advance history, node-clicked events.
- **climate-dialog.js**: External `<climate-control-dialog>` web component loaded dynamically for node settings dialog. Emits events: `hvac-mode-changed`, `temperature-changed`, `temperature-change-committed`, `no-temp-change-changed`, `fan-mode-changed`, `preset-mode-changed`, `swing-mode-changed`, `swing-horizontal-mode-changed`, `aux-heat-changed`, `humidity-changed`, `humidity-committed`, `target-temp-low-changed`, `target-temp-low-committed`, `target-temp-high-changed`, `target-temp-high-committed`.