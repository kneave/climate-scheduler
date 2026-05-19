# KNOWLEDGE: panel.js

## Purpose
Home Assistant custom panel custom element (`ClimateSchedulerPanel`). Provides the HTML skeleton for the entire Climate Scheduler UI, version checking with cache-bust notifications, script/CSS loading orchestration, theme management, and the `hass` object lifecycle. 598 lines. This is the entry point that HA loads as a panel — it creates the DOM structure that app.js then populates and manages.

## Key Functions (alphabetical)

### connectedCallback(line 106)
- **Signature**: `()`
- **Contract**: HA calls this when the panel element is inserted into the DOM. Calls `render()`, stores `window.climateSchedulerPanelRoot = this`, loads scripts (utils.js → ha-api.js → app.js), waits 100ms for DOM, updates version info, then calls `window.initClimateSchedulerApp(this.hass)`.
- **State**: Reads `this.hass`; writes `window.climateSchedulerPanelRoot`.
- **Edge cases**: 100ms delay is a heuristic — may not be enough on slow devices. If scripts fail to load, logs error but doesn't retry.

### constructor(line 91)
- **Signature**: `()`
- **Contract**: Initializes `_hass = null`, `narrow = false`, `panel = null`.

### getVersion(line 55)
- **Signature**: `()`
- **Contract**: Extracts version string from `import.meta.url` query param `v`. If version contains comma (dev: "tag,timestamp"), returns timestamp part. Otherwise returns as-is. Returns null if no version param.
- **Edge cases**: Dev builds use "tag,timestamp" format; production uses just the tag.

### loadScript(line 44)
- **Signature**: `(src)`
- **Contract**: Creates a `<script>` element, appends to `document.head`, returns promise that resolves on load / rejects on error.

### loadScripts(line 69)
- **Signature**: `()`
- **Contract**: Loads utils.js and ha-api.js in parallel (`Promise.all`), then loads app.js after both complete. Sets `scriptsLoaded = true`. Uses `basePath` from `import.meta.url` and appends version query param.
- **State**: Reads `scriptsLoaded`; writes `scriptsLoaded = true`.
- **Edge cases**: If any script fails, rejects and logs error. No retry.

### properties(getter, line 98)
- **Signature**: N/A (static getter)
- **Contract**: Declares `hass`, `narrow`, `route`, `panel` as observed properties for HA's reactive updates.

### render(line 178)
- **Contract**: Creates the full HTML skeleton inside a `.container` div. Only runs once (checks for `.container` existence). Contains:
  - **Entity sidebar**: Groups list with count, global profile editor (collapsible), unmonitored entities (collapsible with filter)
  - **Modals**: Confirm (clear schedule), Create Group, Add to Group, Convert Temperature, Edit Group
  - **Instructions section** (collapsible)
  - **Settings panel** (collapsible): Group Management, Default Schedule (with `<keyframe-timeline>`), Graph Options (tooltip mode, min/max temp, debug panel toggle), Temperature Precision (snap step, input step, humidity step), Derivative Sensors, Workday Integration (checkbox + day-of-week selectors)
  - **Settings actions**: Refresh Entities, Sync All, Reload Integration, Convert Schedules, Run Diagnostics, Cleanup Derivative Sensors, Cleanup Orphaned Entities, Cleanup Unmonitored Storage, Reset to Defaults
  - **Debug panel** (hidden by default)
  - **Footer**: Badge image, version info, author link, coffee link
- **State**: Loads styles.css with version query param.

### set hass(value)(line 154)
- **Contract**: Called by HA when the hass object updates. Stores `this._hass = value`. Applies dark/light theme based on `value.themes.darkMode`. Passes hass to `window.updateHassConnection(value)` if app is already initialized.
- **State**: Writes `this._hass`; modifies `document.documentElement` and `this` theme attributes.
- **Edge cases**: Each hass update re-applies theme attributes — may cause unnecessary DOM mutations if theme hasn't changed.

### Version check IIFE(line 6-42)
- **Contract**: Immediately-invoked async function that compares the loaded script version (from query param) against the server version (fetched from `/climate_scheduler/static/.version`). If mismatch, shows a persistent `hass-notification` custom event and stores the shown version in `sessionStorage`.
- **Edge cases**: Fires `hass-notification` event on `document.body` — relies on HA having a listener for this event type. Only shows notification once per session per version.

## Critical State

| Variable | Type | Contract |
|---|---|---|
| `window.climateSchedulerPanelRoot` | `HTMLElement` | Set to `this` in connectedCallback, used by app.js `getDocumentRoot()` for all DOM queries |
| `scriptsLoaded` | `boolean` | Prevents double-loading of scripts |
| `this._hass` | `Object` | The HA hass object, updated on every state change |
| `sessionStorage.climate_scheduler_refresh_shown` | `string` | Tracks which version's refresh notification was shown |

## DOM Structure Created

The `render()` method creates a comprehensive HTML skeleton with these major sections:
1. **Left sidebar**: `entity-selector` section with groups, profiles, unmonitored
2. **Modals**: 5 modals (confirm, create-group, add-to-group, convert-temperature, edit-group)
3. **Instructions**: Collapsible usage instructions
4. **Settings Panel**: Collapsible with sub-sections for defaults, graph options, precision, derivative sensors, workday
5. **Settings Actions**: Button bar
6. **Debug Panel**: Hidden by default
7. **Footer**: Version, author, coffee link

All element IDs are globally scoped and queried by app.js via `getDocumentRoot().querySelector(...)`.

## Known Bugs / Gaps

1. **No shadow DOM**: Uses regular DOM (no `attachShadow`), so all CSS and IDs are in the global document scope. This means CSS class names and element IDs could clash with HA's own styles or other custom panels. However, `getDocumentRoot()` in app.js does handle shadow DOM if present.
2. **Version check relies on custom event**: `hass-notification` event may not exist in all HA versions.
3. **100ms DOM delay is fragile**: May not be enough on slow connections/devices.
4. **No error boundary**: If `initClimateSchedulerApp` throws, the panel shows a console error but the DOM skeleton remains.
5. **scriptsLoaded guard is per-page-load**: If panel is disconnected and reconnected (HA navigation), scripts may not reload correctly if `scriptsLoaded` is still true but scripts were removed from DOM.
6. **Theme applied on every hass update**: Even if theme hasn't changed, `data-theme` attributes are re-set.

## Cross-Module Dependencies

- **app.js**: `window.initClimateSchedulerApp(hass)` — called on panel connect. `window.updateHassConnection(hass)` — called on hass update. `window.climateSchedulerPanelRoot` — DOM root for all queries.
- **ha-api.js**: Loaded as dependency before app.js.
- **utils.js**: Loaded as dependency before app.js.
- **styles.css**: Loaded via `<link>` with version param.
- **keyframe-timeline.js**: NOT loaded by panel.js; loaded dynamically by app.js on demand.