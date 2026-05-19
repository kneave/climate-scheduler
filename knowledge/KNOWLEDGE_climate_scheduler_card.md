# KNOWLEDGE: Climate Scheduler Card

**Source of Truth:** `src/climate-scheduler-card.ts` (per ADR-001)  
**Build Artifact:** `custom_components/climate_scheduler/frontend/climate-scheduler-card.js`  
**Lines:** TS=252 / JS=312 (includes ~68 lines Lit/runtime preamble + version check IIFE)

---

## Purpose

Custom element `<climate-scheduler-card>` — a Lovelace card wrapper that dynamically loads the full Climate Scheduler panel and embeds it as a card in any dashboard. Handles:

- Version mismatch detection (stale browser cache → persistent notification)
- Integration presence check (verifies `climate_scheduler` services exist)
- Dynamic import of `panel.js` from `/climate_scheduler/static/`
- Version string resolution from multiple sources (`.version` file, `v=` param, `hacstag` param)
- Card registration in the Lovelace card picker (`window.customCards`)

---

## Key Functions

| Method | Description |
|--------|-------------|
| `constructor()` | Calls `_registerCard()` to add card type to `window.customCards` |
| `_registerCard()` | Pushes `{ type, name, description, preview: false }` to `window.customCards` (deduplicates by type) |
| `setConfig(config)` | Stores card config (minimal — just stores the object) |
| `firstUpdated()` | Calls `_loadPanel()` |
| `updated(changed)` | If `hass` changed and panel not loaded, calls `_loadPanel()` |
| `render()` | Error message / "waiting for hass" / "integration not found" / `<climate-scheduler-panel>` embed |
| `_loadPanel()` | Core loader: checks integration, resolves version, dynamic imports `panel.js` |
| `getCardSize()` | Returns 10 (Lovelace card height estimate) |

### Version Resolution Logic (_loadPanel)

1. Check `hass.services?.climate_scheduler !== undefined`
2. Verify `/climate_scheduler/static/.version` returns 200
3. Read `.version` file; if contains comma → dev deployment, use full string as versionString
4. Otherwise, check `v=` URL param, then `hacstag` param
5. Dynamic import: `panel.js?v=${versionString}` (only if `climate-scheduler-panel` not already registered)

### Version Mismatch Detection (IIFE at module load)

- Compares `v=` param of loaded script against `/climate_scheduler/static/.version` server version
- If mismatch: dispatches `hass-notification` event with persistent message
- Uses `sessionStorage` key `climate_scheduler_refresh_shown` to avoid repeated notifications

---

## Critical State

### Reactive Properties
| Property | Type | Attribute | Notes |
|----------|------|-----------|-------|
| `hass` | `any` | Yes (Object) | HA connection object (set by Lovelace) |
| `_config` | `any` | No (`@state`) | Card config from YAML |
| `_hasIntegration` | `boolean` | No (`@state`) | True if `climate_scheduler` services exist |
| `_errorMessage` | `TemplateResult \| string \| null` | No (`@state`) | Error display |
| `_panelLoaded` | `boolean` | No (`@state`) | True after `panel.js` imported |

### Static
| Property | Returns | Notes |
|----------|---------|-------|
| `getConfigElement()` | `null` | No visual editor |
| `getStubConfig()` | `{}` | No default config |

---

## Known Bugs / Gaps

1. **Version check IIFE: `new Event()` vs `new CustomEvent()`**: The TS source creates `new Event('hass-notification', ...)` then assigns `event.detail = {...}`. The compiled JS does the same. However, `Event` doesn't natively support `detail` — this pattern works but is fragile. `CustomEvent` would be more correct (panel.ts uses `CustomEvent` for the same purpose).

2. **Error message type**: `_errorMessage` is typed as `TemplateResult | string | null` in TS. When set in `_loadPanel()` catch block, it's assigned a `html` template. This means it renders as HTML when displayed, which is intentional (it includes `<br>` and styling).

3. **No fallback loading**: If `/climate_scheduler/static/.version` returns non-200, the loader throws immediately. There's no fallback to a standalone CDN or bundled version. This is intentional per the code: "Only accept the integration-hosted static path; do not fallback."

4. **`getCardSize()` returns 10**: This is a static Lovelace hint. The actual height depends on the embedded panel content, which can vary significantly.

5. **Race condition on `_loadPanel`**: If `hass` changes multiple times before panel loads, `_loadPanel()` is called again — but `customElements.get('climate-scheduler-panel')` check and `_panelLoaded` guard prevent double-imports.

---

## Cross-Module Dependencies

| Dependency | Direction | Notes |
|------------|-----------|-------|
| `panel.ts` / `panel.js` | ← (dynamic import) | Card loads the panel as a side-effect import |
| `climate-dialog.ts` | ← (indirect) | Panel uses dialog |
| `keyframe-timeline.ts` | ← (indirect) | Panel uses timeline |
| `lit` / `lit/decorators.js` | ← (framework) | Base class and decorators |
| Home Assistant Lovelace | → (host) | Card registration, `hass` object, card picker |

---

## Source-of-Truth vs Build Artifact Drift

| Aspect | TS Source | JS Build Artifact | Drift? |
|--------|----------|-------------------|--------|
| Lit preamble | — | Lines 1-68 | Build-only |
| Version check IIFE | `new Event(...)` with `as any` cast for detail | Same pattern, `new Event(...)` then `event.detail = {...}` | No drift |
| `html` template tag | `html` | `b` (minified) | Build minification |
| `css` template tag | `css` | `i$3` (minified) | Build minification |
| `@customElement` decorator | Decorator syntax | `__decorate([t('climate-scheduler-card')], ...)` | Build transpilation |
| `TemplateResult` import | Unused import in TS | Not in JS | Tree-shaken |
| `declare global` block (HTMLElementTagNameMap) | Present | Absent | Type-only, expected |
| `_errorMessage` type | `TemplateResult \| string \| null` | Untyped | Expected |
| Error message rendering | `html` template literal | Same (minified tag) | No drift |
| `_loadPanel` logic | Identical | Identical | No drift |

**Verdict:** JS is a faithful compilation. No behavioral drift. Only difference of note: TS uses `new Event() as any` for the version-mismatch notification (TypeScript workaround for missing `detail` on `Event`), while JS uses `new Event()` directly with property assignment. Functionally identical.

**Minor inconsistency with panel.ts:** `panel.ts` uses `new CustomEvent()` for the same version-mismatch notification, while `climate-scheduler-card.ts` uses `new Event()`. Both work but `CustomEvent` is semantically correct. This inconsistency exists in the TS source.