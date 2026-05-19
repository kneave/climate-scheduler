# KNOWLEDGE: Panel (TypeScript Source)

**Source of Truth:** `src/panel.ts` (per ADR-001)  
**Build Artifact:** `custom_components/climate_scheduler/frontend/panel.js` (not reviewed — separate from the requested panel.ts analysis)  
**Lines:** TS=639

---

## Purpose

Custom element `<climate-scheduler-panel>` — the main panel for Climate Scheduler, registered as a Home Assistant custom panel. This is **NOT a LitElement** — it extends `HTMLElement` directly with imperative DOM manipulation. It serves as:

1. **Script loader**: Loads `utils.js`, `ha-api.js`, then `app.js` in sequence via `<script>` injection
2. **CSS loader**: Loads `styles.css` relative to module URL
3. **Theme bridge**: Applies HA dark/light mode to `data-theme` attribute
4. **HA connection bridge**: Passes `hass` object to `window.initClimateSchedulerApp()` and `window.updateHassConnection()`
5. **Version checker**: Same stale-cache detection IIFE as the card, but uses `CustomEvent` (correctly)
6. **Shell HTML renderer**: Contains the full static HTML skeleton for the UI (entity selector, profiles, modals, settings, keyframe timeline, graph area, footer)

---

## Key Functions

| Method | Description |
|--------|-------------|
| `connectedCallback()` | Calls `render()`, stores global reference, loads scripts, initializes app |
| `set hass(value)` | Applies theme (dark/light), passes `hass` to app via `window.updateHassConnection()` |
| `get hass()` | Returns stored `_hass` |
| `render()` | Creates CSS `<link>`, builds entire HTML skeleton as `innerHTML`, appends to element |

### Script Loading
| Function | Description |
|----------|-------------|
| `loadScript(src)` | Creates `<script>` element, appends to `<head>`, returns Promise |
| `loadScripts()` | Loads `utils.js` + `ha-api.js` in parallel, then `app.js` sequentially. Uses `import.meta.url` for base path. |
| `getVersion()` | Parses version from `import.meta.url`: comma-separated → returns timestamp part; otherwise returns version as-is |

### Version Check (IIFE at module load)
- Same pattern as card's version check
- **Uses `CustomEvent`** (correct, unlike card's `Event`)
- Dispatches `hass-notification` with persistent message
- SessionStorage dedup

---

## Critical State

### Properties (HTMLElement pattern, not Lit)
| Property | Type | Notes |
|----------|------|-------|
| `_hass` | `HassObject \| null` | Private, set via setter |
| `narrow` | `boolean` | HA panel property |
| `panel` | `any` | HA panel config |

### Static Properties Declaration
```typescript
static get properties() {
  return {
    hass: { type: Object },
    narrow: { type: Boolean },
    route: { type: Object },
    panel: { type: Object }
  };
}
```
(These are declared for HA's property system but the element doesn't use Lit's reactivity.)

### Global Window Interfaces
```typescript
interface Window {
  climateSchedulerPanelRoot: ClimateSchedulerPanel;
  initClimateSchedulerApp?: (hass: HassObject) => void;
  updateHassConnection?: (hass: HassObject) => void;
}
```

---

## HTML Skeleton Structure

The `render()` method builds a large `innerHTML` string containing:

1. **Entity Selector Section** (`<section class="entity-selector">`)
   - **Monitored list** (`#groups-list`) — dynamically populated
   - **Profiles section** (`#global-profile-container`) — collapsible, with dropdown + new/rename/delete buttons
   - **Unmonitored section** (`#ignored-container`) — collapsible, with filter input

2. **Modals** (all `style="display: none"`)
   - `#confirm-modal` — Clear schedule confirmation
   - `#create-group-modal` — New group creation
   - `#add-to-group-modal` — Add entity to existing or new group
   - `#convert-temperature-modal` — °C↔°F conversion with unit radio buttons
   - `#edit-group-modal` — Rename/delete group

3. **Instructions** (collapsible)
   - Double-click to add, drag to move, segment drag, copy/paste, tap for settings

4. **Settings Panel** (collapsible)
   - Group Management: Create new group button
   - Default Schedule: `<keyframe-timeline>` with `showHeader="false"`
   - Graph Options: Tooltip mode dropdown, Min/Max temp inputs, Debug panel toggle
   - (More settings in the lines beyond 500 — truncated)

5. **Keyframe Timeline + Graph Area** (in the remaining portion beyond line 500)

6. **Footer** with `#version-info`

---

## Known Bugs / Gaps

1. **Not a LitElement**: The panel uses raw `HTMLElement` with `innerHTML`. This means:
   - No Lit reactivity — `hass` setter manually propagates
   - All DOM updates are imperative (from `app.js`)
   - No shadow DOM — styles can leak in/out
   - The `<keyframe-timeline>` inside is a LitElement in a non-Lit host — this works but is architecturally inconsistent

2. **innerHTML XSS risk**: The `render()` method uses `innerHTML` to build a large static template. While the content is currently static (no user input interpolated), this pattern is fragile if any dynamic content is added later.

3. **Dual `.version` fetch**: `_loadPanel()` in the card fetches `/climate_scheduler/static/.version` for the test response, then fetches it again for the version string. The panel's constructor doesn't do this (the version check IIFE does a separate fetch). This means on first load, `.version` may be fetched 2-3 times.

4. **`loadScript()` Promise**: If script loading fails, only the first rejection is caught. The `loadScripts()` chain uses `Promise.all` for utils+ha-api, then `.then()` for app.js. If utils or ha-api fail, app.js is never attempted, but the error message won't be specific about which script failed.

5. **Theme bridge is global**: The `set hass()` modifier sets `document.documentElement.setAttribute('data-theme', 'light')` for light mode. This affects the entire document, not just the panel. Could conflict with other custom cards.

6. **No `disconnectedCallback`**: The panel never cleans up: no removal of global window references (`climateSchedulerPanelRoot`, `initClimateSchedulerApp`, `updateHassConnection`), no script cleanup. If the panel is removed and re-added, the global reference is overwritten (acceptable), but the old panel's event listeners on scripts may leak.

7. **100ms delay after script load**: `connectedCallback()` has `await new Promise(resolve => setTimeout(resolve, 100))` — a heuristic to "ensure DOM is fully rendered." This is brittle; should use `requestAnimationFrame` or `MutationObserver`.

8. **panel.js is not built from panel.ts**: The build artifact `panel.js` is likely a separate bundle that includes `panel.ts` compiled output, but the panel itself loads `utils.js`, `ha-api.js`, and `app.js` as separate `<script>` files. These non-Lit scripts are the actual application logic — the TypeScript panel is just a loader/shell.

---

## Cross-Module Dependencies

| Dependency | Direction | Notes |
|------------|-----------|-------|
| `utils.js` | ← (script load) | Utility functions loaded first |
| `ha-api.js` | ← (script load) | Home Assistant API wrapper loaded second |
| `app.js` | ← (script load) | Main application logic loaded last |
| `styles.css` | ← (CSS link) | Theme stylesheet |
| `climate-scheduler-card.ts` | → (dynamic import target) | Card loads this panel via `import()` |
| `keyframe-timeline.ts` | → (embedded) | Panel HTML contains `<keyframe-timeline>` elements |
| `climate-dialog.ts` | → (used by app.js) | Dialog is instantiated by app.js, not directly by panel.ts |
| Home Assistant | → (panel registration) | HA registers panel via `customElements.define()` |

---

## Architectural Notes

The panel is the **boundary between two architectures**:
- **Lit world**: `climate-scheduler-card`, `keyframe-timeline`, `climate-dialog` — all LitElements with shadow DOM, reactive properties, declarative templates
- **Vanilla JS world**: `utils.js`, `ha-api.js`, `app.js` — imperative DOM manipulation, global state, no module bundling

The panel.ts bridges these: it's a vanilla HTMLElement shell that loads the Lit components (timeline, dialog) as custom elements and passes the HA connection through globals. This design likely predates the Lit migration — the original app was vanilla JS, and Lit components were added incrementally.

**No compiled JS artifact comparison**: The task specified panel.ts analysis only (no `panel.js` build artifact review). The build artifact at `frontend/panel.js` is likely the compiled version that also bundles the script-loading logic, but this was not requested for comparison.