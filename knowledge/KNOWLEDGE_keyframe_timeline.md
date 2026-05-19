# KNOWLEDGE: Keyframe Timeline

**Source of Truth:** `src/keyframe-timeline.ts` (per ADR-001)  
**Build Artifact:** `custom_components/climate_scheduler/frontend/keyframe-timeline.js`  
**Lines:** TS=2348 / JS=2226 (includes ~74 lines Lit/runtime preamble)

---

## Purpose

Custom element `<keyframe-timeline>` — a full-featured canvas-based 24-hour schedule graph for editing temperature (or other numeric value) schedules. Supports:

- Draggable keyframe nodes (diamond markers) with vertical (value) and horizontal (time) dragging
- Segment dragging (shift time window between two nodes while preserving duration)
- Double-click/double-tap to add new keyframes
- Double-click on existing keyframe to delete (desktop); long-press to delete (touch)
- Undo stack (max 50 entries), Ctrl+Z shortcut
- Previous/Next keyframe navigation
- Collapsible mode (mini view)
- Background reference graphs (dashed lines for forecast/history)
- Current time indicator (green dashed line, auto-updating)
- Advance history visualization (activation markers)
- Two tooltip modes: `cursor` (interpolated value at hover position) and `history` (closest historical data point)
- Scrollable canvas on narrow screens with navigation arrows
- Snapping (`snapValue`) with step-precision rounding (no float tails)
- Y-axis label, X-axis label, title
- Read-only mode

---

## Key Functions

### Lifecycle
| Method | Description |
|--------|-------------|
| `firstUpdated()` | Queries canvas, tooltip, wrapper elements; sets up resize listener, scroll listener, keyboard shortcut (Ctrl+Z), current-time timer |
| `updated(changed)` | Redraws on `keyframes`, `backgroundGraphs`, `advanceHistory` changes; starts/stops current-time timer |
| `disconnectedCallback()` | Clears current-time interval, removes keyboard listener |

### Canvas Drawing
| Method | Description |
|--------|-------------|
| `drawTimeline()` | Master render: clears canvas, draws Y-axis (labels, grid lines, axis label), X-axis (hour markers, labels, axis label), background graphs (dashed lines), keyframe lines, keyframe markers (diamonds with selection/hover rings), value labels, current-time indicator |
| `updateCanvasSize()` | Reads CSS `--timeline-height` / `--timeline-height-collapsed`, applies `devicePixelRatio` for HiDPI |
| `getGraphDimensions(rect)` | Returns `{ labelHeight, leftMargin, yAxisWidth, rightMargin, topMargin, bottomMargin, graphHeight, graphWidth, canvasWidthCSS }` — used for coordinate mapping in all mouse handlers |

### Value Normalization & Snapping
| Method | Description |
|--------|-------------|
| `normalizeValue(value)` | Maps `[minValue, maxValue]` → `[0, 1]` |
| `denormalizeValue(normalized)` | Maps `[0, 1]` → `[minValue, maxValue]` |
| `snapValueToGrid(value)` | If `snapValue > 0`: `Math.round(value / snapValue) * snapValue` then `roundToStepPrecision`; else `roundToPrecision(value, 4)` |
| `roundToStepPrecision(value, step)` | Delegates to `roundToPrecision(value, getStepPrecision(step))` |
| `roundToPrecision(value, precision)` | `Math.round((value + Number.EPSILON) * 10^precision) / 10^precision` — eliminates float tails |
| `getStepPrecision(step)` | Determines decimal places from step (0.5→1, 1→0, 0.25→2, etc.) |

### Keyframe Management
| Method | Description |
|--------|-------------|
| `sortKeyframes()` | Sorts by time; preserves `selectedKeyframeIndex` and `draggingIndex` references across sort |
| `deleteKeyframe(index)` | Removes kf, clears/adjusts selection index, redraws, dispatches `keyframe-deleted` |
| `clearKeyframes()` | Clears all, dispatches `keyframes-cleared` |
| `findSegmentAtPoint(x, y, rect)` | Hit-test horizontal (flat hold) or vertical (step) segments; returns segment index or -1 |

### Undo
| Method | Description |
|--------|-------------|
| `saveUndoState()` | Deep-copies keyframes array to `undoStack`; max 50 entries; dispatches `undo-stack-changed` |
| `undo()` | Pops stack, restores keyframes, redraws, dispatches `keyframe-restored` |
| `setUndoButton(el)` | Registers external undo button; attaches click handler |
| `updateUndoButtonState()` | Disables/enables button, sets opacity |

### Navigation
| Method | Description |
|--------|-------------|
| `selectPrevious()` | Wraps to last if at start; dispatches `keyframe-selected` |
| `selectNext()` | Wraps to first if at end; dispatches `keyframe-selected` |
| `setPreviousButton(el)` / `setNextButton(el)` | External button wiring |

### Mouse/Touch Interaction
| Method | Description |
|--------|-------------|
| `handleCanvasMouseDown(e)` | Double-click detection (desktop), long-press timer (touch 600ms), keyframe hit-test → start drag; segment hit-test → start segment drag; otherwise → start panning |
| `handleCanvasMouseMove(e)` | Panning (priority), segment drag (time shift both endpoints, constrain, snap), single kf drag (constrain, snap, re-sort if time changed), tooltip queue |
| `handleCanvasMouseUp(e)` | Completes segment drag (`segment-moved`), single drag (`keyframe-moved`), tap selection (touch), resets all drag state |
| `handleCanvasMouseLeave(e)` | Hides tooltip, delegates to mouseUp |
| `handleCanvasClick(e)` | If not dragged: hit-test keyframe → select (`keyframe-clicked`); empty → deselect |
| `handleCanvasContextMenu(e)` | Right-click → delete keyframe (desktop alternative) |
| `handleCanvasDoubleClick(e)` | Double-click empty → add keyframe at snapped position |

### Collapse / Scroll
| Method | Description |
|--------|-------------|
| `toggleCollapse()` | Toggles `collapsed`, updates canvas size after 50ms delay |
| `checkScrollVisibility()` | Shows/hides scroll nav arrows based on scroll position |
| `scrollToStart()` / `scrollToEnd()` | Smooth scroll to edges |

### Config Panel (Inline)
| Method | Description |
|--------|-------------|
| `updateSlots(e)` | Sets `slots` (1-288), redraws |
| `updateDuration(e)` | Sets `duration` (1-168 hours), redraws |
| `updatePreviousDayEnd(e)` | For wraparound line from previous day |
| `updateMinValue(e)` / `updateMaxValue(e)` | Y-axis range |
| `updateSnapValue(e)` | Snap step |
| `updateXAxisLabel(e)` / `updateYAxisLabel(e)` / `updateTitle(e)` | Labels |

### Tooltip
| Method | Description |
|--------|-------------|
| `buildHoverTooltip(x, y, rect)` | `cursor` mode: shows interpolated value at hover time; `history` mode: shows closest data point from `backgroundGraphs` (within 30 min) |
| `getInterpolatedValue(time)` | Linear interpolation between surrounding keyframes |
| `renderHoverTooltip()` | DOM overlay positioned near cursor; flips horizontally near edges |
| `queueHoverTooltipRender(x, y)` | RAF-throttled render to avoid per-pixel canvas redraws |
| `hideHoverTooltip()` | Sets `tooltipEl.hidden = true` |
| `getOpaqueColor(color)` | Resolves CSS var color via hidden probe element, strips alpha |

### Current Time
| Method | Description |
|--------|-------------|
| `updateCurrentTime()` | Sets `indicatorTime` from Date, redraws |
| `startCurrentTimeTimer()` | 10-second interval |
| `stopCurrentTimeTimer()` | Clears interval |

---

## Critical State

### Public Reactive Properties (`@property`)
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `duration` | Number | 24 | Hours shown on X-axis |
| `slots` | Number | 96 | Time divisions (96 = 15-min intervals) |
| `keyframes` | Array | `[]` | Keyframe data |
| `previousDayEndValue` | Number | undefined | Value from end of previous day for wraparound line |
| `minValue` | Number | 5 | Y-axis minimum |
| `maxValue` | Number | 30 | Y-axis maximum |
| `snapValue` | Number | 0 | Snap step (0 = no snap) |
| `xAxisLabel` | String | `''` | X-axis label |
| `yAxisLabel` | String | `''` | Y-axis label |
| `title` | String | `''` | Top-left title |
| `showHeader` | Boolean | true | Show header with controls |
| `allowCollapse` | Boolean | true | Allow collapse |
| `readonly` | Boolean | false | Disable all interactions |
| `indicatorTime` | Number | undefined | Manual indicator position (0-duration) |
| `showCurrentTime` | Boolean | false | Auto current-time indicator |
| `backgroundGraphs` | Array | `[]` | Reference graph data |
| `advanceHistory` | Array | `[]` | Advance activation markers |
| `tooltipMode` | `'history' \| 'cursor'` | `'cursor'` | Tooltip mode |

### Internal State (`@state`)
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `canvasWidth` | Number | 0 | Canvas CSS width × devicePixelRatio |
| `canvasHeight` | Number | 600 | Canvas CSS height × devicePixelRatio |
| `showConfig` | Boolean | false | Config panel visibility |
| `draggingIndex` | Number \| null | null | Currently dragged keyframe |
| `draggingSegment` | Object \| null | null | `{ startIndex, endIndex, initialStartTime, initialEndTime, initialPointerX }` |
| `selectedKeyframeIndex` | Number \| null | null | Selected keyframe (blue ring) |
| `collapsed` | Boolean | false | Collapse state |
| `showScrollNavLeft/Right` | Boolean | false | Scroll arrow visibility |
| `undoStack` | Keyframe[][] | `[]` | Full keyframe arrays (max 50) |
| `legendCollapsed` | Boolean | true | Background graph legend collapsed |

### Private (non-reactive)
| Property | Description |
|----------|-------------|
| `canvas`, `ctx` | HTMLCanvasElement and CanvasRenderingContext2D |
| `isDragging`, `hasMoved` | Drag state flags |
| `dragStartX/Y` | Drag start position |
| `isPanning`, `panStartX`, `panStartScrollLeft` | Scroll panning state |
| `lastClickTime`, `lastClickIndex`, `lastClickX/Y` | Double-click detection |
| `justDeletedKeyframe` | Prevents dblclick add after contextmenu delete |
| `holdTimer` | Long-press timer (touch, 600ms) |
| `currentTimeTimer` | setInterval reference |
| `tooltipEl` | `.cursor-tooltip` DOM element |
| `colorProbeEl` | Hidden span for CSS var resolution |
| `hoverRenderPending` | RAF throttle flag |
| `hoverX/Y` | Last hover coordinates |
| `instanceId` | Random ID for debug logging |

---

## CustomEvents Dispatched

| Event | Detail | When |
|-------|--------|------|
| `keyframe-added` | `{ time, value }` | Double-click empty area |
| `keyframe-deleted` | `{ index, keyframe }` | Delete (context menu, double-click) |
| `keyframe-moved` | `{ index, keyframe }` | Mouse up after drag |
| `keyframe-clicked` | `{ index, keyframe }` | Click/tap on keyframe or touch tap |
| `keyframe-selected` | `{ index, keyframe }` | Previous/Next navigation |
| `keyframe-restored` | `{ keyframes }` | Undo |
| `keyframes-cleared` | none | Clear all |
| `segment-moved` | `{ startIndex, endIndex }` | Mouse up after segment drag |
| `undo-stack-changed` | `{ action, size, removedCount, keyframeCount }` | Undo push/pop/trim |
| `nodeSettingsUpdate` | `{ index, keyframe }` | During drag (live settings panel update) |

---

## Keyframe Interface (TS source)
```typescript
interface Keyframe {
  time: number;
  value: number;
  hvac_mode?: string;
  fan_mode?: string;
  swing_mode?: string;
  preset_mode?: string;
  A?: number | null;
  B?: number | null;
  C?: number | null;
  noChange?: boolean;
}
```

---

## Known Bugs / Gaps

1. **`justDeletedKeyframe` race**: 100ms timeout resets the flag. If dblclick event fires after 100ms, it could add a keyframe at the deleted position. Edge case on slow devices.

2. **Segment drag: both endpoints clamped independently**: When a segment at boundary is dragged past 23:59, both times are clamped to 23.9833 (23:59), but the minimum slot gap constraint may push the start time backward if end time was clamped first. This can cause minor visual jitter but no data corruption.

3. **Background graph drawing uses string regex for color**: `rgba()` and hex parsing via regex (`color.match(/rgba?\(\d+,.../i)` and `#([0-9a-f]{2})...`). Named CSS colors (e.g., `red`, `blue`) are not converted to rgba and lose the 0.5 opacity treatment. They render at full opacity.

4. **No `pointer-events` management for overlay elements on scroll**: The scroll nav buttons use `pointer-events: auto` but the `.timeline-canvas-wrapper` is `cursor: pointer` when collapsed. On narrow screens, the scroll buttons can interfere with canvas click events.

5. **`advanceHistory` rendering**: The compiled JS and TS both have the `advanceHistory` property wired but the actual drawing of advance indicators is not visible in the first 1600 lines of either file — it may be handled in later portions of `drawTimeline()` or may be incomplete.

6. **Canvas redraw on property changes**: `updated()` triggers `drawTimeline()` on every `keyframes` change. If the parent sets `keyframes` as a new array reference on each node drag move, this causes a full redraw on every mouse move in addition to the drag handler's own `drawTimeline()` call. Potential double-draw.

7. **`previousDayEndValue` wraparound**: Property exists and config UI exists, but the wraparound line drawing (connecting previous day's last value to today's first keyframe) was not found in the reviewed portions of `drawTimeline()`. May be in the unreviewed final section.

8. **Touch double-tap**: Uses manual time/distance threshold (300ms / 30px) instead of `dblclick` event. This is correct for touch but means desktop browsers don't get double-tap-to-add on touchscreens — `handleCanvasDoubleClick` handles desktop dblclick.

---

## Cross-Module Dependencies

| Dependency | Direction | Notes |
|------------|-----------|-------|
| `climate-dialog.ts` | → (event source) | Timeline fires `keyframe-clicked` → parent opens dialog with `stateObj` populated from keyframe |
| `panel.ts` / `app.js` | ← (orchestrator) | Creates timeline, sets `keyframes`/`minValue`/`maxValue`/`backgroundGraphs`/etc., listens to events |
| `climate-scheduler-card.ts` | ← (indirect) | Card loads panel which loads timeline |
| `lit` / `lit/decorators.js` | ← (framework) | LitElement, html, css, decorators |
| Home Assistant | → (data source) | Entity attributes feed `minValue`/`maxValue`/`snapValue` settings |
| `styles.css` | → (CSS variables) | Timeline reads CSS vars for theming: `--timeline-height`, `--timeline-height-collapsed`, `--timeline-track`, `--canvas-text-primary`, etc. |

---

## Source-of-Truth vs Build Artifact Drift

| Aspect | TS Source | JS Build Artifact | Drift? |
|--------|----------|-------------------|--------|
| Lit preamble | — | Lines 1-74 (TypeScript __decorate, Lit runtime, customElement, property, state decorators) | Build-only |
| `BACKGROUND_GRAPH_COLORS` | Typed `const` array | Present at line 75-91 | No drift |
| `Keyframe` interface | Defined and exported | Type erased | Expected |
| `BackgroundGraph` interface | Defined and exported | Type erased | Expected |
| `TooltipLine` / `HoverTooltip` interfaces | Defined | Type erased | Expected |
| `html` template tag | `html` (readable) | `b` (minified) | Build minification |
| `css` template tag | `css` (readable) | `i$3` (minified) | Build minification |
| `@state()` decorator | `import { state } from 'lit/decorators.js'` | Uses `r` function (minified state decorator helper) | Build minification |
| `@customElement('keyframe-timeline')` | Decorator syntax | `__decorate([t('keyframe-timeline')], KeyframeTimeline)` | Build transpilation |
| Method signatures | Typed with params & return types | Untyped | Expected |
| `e instanceof MouseEvent / TouchEvent` | Type guard | Identical in JS | No drift |
| CSS var references | Identical | Identical | No drift |
| Event names & detail shapes | Identical | Identical | No drift |
| **Logic/behavior** | — | — | **No drift detected** — all canvas drawing, mouse/touch handling, snapping, undo, tooltip logic matches between TS and JS |

**Verdict:** JS is a faithful compilation of the TS source. No behavioral drift. All differences are build-time artifacts (minification, type erasure, Lit runtime bundling).