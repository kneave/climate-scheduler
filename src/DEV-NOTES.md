# Keyframe Timeline UI

A Lit-based keyframe timeline and graph editor component for creating and editing time-based animations and schedules. Features a visual interface for placing keyframes, adjustable time slots, value snapping, and support for background reference graphs.

## Features

- 🎯 **Visual Keyframe Editing** - Double-click to add, drag to move, right-click/hold to delete
- 📊 **Background Reference Graphs** - Display multiple reference datasets with custom colors
- 📏 **Customizable Axes** - Configure min/max values, snapping, and axis labels
- ⏰ **Time Indicator** - Show current time or custom position with vertical marker
- 📱 **Touch Support** - Full mobile/tablet support with touch gestures
- 🎨 **Themeable** - Uses CSS variables for easy customization
- 🔄 **Wraparound Visualization** - Shows how last keyframe connects to first
- ⌨️ **Keyboard Shortcuts** - Navigate keyframes with arrow keys
- 📦 **Undo/Redo** - Restore deleted keyframes

## Installation

```bash
npm install
```

## Development

```bash
# Start dev server with hot reload
npm run dev

# Build for production
npm run build
```

## Basic Usage

### Minimal Example

```html
<keyframe-timeline></keyframe-timeline>
```

### With Configuration

```html
<keyframe-timeline
  duration="24"
  slots="96"
  min-value="0"
  max-value="100"
  snap-value="5"
  x-axis-label="Time (hours)"
  y-axis-label="Temperature (°C)"
  title="Daily Temperature Schedule"
></keyframe-timeline>
```

## Properties

### Timeline Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `duration` | number | 24 | Timeline duration in hours |
| `slots` | number | 96 | Number of time divisions (e.g., 96 = 15min intervals in 24h) |
| `title` | string | '' | Title displayed in header |
| `showHeader` | boolean | true | Show header with controls |
| `readonly` | boolean | false | Disable all user interactions |

### Value Range

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `minValue` | number | 0 | Minimum Y-axis value |
| `maxValue` | number | 1 | Maximum Y-axis value |
| `snapValue` | number | 0 | Y-axis snap step (0 = no snapping) |
| `previousDayEndValue` | number | undefined | Value from end of previous day for wraparound visualization |

### Labels & Display

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `xAxisLabel` | string | '' | Label for X-axis (time) |
| `yAxisLabel` | string | '' | Label for Y-axis (value) |
| `indicatorTime` | number | undefined | Time position (0 to duration) for vertical indicator |
| `showCurrentTime` | boolean | false | Automatically show indicator at current time |

### Data

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `keyframes` | Keyframe[] | [] | Array of keyframe objects |
| `backgroundGraphs` | BackgroundGraph[] | [] | Array of background reference graphs |

## Data Types

### Keyframe

```typescript
interface Keyframe {
  time: number;   // Time position (0 to duration)
  value: number;  // Y-axis value (minValue to maxValue)
}
```

### BackgroundGraph

```typescript
interface BackgroundGraph {
  keyframes: Keyframe[];
  color?: string;  // Optional color (defaults to theme color)
  label?: string;  // Optional label for the graph
}
```

## Events

The component emits custom events for state changes:

### keyframe-added

Fired when a keyframe is added.

```typescript
event.detail = {
  keyframe: { time: number, value: number },
  index: number
}
```

### keyframe-moved

Fired when a keyframe is dragged to a new position.

```typescript
event.detail = {
  keyframe: { time: number, value: number },
  index: number,
  oldTime: number,
  oldValue: number
}
```

### keyframe-deleted

Fired when a keyframe is deleted.

```typescript
event.detail = {
  keyframe: { time: number, value: number },
  index: number
}
```

### keyframe-selected

Fired when a keyframe is selected (via navigation buttons).

```typescript
event.detail = {
  keyframe: { time: number, value: number },
  index: number
}
```

### keyframe-restored

Fired when a deleted keyframe is restored via undo.

```typescript
event.detail = {
  keyframe: { time: number, value: number }
}
```

### keyframes-cleared

Fired when all keyframes are cleared.

```typescript
// No detail payload
```

## Example: Listening to Events

```javascript
const timeline = document.querySelector('keyframe-timeline');

timeline.addEventListener('keyframe-added', (e) => {
  console.log('Keyframe added:', e.detail.keyframe);
  // Save to database, update state, etc.
});

timeline.addEventListener('keyframe-moved', (e) => {
  console.log('Keyframe moved from', e.detail.oldTime, 'to', e.detail.keyframe.time);
});

timeline.addEventListener('keyframe-deleted', (e) => {
  console.log('Keyframe deleted:', e.detail.keyframe);
});
```

## Example: Setting Keyframes Programmatically

```javascript
const timeline = document.querySelector('keyframe-timeline');

// Set keyframes
timeline.keyframes = [
  { time: 0, value: 20 },
  { time: 6, value: 22 },
  { time: 12, value: 24 },
  { time: 18, value: 23 },
  { time: 23, value: 21 }
];

// Add background reference graph
timeline.backgroundGraphs = [
  {
    keyframes: [
      { time: 0, value: 18 },
      { time: 6, value: 20 },
      { time: 12, value: 26 },
      { time: 18, value: 24 },
      { time: 23, value: 20 }
    ],
    color: '#ff5722',
    label: 'Yesterday'
  }
];
```

## Example: Temperature Schedule

```html
<keyframe-timeline
  id="temp-schedule"
  duration="24"
  slots="96"
  min-value="15"
  max-value="30"
  snap-value="0.5"
  x-axis-label="Time of Day"
  y-axis-label="Temperature (°C)"
  title="Thermostat Schedule"
  show-current-time
></keyframe-timeline>

<script>
  const timeline = document.getElementById('temp-schedule');
  
  // Set default schedule
  timeline.keyframes = [
    { time: 6, value: 21 },   // Morning
    { time: 8, value: 19 },   // Away
    { time: 17, value: 22 },  // Evening
    { time: 22, value: 18 }   // Night
  ];
  
  // Load yesterday's data as reference
  fetch('/api/temperature-history')
    .then(res => res.json())
    .then(data => {
      timeline.backgroundGraphs = [{
        keyframes: data,
        color: '#2196f3',
        label: 'Yesterday'
      }];
    });
</script>
```

## User Interactions

### Mouse/Desktop
- **Double-click** - Add keyframe at clicked position
- **Click + Drag** - Move existing keyframe
- **Right-click** - Delete keyframe
- **Click header/title** - Collapse/expand timeline
- **Pan** - Click and drag empty space (when scrollable)

### Touch/Mobile
- **Double-tap** - Add keyframe at tapped position
- **Tap + Drag** - Move existing keyframe
- **Long-press** - Delete keyframe (hold for 600ms)
- **Tap header/title** - Collapse/expand timeline
- **Pan** - Touch and drag empty space (when scrollable)

### Keyboard (when keyframe selected)
- **◀ Previous button** - Select previous keyframe
- **▶ Next button** - Select next keyframe

## Styling & Theming

The component uses CSS custom properties for theming:

```css
keyframe-timeline {
  --timeline-height: 200px;
  --timeline-height-collapsed: 100px;
  --timeline-bg: #1c1c1c;
  --timeline-track: #2c2c2c;
  --keyframe-color: #03a9f4;
  --keyframe-selected-color: #4caf50;
  --keyframe-dragging-color: #ff9800;
  --indicator-color: #ff9800;
  --canvas-text-primary: rgba(255, 255, 255, 0.9);
  --canvas-text-secondary: rgba(255, 255, 255, 0.7);
  --canvas-grid-line: rgba(255, 255, 255, 0.1);
  --canvas-label-bg: rgba(0, 0, 0, 0.7);
}
```

## Advanced Features

### Current Time Indicator

Show a vertical line at the current time:

```html
<keyframe-timeline show-current-time></keyframe-timeline>
```

Or set a specific time position:

```javascript
timeline.indicatorTime = 14.5; // 2:30 PM
```

### Previous Day Wraparound

Show how the schedule wraps from one day to the next:

```javascript
timeline.previousDayEndValue = 18;
```

### Multiple Background Graphs

Display multiple reference datasets:

```javascript
timeline.backgroundGraphs = [
  {
    keyframes: yesterdayData,
    color: '#2196f3',
    label: 'Yesterday'
  },
  {
    keyframes: lastWeekData,
    color: '#4caf50',
    label: 'Last Week Average'
  },
  {
    keyframes: targetData,
    color: '#ff9800',
    label: 'Target'
  }
];
```

### Readonly Mode

Disable all user interactions:

```html
<keyframe-timeline readonly></keyframe-timeline>
```

## Browser Support

- Modern browsers with ES2015+ support
- Chrome/Edge 88+
- Firefox 78+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

## Home Assistant Integration

This component is designed for Home Assistant but works standalone:
- Built with Lit (same as HA frontend)
- Uses HA theme CSS variables
- Emits custom events for state changes
- Can be packaged as a custom card or panel

## License

MIT
