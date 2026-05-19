# KNOWLEDGE: Climate Control Dialog

**Source of Truth:** `src/climate-dialog.ts` (per ADR-001)  
**Build Artifact:** `custom_components/climate_scheduler/frontend/climate-dialog.js`  
**Lines:** TS=1094 / JS=1066 (includes ~70 lines Lit/runtime preamble)

---

## Purpose

Custom element `<climate-control-dialog>` — a LitElement-based form for editing a single climate entity's settings within a keyframe node. Renders temperature/humidity sliders, HVAC mode, fan mode, swing modes, preset mode, aux heat toggle, and a "no temperature change" toggle. Dispatches CustomEvents for each control change; parent components handle persistence.

---

## Key Functions

### Rendering Methods
| Method | Feature Flag | Description |
|--------|-------------|-------------|
| `_renderModeRow()` | PRESET_MODE | Wraps HVAC + preset selects in `.mode-row` when preset available; otherwise HVAC only |
| `_renderHvacModes()` | — | `<select>` with "-- No Change --" default option (value `""`) |
| `_renderPresetModes()` | PRESET_MODE | Same pattern; labeled "Thermostat Preset" |
| `_renderTargetTemperature()` | TARGET_TEMPERATURE | Single range slider; track styling adapts to current HVAC mode (heating=red-left, cooling=blue-right, heat_cool=orange-full) |
| `_renderTargetTemperatureRange()` | TARGET_TEMPERATURE_RANGE | Dual range slider; collapses to single heat/cool slider per mode; dual view for heat_cool/auto/off |
| `_renderTargetHumidity()` | TARGET_HUMIDITY | Single range slider; no mode-specific styling |
| `_renderFanSwingRow()` | FAN_MODE / SWING_MODE / SWING_HORIZONTAL_MODE | Layout adapts: single mode → full width; multiple → `.mode-row` |
| `_renderFanModes()` | FAN_MODE | Dropdown with "-- No Change --" default |
| `_renderSwingModes()` | SWING_MODE | Labeled "Swing (Vertical)" |
| `_renderSwingHorizontalModes()` | SWING_HORIZONTAL_MODE | Labeled "Swing (Horizontal)" |
| `_renderAuxHeat()` | AUX_HEAT | Toggle switch (CSS-only `.toggle-switch`) |
| `_renderNoTemperatureChangeToggle()` | — | Checkbox; sets `stateObj.attributes.noChange` |

### Step Helpers (CONTRACTS.md compliance)
| Method | Default | Logic |
|--------|---------|-------|
| `_getTemperatureStep()` | **0.5** | Reads `stateObj.attributes.temperature_step`; validates finite >0; falls back to 0.5 |
| `_getHumidityStep()` | **1** | Reads `stateObj.attributes.humidity_step`; falls back to 1 |

### Step-Normalized Value Rounding
| Method | Purpose |
|--------|---------|
| `_normalizeToStep(value, step)` | Rounds value to nearest step increment; uses `Math.round(value / step) * step` then `parseFloat(result.toFixed(precision))` to eliminate float tails |
| `_getStepPrecision(step)` | Calculates decimal places from step (0.5→1, 1→0, 0.1→1) |

### Event Handlers → CustomEvents Dispatched
| Handler | Event Name | Detail |
|---------|-----------|--------|
| `_handleHvacModeChange` | `hvac-mode-changed` | `{ mode: string }` |
| `_handleTempSlider` | `temperature-changed` | `{ temperature: number }` (live, on `@input`) |
| `_handleTempSliderChange` | `temperature-committed` | `{ temperature: number }` (on `@change`, step-normalized) |
| `_handleTempLowSlider` / `_handleTempLowSliderChange` | `temperature-low-changed` / `temperature-low-committed` | Same pattern |
| `_handleTempHighSlider` / `_handleTempHighSliderChange` | `temperature-high-changed` / `temperature-high-committed` | Same pattern |
| `_handleHumiditySlider` / `_handleHumiditySliderChange` | `humidity-changed` / `humidity-committed` | Same pattern |
| `_handleFanModeChange` | `fan-mode-changed` | `{ mode: string }` |
| `_handlePresetModeChange` | `preset-mode-changed` | `{ mode: string }` |
| `_handleSwingModeChange` | `swing-mode-changed` | `{ mode: string }` |
| `_handleSwingHorizontalModeChange` | `swing-horizontal-mode-changed` | `{ mode: string }` |
| `_handleAuxHeatToggle` | `aux-heat-changed` | `{ enabled: boolean }` |
| `_handleNoTemperatureChangeToggle` | `no-temp-change-changed` | `{ enabled: boolean }` (also mutates `stateObj.attributes.noChange`) |

---

## Critical State

### Reactive Properties
| Property | Type | Attribute | Notes |
|----------|------|-----------|-------|
| `stateObj` | `ClimateState \| null` | Yes (Object) | Single input prop — contains entity_id, state, all attributes |

### ClimateState Interface (TS source)
```typescript
interface ClimateState {
  entity_id: string;
  state: string;
  attributes: {
    supported_features: number;
    hvac_modes: string[];
    current_temperature?: number;
    temperature?: number;
    target_temp_high?: number;
    target_temp_low?: number;
    target_humidity?: number;
    humidity_step?: number;
    current_humidity?: number;
    temperature_step?: number;
    min_temp: number;
    max_temp: number;
    min_humidity?: number;
    max_humidity?: number;
    fan_mode?: string;
    fan_modes?: string[];
    preset_mode?: string;
    preset_modes?: string[];
    swing_mode?: string;
    swing_modes?: string[];
    swing_horizontal_mode?: string;
    swing_horizontal_modes?: string[];
    aux_heat?: string;
    noChange?: boolean;
  };
}
```

### ClimateEntityFeature Enum
```typescript
TARGET_TEMPERATURE: 1,
TARGET_TEMPERATURE_RANGE: 2,
TARGET_HUMIDITY: 4,
FAN_MODE: 8,
PRESET_MODE: 16,
SWING_MODE: 32,
AUX_HEAT: 64,
TURN_OFF: 128,
TURN_ON: 256,
SWING_HORIZONTAL_MODE: 512,
```

---

## Known Bugs / Gaps

1. **`noChange` mutation in dialog**: `_handleNoTemperatureChangeToggle` directly mutates `this.stateObj` via spread reassignment. This is a Lit anti-pattern — the reassignment triggers reactivity but the `stateObj` is a `@property` set from outside, so parent may overwrite. Should dispatch event only and let parent manage the state.

2. **Dual-range pointer-events**: Per CONTRACTS.md, the dual-range sliders use `pointer-events: none` on the input with `pointer-events: all` on `::-webkit-slider-thumb` / `::-moz-range-thumb`. This is correctly implemented in the TS source CSS. The JS build artifact preserves this faithfully.

3. **No-change toggle for modes**: All `<select>` dropdowns include a "-- No Change --" option with value `""`. This aligns with CONTRACTS.md: "mode fields omitted = no-change". The `""` value is the sentinel.

4. **Slider @input vs @change split**: Live feedback on `@input` (displays value to user), committed (step-normalized) value on `@change`. This prevents intermediate non-step values from being persisted. Matches CONTRACTS.md: "step-normalized values (no float tails)".

5. **TS-only: `ClimateState` type** is not enforced at runtime in the compiled JS. The `.js` file omits the interface; it's compile-time only.

6. **No explicit `TURN_OFF`/`TURN_ON` handling**: The ClimateEntityFeature enum includes TURN_OFF (128) and TURN_ON (256) but the dialog doesn't render UI for them. It relies on HVAC modes list containing "off" if supported.

---

## Cross-Module Dependencies

| Dependency | Direction | Notes |
|------------|-----------|-------|
| `keyframe-timeline` | ← (event consumer) | Timeline dispatches `keyframe-clicked` → parent populates `stateObj` → dialog renders |
| `panel.ts` / `app.js` | ← (orchestrator) | Parent creates dialog, passes `stateObj`, listens to dialog events, writes to HA API |
| `lit` / `lit/decorators.js` | ← (framework) | LitElement, html, css, customElement, property decorators |
| Home Assistant | → (data source) | `supported_features` bitmask drives feature detection; `temperature_step`/`humidity_step` from entity attributes |

---

## Source-of-Truth vs Build Artifact Drift

| Aspect | TS Source | JS Build Artifact | Drift? |
|--------|----------|-------------------|--------|
| Minified/mangled Lit preamble | — | Lines 1-68 (TypeScript __decorate, Lit reactive element, lit-html, LitElement, customElement decorator, property decorator, state decorator) | Build-only; not in TS |
| `ClimateEntityFeature` enum | Typed `const` object, exported | Present at line 69-81, not exported (module scope) | JS omits `export` (IIFE/bundled) |
| `supportsFeature()` | Typed function, exported | Present, not exported | Same |
| `ClimateState` interface | Defined and exported | **Absent** (type-only, erased) | Expected TS→JS |
| Method type annotations | Present on all methods | Stripped | Expected |
| `html` template tag | `html` (readable) | `b` (minified lit-html tag) | Build minification |
| CSS template tag | `css` (readable) | `i$3` (minified) | Build minification |
| `state` decorator import | `import { state } from 'lit/decorators.js'` | Uses `r` function (minified state decorator) | Build minification |
| `customElement` decorator | `@customElement('climate-control-dialog')` | `__decorate([t('climate-control-dialog')], ClimateControlDialog)` | Build transpilation |
| Event types | `CustomEvent<{...}>` with detail types | `new CustomEvent(...)` untyped | Expected |
| **Logic/behavior** | — | — | **No drift detected** — all business logic, event names, step defaults, slider mechanics are identical |

**Verdict:** JS is a faithful compilation of the TS source. No behavioral drift. Differences are limited to minification of Lit runtime references and type erasure.