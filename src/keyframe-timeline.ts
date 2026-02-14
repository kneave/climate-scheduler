import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface Keyframe {
  time: number;
  value: number;
  // Climate control properties (from SVG graph migration)
  hvac_mode?: string;
  fan_mode?: string;
  swing_mode?: string;
  preset_mode?: string;
  // Multi-zone values (A/B/C)
  A?: number | null;
  B?: number | null;
  C?: number | null;
  // Special flags
  noChange?: boolean;
}

export interface BackgroundGraph {
  keyframes: Keyframe[];
  color?: string; // Optional color (defaults to theme color with transparency)
  label?: string; // Optional label for the graph
}

interface TooltipLine {
  text: string;
  color?: string;
}

interface HoverTooltip {
  lines: TooltipLine[];
}

// Color palette for automatic background graph coloring
const BACKGROUND_GRAPH_COLORS = [
  '#f44336', // Red
  '#9c27b0', // Purple
  '#3f51b5', // Indigo
  '#00bcd4', // Cyan
  '#009688', // Teal
  '#4caf50', // Green
  '#8bc34a', // Light Green
  '#cddc39', // Lime
  '#ffeb3b', // Yellow
  '#ffc107', // Amber
  '#ff9800', // Orange
  '#ff5722', // Deep Orange
  '#795548', // Brown
  '#607d8b', // Blue Grey
];

@customElement('keyframe-timeline')
export class KeyframeTimeline extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      --timeline-height: 400px;
      --timeline-height-collapsed: 100px;
      --timeline-bg: var(--card-background-color, #1c1c1c);
      --timeline-track: var(--secondary-background-color, #2c2c2c);
      --timeline-ruler: var(--divider-color, rgba(255, 255, 255, 0.12));
      --keyframe-color: var(--accent-color, var(--primary-color, #03a9f4));
      --keyframe-selected-color: var(--success-color, #4caf50);
      --keyframe-dragging-color: var(--warning-color, #ff9800);
      --canvas-text-primary: var(--primary-text-color, rgba(255, 255, 255, 0.9));
      --canvas-text-secondary: var(--secondary-text-color, rgba(255, 255, 255, 0.7));
      --canvas-grid-line: rgba(68, 68, 68, 0.3);
      --canvas-grid-line-major: rgba(68, 68, 68, 0.5);
      --canvas-label-bg: var(--card-background-color, rgba(0, 0, 0, 0.7));
      --indicator-color: var(--accent-color, #ff9800);
    }
    
    .timeline-container {
      background: var(--background);
      border-radius: 4px;
      padding: 0;
      user-select: none;
    }
    
    .timeline-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
      cursor: pointer;
      user-select: none;
      margin-bottom: 12px;
    }
    
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      color: var(--primary-text-color, #e1e1e1);
    }
    
    .timeline-header span {
      cursor: pointer;
      user-select: none;
    }
    
    .timeline-controls {
      display: flex;
      gap: 8px;
    }
    
    button {
      background: var(--primary-color, #03a9f4);
      color: var(--primary-text-color, white);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    
    button:hover {
      opacity: 0.9;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    button.secondary {
      background: var(--secondary-background-color, #2c2c2c);
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
    }
    
    .config-panel {
      background: var(--secondary-background-color, #2c2c2c);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
    }
    
    .config-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .config-row label {
      min-width: 80px;
      font-size: 14px;
    }
    
    input[type="number"], input[type="text"] {
      background: var(--timeline-track);
      color: var(--primary-text-color, #e1e1e1);
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 14px;
    }
    
    .slot-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }
    
    .slot-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      background: var(--timeline-track);
      border-radius: 4px;
    }
    
    .slot-color {
      width: 20px;
      height: 20px;
      border-radius: 3px;
      cursor: pointer;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
    }
    
    .timeline-canvas-wrapper {
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      background: var(--timeline-track);
      border-radius: 4px;
      transition: height 0.3s ease;
      cursor: pointer;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb-color, rgba(128, 128, 128, 0.4)) transparent;
    }
    
    .timeline-canvas-wrapper::-webkit-scrollbar {
      height: 8px;
    }
    
    .timeline-canvas-wrapper::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .timeline-canvas-wrapper::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb-color, rgba(128, 128, 128, 0.4));
      border-radius: 4px;
    }
    
    .timeline-canvas-wrapper::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-color-hover, rgba(128, 128, 128, 0.6));
    }
    
    .timeline-canvas-wrapper.expanded {
      cursor: default;
    }
    
    .timeline-canvas-wrapper:not(.expanded) {
      overflow-x: hidden;
    }
    
    .timeline-canvas {
      min-width: max(100%, 800px);
      height: var(--timeline-height);
      background: var(--timeline-track);
      cursor: crosshair;
      position: relative;
      touch-action: none;
      transition: height 0.3s ease;
    }
    
    .timeline-canvas.collapsed {
      min-width: 100%;
      height: var(--timeline-height-collapsed);
      cursor: pointer;
    }
    
    .timeline-canvas.dragging {
      cursor: grabbing;
    }
    
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    
    @media (max-width: 800px) {
      .timeline-canvas:not(.collapsed) {
        min-width: 800px;
      }
    }
    
    .expand-hint {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--card-background-color, rgba(0, 0, 0, 0.7));
      color: var(--primary-text-color, white);
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
    }
    
    .timeline-canvas-wrapper:hover .expand-hint {
      opacity: 1;
    }
    
    .timeline-canvas-wrapper.expanded .expand-hint {
      display: none;
    }
    
    .scroll-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: var(--card-background-color, rgba(0, 0, 0, 0.6));
      color: var(--primary-text-color, white);
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      border-radius: 4px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      transition: background 0.2s ease;
      user-select: none;
      pointer-events: auto; /* Ensure button is clickable but doesn't block canvas unnecessarily */
    }
    
    .scroll-nav:hover {
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.8));
    }
    
    .scroll-nav.left {
      left: 10px;
    }
    
    .scroll-nav.right {
      right: 10px;
    }

    .graph-legend {
      position: absolute;
      top: 10px;
      left: 70px;
      z-index: 12;
      min-width: 160px;
      max-width: 240px;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      border-radius: 6px;
      color: var(--canvas-text-primary);
      font-size: 12px;
    }

    .graph-legend-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
    }

    .graph-legend-toggle {
      display: inline-block;
      font-size: 11px;
      transform: rotate(90deg);
      transition: transform 0.2s ease;
    }

    .graph-legend.collapsed .graph-legend-toggle {
      transform: rotate(0deg);
    }

    .graph-legend-items {
      padding: 0 8px 8px 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
    }

    .graph-legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .graph-legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.3));
      flex: 0 0 auto;
    }

    .graph-legend-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--canvas-text-secondary);
    }

    .cursor-tooltip {
      position: absolute;
      z-index: 20;
      pointer-events: none;
      background-color: rgba(var(--rgb-card-background-color, 224, 224, 224), 0.9);
      background-image: none;
      border: 1px solid var(--primary-color);
      border-radius: 4px;
      padding: 8px;
      font-size: 13px;
      line-height: 18px;
      white-space: nowrap;
    }

    .cursor-tooltip-line {
      color: var(--keyframe-color);
      font-weight: 600;
      opacity: 1;
    }
    
    .info {
      margin-top: 12px;
      font-size: 12px;
      color: var(--secondary-text-color, #9e9e9e);
    }
  `;

  @property({ type: Number }) duration = 24; // hours
  @property({ type: Number }) slots = 96; // time divisions (e.g., 15-min intervals in 24h)
  @property({ type: Array }) keyframes: Keyframe[] = [];
  @property({ type: Number }) previousDayEndValue?: number; // Value from end of previous day for wraparound
  @property({ type: Number }) minValue = 5; // Minimum Y axis value (default: 5°C)
  @property({ type: Number }) maxValue = 30; // Maximum Y axis value (default: 30°C)
  @property({ type: Number }) snapValue = 0; // Y axis snap step (0 = no snapping)
  @property({ type: String }) xAxisLabel = ''; // X axis label
  @property({ type: String }) yAxisLabel = ''; // Y axis label
  @property({ type: String }) title = ''; // Title displayed in top left
  @property({ type: Boolean }) showHeader = true; // Show header with controls
  @property({ type: Boolean }) allowCollapse = true; // Allow collapsing the timeline
  @property({ type: Boolean }) readonly = false; // Disable all interactions
  @property({ type: Number }) indicatorTime?: number; // Time position for vertical indicator bar (0 to duration)
  @property({ type: Boolean }) showCurrentTime = false; // Automatically show indicator at current time
  @property({ type: Array }) backgroundGraphs: BackgroundGraph[] = []; // Background reference graphs
  @property({ type: Array }) advanceHistory: any[] = []; // Array of {activated_at, target_time, cancelled_at, target_node}
  @property({ type: String, attribute: false }) tooltipMode: 'history' | 'cursor' = 'cursor'; // Tooltip display mode (set from global settings)
  
  @state() private canvasWidth = 0;
  @state() private canvasHeight = 600;
  @state() private showConfig = false;
  @state() private draggingIndex: number | null = null;
  @state() private draggingSegment: { startIndex: number; endIndex: number; initialStartTime: number; initialEndTime: number; initialPointerX: number } | null = null;
  @state() private selectedKeyframeIndex: number | null = null;
  @state() private collapsed = false;
  @state() private showScrollNavLeft = false;
  @state() private showScrollNavRight = false;
  @state() undoStack: Keyframe[][] = []; // Changed to store full keyframe arrays
  @state() private legendCollapsed = true;
  
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private undoButton?: HTMLButtonElement; // External undo button reference
  private previousButton?: HTMLButtonElement; // External previous button reference
  private nextButton?: HTMLButtonElement; // External next button reference
  private keyboardHandler?: (e: KeyboardEvent) => void; // Keyboard event handler
  private isDragging = false;
  private hasMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartScrollLeft = 0;
  private wrapperEl?: HTMLElement;
  private lastClickTime = 0;
  private lastClickIndex = -1; // Track which keyframe was last clicked
  private lastClickX = 0;
  private instanceId = Math.random().toString(36).substring(7); // Unique instance ID for debugging
  private lastClickY = 0;
  private justDeletedKeyframe = false; // Prevent dblclick from adding after delete
  private holdTimer?: number;
  private holdStartX = 0;
  private holdStartY = 0;
  private currentTimeTimer?: number;
  private tooltipEl?: HTMLDivElement;
  private colorProbeEl?: HTMLSpanElement;
  private hoverRenderPending = false;
  private hoverX = 0;
  private hoverY = 0;
  
  willUpdate(changedProperties: Map<string, any>) {
    // Property change tracking
  }

  firstUpdated() {
    const canvasEl = this.shadowRoot?.querySelector('canvas');
    if (canvasEl) {
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d') || undefined;
      this.updateCanvasSize();
    }
    this.tooltipEl = this.shadowRoot?.querySelector('.cursor-tooltip') as HTMLDivElement;
    
    this.wrapperEl = this.shadowRoot?.querySelector('.timeline-canvas-wrapper') as HTMLElement;
    this.checkScrollVisibility();
    
    // Listen for scroll events to update button visibility
    if (this.wrapperEl) {
      this.wrapperEl.addEventListener('scroll', () => this.checkScrollVisibility());
    }
    
    // Update canvas size on window resize
    window.addEventListener('resize', () => {
      this.updateCanvasSize();
      this.drawTimeline();
      this.checkScrollVisibility();
    });
    
    // Draw immediately - CSS variables should now be properly set via styles.css
    requestAnimationFrame(() => {
      this.updateCanvasSize();
      this.drawTimeline();
    });
    
    // Setup current time indicator if enabled
    if (this.showCurrentTime) {
      this.updateCurrentTime();
      this.startCurrentTimeTimer();
    }
    
    // Setup keyboard shortcuts
    this.keyboardHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCurrentTimeTimer();
    
    // Remove keyboard listener
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
    }
  }
  
  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    
    // Redraw when keyframes, backgroundGraphs or advanceHistory changes
    if (changedProperties.has('keyframes')) {
      this.drawTimeline();
      this.updateNavigationButtonsState();
    }
    
    // Redraw when backgroundGraphs or advanceHistory changes
    if (changedProperties.has('backgroundGraphs') || changedProperties.has('advanceHistory')) {
      this.drawTimeline();
    }
    
    // Start/stop timer when showCurrentTime changes
    if (changedProperties.has('showCurrentTime')) {
      if (this.showCurrentTime) {
        this.updateCurrentTime();
        this.startCurrentTimeTimer();
      } else {
        this.stopCurrentTimeTimer();
      }
    }
  }
  
  private updateCurrentTime() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    // Calculate time as decimal hours
    const currentTime = hours + (minutes / 60) + (seconds / 3600);
    
    // Only update if within the timeline duration
    if (currentTime <= this.duration) {
      this.indicatorTime = currentTime;
      this.drawTimeline();
    }
  }
  
  private startCurrentTimeTimer() {
    // Update every 10 seconds for smooth movement
    this.currentTimeTimer = window.setInterval(() => {
      this.updateCurrentTime();
    }, 10000);
  }
  
  private stopCurrentTimeTimer() {
    if (this.currentTimeTimer) {
      window.clearInterval(this.currentTimeTimer);
      this.currentTimeTimer = undefined;
    }
  }
  
  private updateCanvasSize() {
    if (!this.canvas) return;
    // Use offsetWidth to get actual canvas width (not clipped by scroll container)
    const canvasCSSWidth = this.canvas.offsetWidth;
    this.canvasWidth = canvasCSSWidth * window.devicePixelRatio;
    
    // Read height from CSS variables
    const computedStyle = getComputedStyle(this);
    const cssHeightVar = this.collapsed ? '--timeline-height-collapsed' : '--timeline-height';
    const cssHeight = computedStyle.getPropertyValue(cssHeightVar).trim();
    const baseHeight = parseInt(cssHeight);
    
    this.canvasHeight = baseHeight * window.devicePixelRatio;
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
  }
  
  private normalizeValue(value: number): number {
    // Convert value from minValue-maxValue range to 0-1 range
    return (value - this.minValue) / (this.maxValue - this.minValue);
  }
  
  private denormalizeValue(normalized: number): number {
    // Convert value from 0-1 range to minValue-maxValue range
    return normalized * (this.maxValue - this.minValue) + this.minValue;
  }

  private getThemeColor(cssVar: string): string {
    return getComputedStyle(this).getPropertyValue(cssVar).trim();
  }

  private getBackgroundGraphColor(bgGraph: BackgroundGraph, graphIndex: number): string {
    return bgGraph.color || BACKGROUND_GRAPH_COLORS[graphIndex % BACKGROUND_GRAPH_COLORS.length];
  }

  private toggleLegend(e: Event) {
    e.stopPropagation();
    this.legendCollapsed = !this.legendCollapsed;
  }

  private getBaseFontSize(): number {
    // Get computed font size from host element to respect browser/accessibility settings
    const computedStyle = getComputedStyle(this);
    return parseFloat(computedStyle.fontSize);
  }
  
  private snapValueToGrid(value: number): number {
    // Snap value to grid if snapValue is set
    if (this.snapValue > 0) {
      return Math.round(value / this.snapValue) * this.snapValue;
    }
    return value;
  }

  private getGraphDimensions(rect: DOMRect) {
    const labelHeight = 30;
    const leftMargin = 35;
    const yAxisWidth = 35;
    const rightMargin = 35;
    const topMargin = 25;
    const bottomMargin = 25;
    const graphHeight = rect.height - labelHeight - topMargin - bottomMargin;
    // Use canvas width (not rect width which is clipped by scroll container)
    const canvasWidthCSS = this.canvas!.width / (window.devicePixelRatio || 1);
    const graphWidth = canvasWidthCSS - leftMargin - yAxisWidth - rightMargin;
    
    return {
      labelHeight,
      leftMargin,
      yAxisWidth,
      rightMargin,
      topMargin,
      bottomMargin,
      graphHeight,
      graphWidth,
      canvasWidthCSS
    };
  }
  
  private sortKeyframes() {
    // Keep track of what was selected/dragging before sort
    const selectedKeyframe = this.selectedKeyframeIndex !== null ? this.keyframes[this.selectedKeyframeIndex] : null;
    const draggingKeyframe = this.draggingIndex !== null ? this.keyframes[this.draggingIndex] : null;
    
    // Sort keyframes by time
    this.keyframes = [...this.keyframes].sort((a, b) => a.time - b.time);
    
    // Update indices to point to same keyframes after sort
    if (selectedKeyframe) {
      this.selectedKeyframeIndex = this.keyframes.findIndex(kf => kf === selectedKeyframe);
    }
    if (draggingKeyframe) {
      this.draggingIndex = this.keyframes.findIndex(kf => kf === draggingKeyframe);
    }
  }
  
  private drawTimeline() {
    if (!this.ctx || !this.canvas) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    
    const slotWidth = this.canvasWidth / this.slots;
    
    // Reserve space at bottom for labels, left for Y axis, right margin, and top for margin
    const labelHeight = 30 * dpr;
    const leftMargin = 35 * dpr;
    const yAxisWidth = 35 * dpr;
    const rightMargin = 35 * dpr;
    const topMargin = 45 * dpr;
    const bottomMargin = 25 * dpr;
    const graphHeight = this.canvasHeight - labelHeight - topMargin - bottomMargin;
    const graphWidth = this.canvasWidth - leftMargin - yAxisWidth - rightMargin;
    
    // Draw Y axis labels and horizontal grid lines
    const numYLabels = this.collapsed ? 2 : 5;
    const baseFontSize = this.getBaseFontSize();
    const yLabelOffset = 5 * dpr; // Distance from Y-axis to label text
    const yAxisLabelOffset = -10 * dpr; // Distance from left edge to vertical Y-axis label
    const xAxisLabelOffset = 25 * dpr; // Distance from bottom to horizontal X-axis label
    this.ctx.fillStyle = this.getThemeColor('--canvas-text-secondary');
    this.ctx.font = `${baseFontSize * dpr}px sans-serif`;
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    this.ctx.strokeStyle = this.getThemeColor('--canvas-grid-line');
    this.ctx.lineWidth = 1 * dpr;
    
    for (let i = 0; i < numYLabels; i++) {
      const ratio = i / (numYLabels - 1);
      const value = this.minValue + ratio * (this.maxValue - this.minValue);
      const y = topMargin + (graphHeight * (1 - ratio));
      
      // Draw label
      this.ctx.fillText(value.toFixed(1), leftMargin + yAxisWidth - yLabelOffset, y);
      
      // Draw horizontal grid line
      this.ctx.beginPath();
      this.ctx.moveTo(leftMargin + yAxisWidth, y);
      this.ctx.lineTo(leftMargin + yAxisWidth + graphWidth, y);
      this.ctx.stroke();
    }
    
    // Draw Y axis label (vertical text on left side)
    if (this.yAxisLabel && !this.collapsed) {
      this.ctx.save();
      this.ctx.translate(leftMargin + yAxisLabelOffset, this.canvasHeight / 2);
      this.ctx.rotate(-Math.PI / 2);
      this.ctx.fillStyle = this.getThemeColor('--canvas-text-primary');
      this.ctx.font = `${baseFontSize * dpr}px sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(this.yAxisLabel, 0, 0);
      this.ctx.restore();
    }
    
    // Adjust slot width for graph area
    const adjustedSlotWidth = graphWidth / this.slots;
    
    // Draw hour markers (full height) and labels
    this.ctx.fillStyle = this.getThemeColor('--canvas-text-secondary');
    this.ctx.font = `${baseFontSize * dpr}px sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    const hoursToShow = Math.ceil(this.duration);
    const labelInterval = this.collapsed ? 3 : 1; // Show labels every 3 hours when collapsed
    
    for (let i = 0; i <= hoursToShow; i++) {
      const x = leftMargin + yAxisWidth + ((i / this.duration) * graphWidth);
      
      // Draw hour marker line with thicker lines every 6 hours
      const isMajorLine = i % 6 === 0;
      this.ctx.strokeStyle = isMajorLine 
        ? this.getThemeColor('--canvas-grid-line-major') 
        : this.getThemeColor('--canvas-grid-line');
      this.ctx.lineWidth = isMajorLine ? 2 * dpr : 1 * dpr;
      
      this.ctx.beginPath();
      this.ctx.moveTo(x, topMargin);
      this.ctx.lineTo(x, topMargin + graphHeight);
      this.ctx.stroke();
      
      // Draw hour label only at specified intervals (below graph area)
      if (i % labelInterval === 0) {
        const hour = i % 24;
        const label = hour === 0 ? '00' : hour.toString().padStart(2, '0');
        this.ctx.fillText(label, x, topMargin + graphHeight + (15 * dpr));
      }
    }
    
    // Draw axis lines (like SVG graph)
    this.ctx.strokeStyle = this.getThemeColor('--canvas-text-primary');
    this.ctx.lineWidth = 2 * dpr;
    
    // X-axis (bottom)
    this.ctx.beginPath();
    this.ctx.moveTo(leftMargin + yAxisWidth, topMargin + graphHeight);
    this.ctx.lineTo(leftMargin + yAxisWidth + graphWidth, topMargin + graphHeight);
    this.ctx.stroke();
    
    // Y-axis (left)
    this.ctx.beginPath();
    this.ctx.moveTo(leftMargin + yAxisWidth, topMargin);
    this.ctx.lineTo(leftMargin + yAxisWidth, topMargin + graphHeight);
    this.ctx.stroke();
    
    // Current time indicator (green dashed line like SVG)
    const now = new Date();
    const currentHours = now.getHours() + now.getMinutes() / 60;
    const currentX = leftMargin + yAxisWidth + ((currentHours / this.duration) * graphWidth);
    
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 2 * dpr;
    this.ctx.setLineDash([5 * dpr, 5 * dpr]);
    this.ctx.globalAlpha = 0.7;
    this.ctx.beginPath();
    this.ctx.moveTo(currentX, topMargin);
    this.ctx.lineTo(currentX, topMargin + graphHeight);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.globalAlpha = 1.0;
    
    // Current time label at top
    const hours = Math.floor(currentHours);
    const minutes = Math.floor((currentHours - hours) * 60);
    const timeLabel = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    this.ctx.fillStyle = this.getThemeColor('--canvas-text-primary');
    this.ctx.font = `bold ${baseFontSize * dpr}px sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(timeLabel, currentX, topMargin - (5 * dpr));
    
    // Draw X axis label (below time labels)
    if (this.xAxisLabel && !this.collapsed) {
      this.ctx.fillStyle = this.getThemeColor('--canvas-text-primary');
      this.ctx.font = `${baseFontSize * dpr}px sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(this.xAxisLabel, leftMargin + yAxisWidth + (graphWidth / 2), this.canvasHeight - xAxisLabelOffset);
    }
    
    // Draw background graphs (reference data)
    const ctx = this.ctx;
    this.backgroundGraphs.forEach((bgGraph, graphIndex) => {
      if (bgGraph.keyframes.length === 0) return;
      
      // Sort keyframes by time for proper line drawing
      const sortedKeyframes = [...bgGraph.keyframes].sort((a, b) => a.time - b.time);
      
      // Use specified color or cycle through palette
      const color = this.getBackgroundGraphColor(bgGraph, graphIndex);
      const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (rgbaMatch) {
        ctx.strokeStyle = `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, 0.5)`;
      } else {
        // Try hex to rgba conversion
        const hexMatch = color.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
        if (hexMatch) {
          const r = parseInt(hexMatch[1], 16);
          const g = parseInt(hexMatch[2], 16);
          const b = parseInt(hexMatch[3], 16);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        } else {
          ctx.strokeStyle = color;
        }
      }
      
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]); // Dashed line for background
      
      // Draw lines between keyframes
      for (let i = 0; i < sortedKeyframes.length - 1; i++) {
        const kf1 = sortedKeyframes[i];
        const kf2 = sortedKeyframes[i + 1];
        
        const x1 = leftMargin + yAxisWidth + ((kf1.time / this.duration) * graphWidth);
        const y1 = topMargin + ((1 - this.normalizeValue(kf1.value)) * graphHeight);
        const x2 = leftMargin + yAxisWidth + ((kf2.time / this.duration) * graphWidth);
        const y2 = topMargin + ((1 - this.normalizeValue(kf2.value)) * graphHeight);
        
        // Draw line between points
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      
      ctx.setLineDash([]); // Reset dash
      
      // Draw small circle markers at each keyframe (smaller than main graph)
      sortedKeyframes.forEach(kf => {
        const x = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
        const y = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
        
        this.ctx!.fillStyle = color;
        this.ctx!.beginPath();
        this.ctx!.arc(x, y, 2 * dpr, 0, Math.PI * 2);
        this.ctx!.fill();
      });
    });
    
    // Draw FLAT/STEP lines between keyframes (like scheduler-card)
    if (this.keyframes.length > 0) {
      this.ctx.strokeStyle = this.getThemeColor('--keyframe-color');
      this.ctx.lineWidth = 3 * dpr;
      
      // Keyframes are already sorted by time
      for (let i = 0; i < this.keyframes.length - 1; i++) {
        const kf1 = this.keyframes[i];
        const kf2 = this.keyframes[i + 1];
        
        const x1 = leftMargin + yAxisWidth + ((kf1.time / this.duration) * graphWidth);
        const y1 = topMargin + ((1 - this.normalizeValue(kf1.value)) * graphHeight);
        const x2 = leftMargin + yAxisWidth + ((kf2.time / this.duration) * graphWidth);
        const y2 = topMargin + ((1 - this.normalizeValue(kf2.value)) * graphHeight);
        
        // Draw flat line (hold value until next keyframe)
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y1); // Horizontal to next time
        this.ctx.lineTo(x2, y2); // Vertical step to new value
        this.ctx.stroke();
      }
      
      // Wraparound: extend last keyframe to end, then wrap to first keyframe
      if (this.keyframes.length > 0) {
        const lastKf = this.keyframes[this.keyframes.length - 1];
        const firstKf = this.keyframes[0];
        
        const lastX = leftMargin + yAxisWidth + ((lastKf.time / this.duration) * graphWidth);
        const lastY = topMargin + ((1 - this.normalizeValue(lastKf.value)) * graphHeight);
        const firstY = topMargin + ((1 - this.normalizeValue(firstKf.value)) * graphHeight);
        
        // Determine the starting value (from previous day or from last keyframe)
        const startValue = this.previousDayEndValue !== undefined ? this.previousDayEndValue : lastKf.value;
        const startY = topMargin + ((1 - this.normalizeValue(startValue)) * graphHeight);
        
        // Calculate the position of the last hour marker (24:00/00:00)
        const endX = leftMargin + yAxisWidth + ((this.duration / this.duration) * graphWidth);
        
        // Extend last keyframe to right edge
        this.ctx.beginPath();
        this.ctx.moveTo(lastX, lastY);
        this.ctx.lineTo(endX, lastY);
        this.ctx.stroke();
        
        // Extend from left edge to first keyframe
        // In multi-day mode, use previousDayEndValue; in 24hr mode, wrap to own last value
        const wrapValue = this.previousDayEndValue !== undefined && this.previousDayEndValue !== null 
          ? this.previousDayEndValue 
          : lastKf.value;
        const wrapY = topMargin + ((1 - this.normalizeValue(wrapValue)) * graphHeight);
        
        if (firstKf.time > 0) {
          // Hold wrap value horizontally, then step to first keyframe
          const firstX = leftMargin + yAxisWidth + ((firstKf.time / this.duration) * graphWidth);
          this.ctx.beginPath();
          this.ctx.moveTo(leftMargin + yAxisWidth, wrapY);
          this.ctx.lineTo(firstX, wrapY);
          this.ctx.lineTo(firstX, firstY);
          this.ctx.stroke();
        } else {
          // First keyframe at 0, just draw vertical step
          this.ctx.beginPath();
          this.ctx.moveTo(leftMargin + yAxisWidth, wrapY);
          this.ctx.lineTo(leftMargin + yAxisWidth, firstY);
          this.ctx.stroke();
        }
      }
    }
    
    // Draw advance history markers
    if (this.advanceHistory && this.advanceHistory.length > 0) {
      this.advanceHistory.forEach(event => {
        if (event.target_node && event.target_node.temp !== null && event.target_node.temp !== undefined) {
          // Parse activated_at time to get hour position
          const activatedDate = new Date(event.activated_at);
          const activatedHours = activatedDate.getHours() + (activatedDate.getMinutes() / 60);
          
          // Only draw if within today's 24-hour range
          if (activatedHours >= 0 && activatedHours < 24) {
            const x = leftMargin + yAxisWidth + ((activatedHours / this.duration) * graphWidth);
            const y = topMargin + ((1 - this.normalizeValue(event.target_node.temp)) * graphHeight);
            
            // Draw diamond marker for advance activation
            this.ctx!.save();
            this.ctx!.fillStyle = '#00ff00';
            this.ctx!.strokeStyle = '#00aa00';
            this.ctx!.lineWidth = 2 * dpr;
            this.ctx!.translate(x, y);
            this.ctx!.rotate(Math.PI / 4);
            const markerSize = 8 * dpr;
            this.ctx!.fillRect(-markerSize, -markerSize, markerSize * 2, markerSize * 2);
            this.ctx!.strokeRect(-markerSize, -markerSize, markerSize * 2, markerSize * 2);
            this.ctx!.restore();
          }
        }
      });
    }
    
    // Draw current time indicator (vertical bar) if set
    if (this.indicatorTime !== undefined && this.indicatorTime >= 0 && this.indicatorTime <= this.duration) {
      const indicatorX = leftMargin + yAxisWidth + ((this.indicatorTime / this.duration) * graphWidth);
      
      this.ctx.strokeStyle = '#00ff00';
      this.ctx.lineWidth = 2 * dpr;
      this.ctx.setLineDash([5 * dpr, 5 * dpr]); // Dashed line
      
      // Draw vertical line through graph area
      this.ctx.beginPath();
      this.ctx.moveTo(indicatorX, topMargin);
      this.ctx.lineTo(indicatorX, topMargin + graphHeight);
      this.ctx.stroke();
      
      this.ctx.setLineDash([]); // Reset dash
    }
    
    // Draw keyframe markers
    
    this.keyframes.forEach((kf, index) => {
      const x = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
      const y = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
      
      // Highlight if being dragged or selected
      const isDragging = this.draggingIndex === index;
      const isSelected = this.selectedKeyframeIndex === index;
      
      if (isDragging) {
        this.ctx!.fillStyle = this.getThemeColor('--keyframe-dragging-color');
      } else if (isSelected) {
        this.ctx!.fillStyle = this.getThemeColor('--keyframe-selected-color');
      } else {
        this.ctx!.fillStyle = this.getThemeColor('--keyframe-color');
      }
      
      // Draw diamond marker (smaller when collapsed)
      this.ctx!.save();
      this.ctx!.translate(x, y);
      this.ctx!.rotate(Math.PI / 4);
      const baseSize = this.collapsed ? 4 : 6;
      const size = (isDragging || isSelected) ? baseSize + 2 : baseSize;
      this.ctx!.fillRect(-size * dpr, -size * dpr, size * 2 * dpr, size * 2 * dpr);
      this.ctx!.restore();
      
      // Draw selection ring for selected keyframe (hide when collapsed)
      if (isSelected && !isDragging && !this.collapsed) {
        this.ctx!.strokeStyle = this.getThemeColor('--keyframe-selected-color');
        this.ctx!.lineWidth = 2;
        this.ctx!.beginPath();
        this.ctx!.arc(x, y, 12 * dpr, 0, Math.PI * 2);
        this.ctx!.stroke();
      }
      
      // Draw hover ring for draggable indication (hide when collapsed)
      if (!isDragging && !isSelected && !this.collapsed) {
        const textColor = this.getThemeColor('--canvas-text-secondary');
        // Apply opacity to text color for hover ring
        const rgbaMatch = textColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbaMatch) {
          this.ctx!.strokeStyle = `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, 0.3)`;
        } else {
          this.ctx!.strokeStyle = textColor;
        }
        this.ctx!.lineWidth = 1;
        this.ctx!.beginPath();
        this.ctx!.arc(x, y, 10 * dpr, 0, Math.PI * 2);
        this.ctx!.stroke();
      }
      
      // Draw value label above each keyframe (hide when collapsed)
      if (!this.collapsed) {
        const valueText = kf.value.toFixed(this.snapValue < 1 ? 1 : 0);
        this.ctx!.font = `${baseFontSize * dpr}px system-ui, -apple-system, sans-serif`;
        this.ctx!.textAlign = 'center';
        this.ctx!.textBaseline = 'bottom';
        
        // Position label above the keyframe with some padding
        const labelY = y - 18 * dpr;
        
        // Draw background for better readability
        const textMetrics = this.ctx!.measureText(valueText);
        const textWidth = textMetrics.width;
        const textHeight = 14 * dpr;
        const padding = 4 * dpr;
        
        this.ctx!.fillStyle = this.getThemeColor('--canvas-label-bg');
        this.ctx!.fillRect(
          x - textWidth / 2 - padding,
          labelY - textHeight - padding,
          textWidth + padding * 2,
          textHeight + padding * 2
        );
        
        // Draw text - use keyframe color
        if (isDragging) {
          this.ctx!.fillStyle = this.getThemeColor('--keyframe-dragging-color');
        } else if (isSelected) {
          this.ctx!.fillStyle = this.getThemeColor('--keyframe-selected-color');
        } else {
          this.ctx!.fillStyle = this.getThemeColor('--keyframe-color');
        }
        this.ctx!.fillText(valueText, x, labelY);
      }
    });
    
    // Tooltip is rendered as a lightweight DOM overlay to avoid canvas redraw on hover.
  }
  
  private buildHoverTooltip(x: number, y: number, rect: DOMRect): HoverTooltip | null {
    const { leftMargin, yAxisWidth, rightMargin, topMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check if in graph area
    if (x < leftMargin + yAxisWidth || x > rect.width - rightMargin || 
        y < topMargin || y > topMargin + graphHeight) {
      return null;
    }
    
    const adjustedX = x - leftMargin - yAxisWidth;
    const time = (adjustedX / graphWidth) * this.duration;
    
    let tooltipLines: TooltipLine[] = [];
    
    if (this.tooltipMode === 'cursor') {
      // Show interpolated value at cursor position on schedule line
      const tooltipValue = this.getInterpolatedValue(time);
      if (tooltipValue !== null) {
        const hours = Math.floor(time);
        const minutes = Math.round((time - hours) * 60);
        tooltipLines.push({
          text: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} - ${tooltipValue.toFixed(1)}°`,
          color: this.getThemeColor('--keyframe-color')
        });
      }
    } else {
      // Get current time in decimal hours
      const now = new Date();
      const currentTime = now.getHours() + now.getMinutes() / 60;
      
      // Only show history if hovering over past time or close to current time (within 30 minutes)
      const timeDiff = time - currentTime;
      const showHistory = timeDiff <= 0.5; // Show if in past or within 30 minutes of now
      
      if (showHistory && this.backgroundGraphs && this.backgroundGraphs.length > 0) {
        this.backgroundGraphs.forEach((historyGraph, graphIndex) => {
          if (!historyGraph || !historyGraph.keyframes || historyGraph.keyframes.length === 0) return;
          
          let displayPoint = null;
          
          if (time >= currentTime) {
            // At or past current time (but close to now): show latest temperature
            displayPoint = historyGraph.keyframes[historyGraph.keyframes.length - 1];
          } else {
            // Before current time: find closest data point to hover time
            let closestPoint = null;
            let closestDist = Infinity;
            
            for (const point of historyGraph.keyframes) {
              const dist = Math.abs(point.time - time);
              if (dist < closestDist) {
                closestDist = dist;
                closestPoint = point;
              }
            }
            
            if (closestPoint && closestDist < 0.5) { // Within 30 minutes
              displayPoint = closestPoint;
            }
          }
          
          if (displayPoint) {
            const label = historyGraph.label || 'Temperature';
            const color = historyGraph.color || BACKGROUND_GRAPH_COLORS[graphIndex % BACKGROUND_GRAPH_COLORS.length];
            tooltipLines.push({ text: `${label}: ${displayPoint.value.toFixed(1)}°`, color });
          }
        });
      }
    }
    
    if (tooltipLines.length === 0) return null;

    return {
      lines: tooltipLines
    };
  }

  private hideHoverTooltip() {
    if (!this.tooltipEl) return;
    this.tooltipEl.hidden = true;
  }

  private getOpaqueColor(color: string): string {
    if (!this.shadowRoot) return color;

    if (!this.colorProbeEl) {
      this.colorProbeEl = document.createElement('span');
      this.colorProbeEl.style.position = 'absolute';
      this.colorProbeEl.style.visibility = 'hidden';
      this.colorProbeEl.style.pointerEvents = 'none';
      this.colorProbeEl.style.width = '0';
      this.colorProbeEl.style.height = '0';
      this.colorProbeEl.style.overflow = 'hidden';
      this.shadowRoot.appendChild(this.colorProbeEl);
    }

    this.colorProbeEl.style.color = color;
    const resolved = getComputedStyle(this.colorProbeEl).color;
    const rgbaMatch = resolved.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9]*\.?[0-9]+)\s*\)/i);
    if (rgbaMatch) {
      return `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`;
    }
    return resolved || color;
  }

  private renderHoverTooltip() {
    if (!this.canvas || !this.tooltipEl || this.collapsed || this.isDragging || this.isPanning) {
      this.hideHoverTooltip();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const tooltip = this.buildHoverTooltip(this.hoverX, this.hoverY, rect);
    if (!tooltip) {
      this.hideHoverTooltip();
      return;
    }

    const wasHidden = this.tooltipEl.hidden;
    const defaultTooltipTextColor = this.getThemeColor('--keyframe-color');
    const tooltipTextColors = tooltip.lines.map(line => this.getOpaqueColor(line.color || defaultTooltipTextColor));
    const backgroundGraphColors = this.backgroundGraphs.map((bgGraph, index) => ({
      label: bgGraph.label || `Entity ${index + 1}`,
      color: this.getBackgroundGraphColor(bgGraph, index)
    }));

    this.tooltipEl.replaceChildren();
    tooltip.lines.forEach(line => {
      const lineEl = document.createElement('div');
      lineEl.className = 'cursor-tooltip-line';
      lineEl.textContent = line.text;
      if (line.color) {
        lineEl.style.color = this.getOpaqueColor(line.color);
      }
      this.tooltipEl!.appendChild(lineEl);
    });

    this.tooltipEl.hidden = false;

    if (wasHidden) {
      console.log('[Tooltip Color Debug]', {
        graphColors: {
          keyframeColor: this.getThemeColor('--keyframe-color'),
          backgroundGraphs: backgroundGraphColors
        },
        tooltip: {
          textLines: tooltip.lines.map(line => line.text),
          textColors: tooltipTextColors
        }
      });
    }

    // Stable anchor: above-left by default; flip horizontally to the right when near left edge.
    const cursorOffsetX = 32;
    const cursorOffsetY = 10;
    const margin = 10;
    const tooltipWidth = this.tooltipEl.offsetWidth;
    const tooltipHeight = this.tooltipEl.offsetHeight;
    const maxX = Math.max(margin, rect.width - tooltipWidth - margin);
    const maxY = Math.max(margin, rect.height - tooltipHeight - margin);
    let tooltipX = this.hoverX - tooltipWidth - cursorOffsetX;
    if (tooltipX < margin) {
      tooltipX = this.hoverX + cursorOffsetX;
    }
    tooltipX = Math.max(margin, Math.min(tooltipX, maxX));
    const tooltipY = Math.max(margin, Math.min(this.hoverY - tooltipHeight - cursorOffsetY, maxY));

    this.tooltipEl.style.left = `${Math.round(tooltipX)}px`;
    this.tooltipEl.style.top = `${Math.round(tooltipY)}px`;
  }

  private queueHoverTooltipRender(x: number, y: number) {
    this.hoverX = x;
    this.hoverY = y;

    if (this.hoverRenderPending) return;
    this.hoverRenderPending = true;

    requestAnimationFrame(() => {
      this.hoverRenderPending = false;
      this.renderHoverTooltip();
    });
  }
  
  private getInterpolatedValue(time: number): number | null {
    if (this.keyframes.length === 0) return null;
    if (this.keyframes.length === 1) return this.keyframes[0].value;
    
    // Find surrounding keyframes
    let beforeKf = this.keyframes[0];
    let afterKf = this.keyframes[this.keyframes.length - 1];
    
    for (let i = 0; i < this.keyframes.length - 1; i++) {
      if (this.keyframes[i].time <= time && this.keyframes[i + 1].time >= time) {
        beforeKf = this.keyframes[i];
        afterKf = this.keyframes[i + 1];
        break;
      }
    }
    
    // Linear interpolation
    if (beforeKf.time === afterKf.time) return beforeKf.value;
    
    const ratio = (time - beforeKf.time) / (afterKf.time - beforeKf.time);
    return beforeKf.value + (afterKf.value - beforeKf.value) * ratio;
  }
  
  private handleCanvasMouseDown(e: MouseEvent | TouchEvent) {
    if (!this.canvas || this.collapsed || this.readonly) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
    const scrollOffset = this.wrapperEl?.scrollLeft || 0;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const { leftMargin, yAxisWidth, rightMargin, topMargin, bottomMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check if scrollable (only in expanded mode)
    const isScrollable = !this.collapsed && this.wrapperEl && this.wrapperEl.scrollWidth > this.wrapperEl.clientWidth;
    
    // For touch devices, set up long-press detection FIRST (before any returns)
    if (e instanceof TouchEvent) {
      const currentTime = Date.now();
      const timeSinceLastClick = currentTime - this.lastClickTime;
      const dx = x - this.lastClickX;
      const dy = y - this.lastClickY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Double-tap detected (within 300ms and 30px)
      if (timeSinceLastClick < 300 && distance < 30) {
        this.handleDoubleClick(x, y, rect);
        this.lastClickTime = 0; // Reset to prevent triple-tap
        return;
      }
      
      this.lastClickTime = currentTime;
      this.lastClickX = x;
      this.lastClickY = y;
      
      // Start long-press timer for touch devices (600ms)
      this.holdStartX = x;
      this.holdStartY = y;
      this.clearHoldTimer();
      this.holdTimer = window.setTimeout(() => {
        this.handleContextMenu(x, y, rect);
        // Clear dragging state if long press completes
        this.isDragging = false;
        this.draggingIndex = null;
      }, 600);
    }
    
    // Check if clicking on existing keyframe
    const clickedIndex = this.keyframes.findIndex(kf => {
      const kfX = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
      const kfY = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
      const distance = Math.sqrt(Math.pow(x - kfX, 2) + Math.pow(y - kfY, 2));
      return distance < 20;
    });
    
    // Debug logging for click detection
    // Calculate rendering positions using the same logic as drawTimeline (device pixels)
    const dpr = window.devicePixelRatio;
    const renderLabelHeight = 30 * dpr;
    const renderLeftMargin = 35 * dpr;
    const renderYAxisWidth = 35 * dpr;
    const renderRightMargin = 35 * dpr;
    const renderTopMargin = 45 * dpr;
    const renderBottomMargin = 25 * dpr;
    const renderGraphHeight = this.canvasHeight - renderLabelHeight - renderTopMargin - renderBottomMargin;
    const renderGraphWidth = this.canvasWidth - renderLeftMargin - renderYAxisWidth - renderRightMargin;
    
    console.log('[Click Handler Debug]', {
      eventType: e instanceof MouseEvent ? 'mouse' : 'touch',
      clientCoords: { 
        clientX: e instanceof MouseEvent ? e.clientX : e.touches[0].clientX,
        clientY: e instanceof MouseEvent ? e.clientY : e.touches[0].clientY 
      },
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      scrollOffset,
      adjustedCoords: { x, y },
      graphDimensions: {
        leftMargin,
        yAxisWidth,
        rightMargin,
        topMargin,
        bottomMargin,
        graphWidth,
        graphHeight
      },
      renderingDimensions: {
        leftMargin: renderLeftMargin,
        yAxisWidth: renderYAxisWidth,
        rightMargin: renderRightMargin,
        topMargin: renderTopMargin,
        bottomMargin: renderBottomMargin,
        graphWidth: renderGraphWidth,
        graphHeight: renderGraphHeight,
        note: 'These are in device pixels (includes DPR multiplier)'
      },
      canvasSize: {
        canvasWidth: this.canvas?.width,
        canvasHeight: this.canvas?.height,
        dpr: window.devicePixelRatio
      },
      clickedIndex,
      clickedNode: clickedIndex >= 0 ? {
        index: clickedIndex,
        keyframe: this.keyframes[clickedIndex],
        calculatedPosition: {
          kfX: leftMargin + yAxisWidth + ((this.keyframes[clickedIndex].time / this.duration) * graphWidth),
          kfY: topMargin + ((1 - this.normalizeValue(this.keyframes[clickedIndex].value)) * graphHeight)
        },
        distance: Math.sqrt(
          Math.pow(x - (leftMargin + yAxisWidth + ((this.keyframes[clickedIndex].time / this.duration) * graphWidth)), 2) + 
          Math.pow(y - (topMargin + ((1 - this.normalizeValue(this.keyframes[clickedIndex].value)) * graphHeight)), 2)
        )
      } : null,
      allNodeDistances: this.keyframes.map((kf, idx) => {
        const kfX = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
        const kfY = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
        const distance = Math.sqrt(Math.pow(x - kfX, 2) + Math.pow(y - kfY, 2));
        
        // Calculate where rendering actually draws it (in device pixels, then convert to CSS)
        const renderX = (renderLeftMargin + renderYAxisWidth + ((kf.time / this.duration) * renderGraphWidth)) / dpr;
        const renderY = (renderTopMargin + ((1 - this.normalizeValue(kf.value)) * renderGraphHeight)) / dpr;
        
        return {
          index: idx,
          time: kf.time,
          value: kf.value,
          hitDetectionPosition: { kfX, kfY },
          renderPosition: { x: renderX, y: renderY },
          positionMismatch: Math.sqrt(Math.pow(renderX - kfX, 2) + Math.pow(renderY - kfY, 2)),
          distance,
          withinHitArea: distance < 20
        };
      })
    });
    
    if (clickedIndex >= 0) {
      // Check for double-click to delete (desktop)
      if (e instanceof MouseEvent) {
        const currentTime = Date.now();
        const timeSinceLastClick = currentTime - this.lastClickTime;
        
        // Double-click detected on same keyframe (within 300ms)
        if (timeSinceLastClick < 300 && this.lastClickIndex === clickedIndex) {
          this.deleteKeyframe(clickedIndex);
          this.lastClickTime = 0; // Reset
          this.lastClickIndex = -1;
          this.draggingIndex = null; // Clear dragging state
          this.isDragging = false;
          this.justDeletedKeyframe = true; // Prevent dblclick handler from adding
          setTimeout(() => this.justDeletedKeyframe = false, 100); // Reset after event propagation
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        this.lastClickTime = currentTime;
        this.lastClickIndex = clickedIndex;
      }
      
      // Prepare to drag existing keyframe (but wait to see if it's a long press or just a click)
      this.draggingIndex = clickedIndex;
      this.hasMoved = false; // Reset movement tracking
      this.dragStartX = x;
      this.dragStartY = y;
      // Don't set isDragging yet - we'll set it on first move
      // This allows clicks to work properly
      e.preventDefault();
      return;
    }
    
    // Check if clicking on a segment (line between two keyframes)
    const segmentIndex = this.findSegmentAtPoint(x, y, rect);
    if (segmentIndex >= 0) {
      // Prepare to drag segment
      this.draggingSegment = {
        startIndex: segmentIndex,
        endIndex: segmentIndex + 1,
        initialStartTime: this.keyframes[segmentIndex].time,
        initialEndTime: this.keyframes[segmentIndex + 1].time,
        initialPointerX: x
      };
      this.hasMoved = false;
      this.dragStartX = x;
      e.preventDefault();
      return;
    }
    
    // If scrollable and not clicking on keyframe, prepare for panning
    if (isScrollable) {
      this.isPanning = true;
      this.panStartX = clientX;
      this.panStartScrollLeft = this.wrapperEl!.scrollLeft;
      e.preventDefault();
    }
  }
  
  private handleCanvasMouseMove(e: MouseEvent | TouchEvent) {
    // Update hover position for tooltip (only for mouse, not touch)
    if (e instanceof MouseEvent && !this.isDragging && !this.isPanning && this.canvas) {
      this.queueHoverTooltipRender(e.offsetX, e.offsetY);
    } else if (e instanceof TouchEvent) {
      this.hideHoverTooltip();
    }
    
    // Handle panning first (takes priority when active)
    if (this.isPanning && this.wrapperEl) {
      const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      const deltaX = clientX - this.panStartX;
      this.wrapperEl.scrollLeft = this.panStartScrollLeft - deltaX;
      e.preventDefault();
      return;
    }
    
    // Cancel long-press if moving during touch hold
    if (e instanceof TouchEvent && this.holdTimer) {
      const rect = this.canvas?.getBoundingClientRect();
      if (rect) {
        const scrollOffset = this.wrapperEl?.scrollLeft || 0;
        const x = e.touches[0].clientX - rect.left;
        const y = e.touches[0].clientY - rect.top;
        const dx = x - this.holdStartX;
        const dy = y - this.holdStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // Cancel hold if moved more than 5px - user is dragging (match threshold below)
        if (distance > 5) {
          this.clearHoldTimer();
        }
      }
    }
    
    if (!this.canvas) return;
    
    // Handle segment dragging
    if (this.draggingSegment !== null) {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      const scrollOffset = this.wrapperEl?.scrollLeft || 0;
      const currentX = clientX - rect.left;
      
      const dx = currentX - this.dragStartX;
      const distance = Math.abs(dx);
      
      if (distance < 5) return; // Minimum movement threshold
      
      if (!this.hasMoved) {
        this.saveUndoState();
        this.hasMoved = true;
      }
      
      const { leftMargin, yAxisWidth, graphWidth } = this.getGraphDimensions(rect);
      
      // Calculate time delta
      const pixelDelta = currentX - this.draggingSegment.initialPointerX;
      const timeDelta = (pixelDelta / graphWidth) * this.duration;
      
      // Apply delta to both keyframes
      let newStartTime = this.draggingSegment.initialStartTime + timeDelta;
      let newEndTime = this.draggingSegment.initialEndTime + timeDelta;
      
      // Constrain to not pass adjacent keyframes
      const { startIndex, endIndex } = this.draggingSegment;
      if (startIndex > 0) {
        const prevTime = this.keyframes[startIndex - 1].time;
        const minGap = this.duration / this.slots;
        if (newStartTime < prevTime + minGap) {
          const shift = (prevTime + minGap) - newStartTime;
          newStartTime += shift;
          newEndTime += shift;
        }
      }
      if (endIndex < this.keyframes.length - 1) {
        const nextTime = this.keyframes[endIndex + 1].time;
        const minGap = this.duration / this.slots;
        if (newEndTime > nextTime - minGap) {
          const shift = newEndTime - (nextTime - minGap);
          newStartTime -= shift;
          newEndTime -= shift;
        }
      }
      
      // Clamp to boundaries (max 23:59 to prevent 24:00)
      newStartTime = Math.max(0, newStartTime);
      newEndTime = Math.min(23 + (59/60), newEndTime);
      
      // Snap times to nearest slot (15-minute intervals)
      const slotDuration = this.duration / this.slots;
      newStartTime = Math.round(newStartTime / slotDuration) * slotDuration;
      newEndTime = Math.round(newEndTime / slotDuration) * slotDuration;
      
      // Update keyframes
      this.keyframes[startIndex].time = newStartTime;
      this.keyframes[endIndex].time = newEndTime;
      
      // Fire update event for settings panel
      this.dispatchEvent(new CustomEvent('nodeSettingsUpdate', {
        detail: {
          index: startIndex,
          keyframe: this.keyframes[startIndex]
        },
        bubbles: true,
        composed: true
      }));
      
      this.drawTimeline();
      return;
    }
    
    // Handle single keyframe dragging
    if (this.draggingIndex === null) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
    const scrollOffset = this.wrapperEl?.scrollLeft || 0;
    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;
    
    // Calculate distance from drag start
    const dx = currentX - this.dragStartX;
    const dy = currentY - this.dragStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only consider it a move if moved more than 5 pixels
    if (distance < 5) return;
    
    // Start dragging on first move
    if (!this.isDragging) {
      this.isDragging = true;
      // Save undo state when starting to drag
      this.saveUndoState();
    }
    this.hasMoved = true; // Track that movement occurred
    
    if (!this.isDragging) return;
    
    let x = currentX;
    let y = currentY;
    
    const { leftMargin, yAxisWidth, rightMargin, topMargin, bottomMargin, graphHeight, graphWidth, canvasWidthCSS } = this.getGraphDimensions(rect);
    
    // Clamp to canvas bounds (graph area only)
    x = Math.max(leftMargin + yAxisWidth, Math.min(x, canvasWidthCSS - rightMargin));
    y = Math.max(topMargin, Math.min(y, topMargin + graphHeight));
    
    // Snap time to nearest slot (adjust for Y axis offset)
    const adjustedX = x - leftMargin - yAxisWidth;
    const slotWidth = graphWidth / this.slots;
    const slotIndex = Math.round(adjustedX / slotWidth);
    // Clamp to 23:59 (23.9833 hours) to prevent 24:00
    let time = Math.min((slotIndex / this.slots) * this.duration, 23 + (59/60));
    
    // Constrain time to not pass adjacent keyframes (array is already sorted)
    if (this.draggingIndex! > 0) {
      const prevTime = this.keyframes[this.draggingIndex! - 1].time;
      const minTime = prevTime + (this.duration / this.slots); // At least one slot apart
      time = Math.max(time, minTime);
    }
    if (this.draggingIndex! < this.keyframes.length - 1) {
      const nextTime = this.keyframes[this.draggingIndex! + 1].time;
      const maxTime = nextTime - (this.duration / this.slots); // At least one slot apart
      time = Math.min(time, maxTime);
    }
    
    // Value is in minValue-maxValue range (adjust for top margin)
    const adjustedY = y - topMargin;
    const normalizedValue = Math.max(0, Math.min(1, 1 - (adjustedY / graphHeight)));
    let value = Math.max(this.minValue, Math.min(this.maxValue, this.denormalizeValue(normalizedValue)));
    
    // Apply snapping if configured
    value = this.snapValueToGrid(value);
    
    // Update keyframe position
    const oldTime = this.keyframes[this.draggingIndex!].time;
    this.keyframes = this.keyframes.map((kf, i) => 
      i === this.draggingIndex ? { time, value } : kf
    );
    
    // Re-sort if time changed (might change position in array)
    if (Math.abs(time - oldTime) > 0.01) {
      this.sortKeyframes();
    }
    
    // Fire update event for settings panel
    this.dispatchEvent(new CustomEvent('nodeSettingsUpdate', {
      detail: {
        index: this.draggingIndex,
        keyframe: this.keyframes[this.draggingIndex!]
      },
      bubbles: true,
      composed: true
    }));
    
    this.drawTimeline();
    
    e.preventDefault();
  }
  
  private handleCanvasMouseUp(e: MouseEvent | TouchEvent) {
    this.clearHoldTimer();
    this.hideHoverTooltip();
    
    // Handle segment dragging completion
    if (this.draggingSegment !== null && this.hasMoved) {
      this.dispatchEvent(new CustomEvent('segment-moved', {
        detail: { 
          startIndex: this.draggingSegment.startIndex,
          endIndex: this.draggingSegment.endIndex
        },
        bubbles: true,
        composed: true
      }));
      this.draggingSegment = null;
      this.hasMoved = false;
      return;
    }
    
    // Handle single keyframe dragging completion
    if (this.draggingIndex !== null && this.hasMoved) {
      this.dispatchEvent(new CustomEvent('keyframe-moved', {
        detail: { 
          index: this.draggingIndex,
          keyframe: this.keyframes[this.draggingIndex]
        },
        bubbles: true,
        composed: true
      }));
    }
    
    // Handle tap selection for touch devices (when not dragging)
    if (e instanceof TouchEvent && this.draggingIndex !== null && !this.hasMoved) {
      // Select the keyframe
      this.selectedKeyframeIndex = this.draggingIndex;
      this.drawTimeline();
      
      this.dispatchEvent(new CustomEvent('keyframe-clicked', {
        detail: { 
          index: this.draggingIndex,
          keyframe: this.keyframes[this.draggingIndex]
        },
        bubbles: true,
        composed: true
      }));
    }
    
    this.draggingIndex = null;
    this.draggingSegment = null;
    this.isDragging = false;
    this.hasMoved = false;
    this.isPanning = false; // Reset panning state
  }
  
  private handleCanvasMouseLeave(e: MouseEvent) {
    // Clear hover tooltip overlay
    this.hideHoverTooltip();
    
    // Also handle mouseup logic if needed
    this.handleCanvasMouseUp(e);
  }
  
  private handleCanvasClick(e: MouseEvent) {
    if (!this.canvas || this.collapsed || this.readonly) return;
    
    // If we just finished dragging, don't process click
    if (this.hasMoved) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const scrollOffset = this.wrapperEl?.scrollLeft || 0;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Use CSS pixels for click detection (canvas drawing uses device pixels with dpr scaling)
    const { leftMargin, yAxisWidth, topMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check if clicking on existing keyframe
    const clickedIndex = this.keyframes.findIndex(kf => {
      const kfX = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
      const kfY = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
      const distance = Math.sqrt(Math.pow(x - kfX, 2) + Math.pow(y - kfY, 2));
      return distance < 20;
    });
    
    if (clickedIndex >= 0) {
      // Select the keyframe
      this.selectedKeyframeIndex = clickedIndex;
      this.drawTimeline();
      
      this.dispatchEvent(new CustomEvent('keyframe-clicked', {
        detail: { 
          index: clickedIndex,
          keyframe: this.keyframes[clickedIndex]
        },
        bubbles: true,
        composed: true
      }));
    } else {
      // Clicked on empty area - deselect
      this.selectedKeyframeIndex = null;
      this.drawTimeline();
    }
  }
  
  private handleCanvasContextMenu(e: MouseEvent) {
    if (!this.canvas || this.collapsed || this.readonly) return;
    
    e.preventDefault(); // Prevent default context menu
    
    const rect = this.canvas.getBoundingClientRect();
    const scrollOffset = this.wrapperEl?.scrollLeft || 0;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.handleContextMenu(x, y, rect);
  }
  
  private handleContextMenu(x: number, y: number, rect: DOMRect) {
    const { leftMargin, yAxisWidth, topMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check if clicking on existing keyframe
    const clickedIndex = this.keyframes.findIndex(kf => {
      const kfX = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
      const kfY = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
      const distance = Math.sqrt(Math.pow(x - kfX, 2) + Math.pow(y - kfY, 2));
      return distance < 20;
    });
    
    // Delete keyframe if clicked on one
    if (clickedIndex >= 0) {
      this.deleteKeyframe(clickedIndex);
    }
  }
  
  private clearHoldTimer() {
    if (this.holdTimer) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  }
  
  private handleCanvasDoubleClick(e: MouseEvent) {
    if (!this.canvas || this.collapsed || this.readonly || this.justDeletedKeyframe) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const scrollOffset = this.wrapperEl?.scrollLeft || 0;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.handleDoubleClick(x, y, rect);
  }
  
  private handleDoubleClick(x: number, y: number, rect: DOMRect) {
    const { leftMargin, yAxisWidth, topMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check if clicking on existing keyframe
    const clickedIndex = this.keyframes.findIndex(kf => {
      const kfX = leftMargin + yAxisWidth + ((kf.time / this.duration) * graphWidth);
      const kfY = topMargin + ((1 - this.normalizeValue(kf.value)) * graphHeight);
      const distance = Math.sqrt(Math.pow(x - kfX, 2) + Math.pow(y - kfY, 2));
      return distance < 20;
    });
    
    if (clickedIndex >= 0) return; // Don't add if clicking on existing
    
    // Check if click is within graph area
    if (x < leftMargin + yAxisWidth || y < topMargin || y > topMargin + graphHeight) return;
    
    // Snap time to nearest slot (adjust for Y axis offset)
    const adjustedX = x - leftMargin - yAxisWidth;
    const slotWidth = graphWidth / this.slots;
    const slotIndex = Math.round(adjustedX / slotWidth);
    // Clamp to 23:59 (23.9833 hours) to prevent 24:00
    const time = Math.min((slotIndex / this.slots) * this.duration, 23 + (59/60));
    
    // Value is in minValue-maxValue range (adjust for top margin)
    const adjustedY = y - topMargin;
    const normalizedValue = 1 - (adjustedY / graphHeight);
    let value = this.denormalizeValue(normalizedValue);
    
    // Apply snapping if configured
    value = this.snapValueToGrid(value);
    
    // Save state before adding
    this.saveUndoState();

    this.keyframes = [...this.keyframes, { time, value }];
    this.sortKeyframes(); // Keep array sorted
    this.drawTimeline();
    
    this.dispatchEvent(new CustomEvent('keyframe-added', {
      detail: { time, value },
      bubbles: true,
      composed: true
    }));
  }
  
  // Helper method to delete a keyframe
  private deleteKeyframe(index: number) {
    if (index < 0 || index >= this.keyframes.length) return;
    
    // Save state before deleting
    this.saveUndoState();
    
    const deletedKeyframe = this.keyframes[index];
    // Remove from keyframes
    this.keyframes = this.keyframes.filter((_, i) => i !== index);
    // Clear selection if deleting selected keyframe
    if (this.selectedKeyframeIndex === index) {
      this.selectedKeyframeIndex = null;
    } else if (this.selectedKeyframeIndex !== null && this.selectedKeyframeIndex > index) {
      // Adjust selection index if deleting a keyframe before selected one
      this.selectedKeyframeIndex--;
    }
    
    this.drawTimeline();
    
    this.dispatchEvent(new CustomEvent('keyframe-deleted', {
      detail: { index, keyframe: deletedKeyframe },
      bubbles: true,
      composed: true
    }));
  }
  
  // Find segment (line between keyframes) at given point
  private findSegmentAtPoint(x: number, y: number, rect: DOMRect): number {
    const { leftMargin, yAxisWidth, topMargin, graphHeight, graphWidth } = this.getGraphDimensions(rect);
    
    // Check each segment
    for (let i = 0; i < this.keyframes.length - 1; i++) {
      const kf1 = this.keyframes[i];
      const kf2 = this.keyframes[i + 1];
      
      const x1 = leftMargin + yAxisWidth + ((kf1.time / this.duration) * graphWidth);
      const y1 = topMargin + ((1 - this.normalizeValue(kf1.value)) * graphHeight);
      const x2 = leftMargin + yAxisWidth + ((kf2.time / this.duration) * graphWidth);
      const y2 = topMargin + ((1 - this.normalizeValue(kf2.value)) * graphHeight);
      
      // Check distance to horizontal line segment (flat hold)
      if (x >= x1 && x <= x2) {
        const distanceToHorizontal = Math.abs(y - y1);
        if (distanceToHorizontal < 10) return i;
      }
      
      // Check distance to vertical line segment (step)
      if (Math.abs(x - x2) < 10 && ((y >= y1 && y <= y2) || (y >= y2 && y <= y1))) {
        return i;
      }
    }
    
    return -1;
  }
  
  private clearKeyframes() {
    // Save state before clearing
    this.saveUndoState();
    
    this.keyframes = [];
    this.selectedKeyframeIndex = null; // Clear selection
    this.drawTimeline();
    
    this.dispatchEvent(new CustomEvent('keyframes-cleared', {
      bubbles: true,
      composed: true
    }));
  }
  
  // Save current state to undo stack
  private saveUndoState() {
    // Deep copy current keyframes
    const stateCopy = this.keyframes.map(kf => ({ ...kf }));
    this.undoStack = [...this.undoStack, stateCopy];
    
    // Limit undo stack to 50 entries
    if (this.undoStack.length > 50) {
      this.undoStack = this.undoStack.slice(-50);
    }
    
    this.updateUndoButtonState();
    this.updateNavigationButtonsState();
  }

  // Public undo method (can be called externally or via Ctrl+Z)
  undo() {
    if (this.undoStack.length === 0) return;
    
    // Pop last state from undo stack
    const previousState = this.undoStack[this.undoStack.length - 1];
    this.undoStack = this.undoStack.slice(0, -1);
    
    // Restore previous state
    this.keyframes = previousState.map(kf => ({ ...kf }));
    this.drawTimeline();
    
    this.updateUndoButtonState();
    this.updateNavigationButtonsState();
    
    this.dispatchEvent(new CustomEvent('keyframe-restored', {
      detail: { keyframes: this.keyframes },
      bubbles: true,
      composed: true
    }));
  }
  
  // Set external undo button reference
  setUndoButton(buttonElement: HTMLButtonElement) {
    this.undoButton = buttonElement;
    
    // Add click handler
    if (this.undoButton) {
      this.undoButton.addEventListener('click', () => this.undo());
      this.updateUndoButtonState();
    }
  }
  
  // Set external previous button reference
  setPreviousButton(buttonElement: HTMLButtonElement) {
    this.previousButton = buttonElement;
    if (this.previousButton) {
      this.previousButton.addEventListener('click', () => this.selectPrevious());
      this.updateNavigationButtonsState();
    }
  }
  
  // Set external next button reference
  setNextButton(buttonElement: HTMLButtonElement) {
    this.nextButton = buttonElement;
    if (this.nextButton) {
      this.nextButton.addEventListener('click', () => this.selectNext());
      this.updateNavigationButtonsState();
    }
  }
  
  // Set external clear button reference
  setClearButton(buttonElement: HTMLButtonElement) {
    if (buttonElement) {
      buttonElement.addEventListener('click', () => this.clearKeyframes());
    }
  }
  
  // Update navigation buttons disabled state
  private updateNavigationButtonsState() {
    const canNavigate = this.keyframes.length >= 2;
    if (this.previousButton) {
      this.previousButton.disabled = !canNavigate;
    }
    if (this.nextButton) {
      this.nextButton.disabled = !canNavigate;
    }
  }
  
  // Update undo button disabled state
  private updateUndoButtonState() {
    if (this.undoButton) {
      if (this.undoStack.length > 0) {
        this.undoButton.disabled = false;
        this.undoButton.style.opacity = '1';
      } else {
        this.undoButton.disabled = true;
        this.undoButton.style.opacity = '0.5';
      }
    }
  }
  
  private selectPrevious() {
    if (this.keyframes.length === 0) return;
    
    // Array is already sorted by time
    if (this.selectedKeyframeIndex === null || this.selectedKeyframeIndex === 0) {
      // No selection or at start - select last keyframe
      this.selectedKeyframeIndex = this.keyframes.length - 1;
    } else {
      // Select previous
      this.selectedKeyframeIndex--;
    }
    
    this.drawTimeline();
    this.dispatchEvent(new CustomEvent('keyframe-selected', {
      detail: { 
        index: this.selectedKeyframeIndex,
        keyframe: this.keyframes[this.selectedKeyframeIndex]
      },
      bubbles: true,
      composed: true
    }));
  }
  
  private selectNext() {
    if (this.keyframes.length === 0) return;
    
    // Array is already sorted by time
    if (this.selectedKeyframeIndex === null || this.selectedKeyframeIndex >= this.keyframes.length - 1) {
      // No selection or at end - select first keyframe
      this.selectedKeyframeIndex = 0;
    } else {
      // Select next
      this.selectedKeyframeIndex++;
    }
    
    this.drawTimeline();
    this.dispatchEvent(new CustomEvent('keyframe-selected', {
      detail: { 
        index: this.selectedKeyframeIndex,
        keyframe: this.keyframes[this.selectedKeyframeIndex]
      },
      bubbles: true,
      composed: true
    }));
  }
  
  private toggleConfig() {
    this.showConfig = !this.showConfig;
  }
  
  private toggleCollapse() {
    if (!this.allowCollapse) return; // Don't allow collapsing if disabled
    this.hideHoverTooltip();
    this.collapsed = !this.collapsed;
    // Update canvas height after state change
    setTimeout(() => {
      this.updateCanvasSize();
      this.drawTimeline();
      this.checkScrollVisibility();
    }, 50);
  }
  
  private checkScrollVisibility() {
    if (!this.wrapperEl) return;
    
    const isScrollable = !this.collapsed && this.wrapperEl.scrollWidth > this.wrapperEl.clientWidth;
    
    if (!isScrollable) {
      this.showScrollNavLeft = false;
      this.showScrollNavRight = false;
      return;
    }
    
    const scrollLeft = this.wrapperEl.scrollLeft;
    const maxScroll = this.wrapperEl.scrollWidth - this.wrapperEl.clientWidth;
    
    // Show left button if not at start (with 1px tolerance)
    this.showScrollNavLeft = scrollLeft > 1;
    
    // Show right button if not at end (with 1px tolerance)
    this.showScrollNavRight = scrollLeft < maxScroll - 1;
  }
  
  private scrollToStart() {
    if (this.wrapperEl) {
      this.wrapperEl.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }
  
  private scrollToEnd() {
    if (this.wrapperEl) {
      this.wrapperEl.scrollTo({ left: this.wrapperEl.scrollWidth, behavior: 'smooth' });
    }
  }
  
  private updateSlots(e: Event) {
    const input = e.target as HTMLInputElement;
    const newSlots = Math.max(1, Math.min(288, parseInt(input.value) || 1));
    if (newSlots !== this.slots) {
      this.slots = newSlots;
      this.updateCanvasSize();
      this.drawTimeline();
    }
  }
  
  private updateDuration(e: Event) {
    const input = e.target as HTMLInputElement;
    const newDuration = Math.max(1, Math.min(168, parseInt(input.value) || 1));
    if (newDuration !== this.duration) {
      this.duration = newDuration;
      this.drawTimeline();
    }
  }
  
  private updatePreviousDayEnd(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.value === '') {
      this.previousDayEndValue = undefined;
    } else {
      const value = parseFloat(input.value);
      this.previousDayEndValue = Math.max(this.minValue, Math.min(this.maxValue, value));
    }
    this.drawTimeline();
  }
  
  private updateMinValue(e: Event) {
    const input = e.target as HTMLInputElement;
    const newMin = parseFloat(input.value);
    if (!isNaN(newMin) && newMin < this.maxValue) {
      this.minValue = newMin;
      this.drawTimeline();
    }
  }
  
  private updateMaxValue(e: Event) {
    const input = e.target as HTMLInputElement;
    const newMax = parseFloat(input.value);
    if (!isNaN(newMax) && newMax > this.minValue) {
      this.maxValue = newMax;
      this.drawTimeline();
    }
  }
  
  private updateSnapValue(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.value === '') {
      this.snapValue = 0;
    } else {
      const newSnap = parseFloat(input.value);
      this.snapValue = !isNaN(newSnap) && newSnap >= 0 ? newSnap : 0;
    }
  }
  
  private updateXAxisLabel(e: Event) {
    const input = e.target as HTMLInputElement;
    this.xAxisLabel = input.value;
    this.drawTimeline();
  }
  
  private updateYAxisLabel(e: Event) {
    const input = e.target as HTMLInputElement;
    this.yAxisLabel = input.value;
    this.drawTimeline();
  }

  render() {
    const slotDuration = this.duration / this.slots;
    const slotMinutes = slotDuration * 60;
    
    return html`
      <div class="timeline-container">
        ${!this.showHeader && this.title && this.allowCollapse ? html`
          <div class="timeline-title" @click=${this.toggleCollapse} title="Click to ${this.collapsed ? 'expand' : 'collapse'}">
            ${this.title}
          </div>
        ` : !this.showHeader && this.title ? html`
          <div class="timeline-title" style="cursor: default;">
            ${this.title}
          </div>
        ` : ''}
        
        ${this.showHeader ? html`
          <div class="timeline-header">
            <span @click=${this.allowCollapse ? this.toggleCollapse : null} title="${this.allowCollapse ? `Click to ${this.collapsed ? 'expand' : 'collapse'}` : ''}" style="cursor: ${this.allowCollapse ? 'pointer' : 'default'};">
              ${this.title || `Timeline Editor (${this.duration}h • ${this.slots} slots @ ${slotMinutes.toFixed(0)}min)`}
            </span>
            <div class="timeline-controls">
              <button class="secondary" @click=${this.selectPrevious} ?disabled=${this.keyframes.length === 0} title="Previous keyframe">
                ◀
              </button>
              <button class="secondary" @click=${this.selectNext} ?disabled=${this.keyframes.length === 0} title="Next keyframe">
                ▶
              </button>
              ${this.allowCollapse ? html`
                <button class="secondary" @click=${this.toggleCollapse}>
                  ${this.collapsed ? '▼ Expand' : '▲ Collapse'}
                </button>
              ` : ''}
              <button class="secondary" @click=${this.toggleConfig}>
                ${this.showConfig ? 'Hide' : 'Show'} Config
              </button>
              <button class="secondary" @click=${this.undo} ?disabled=${this.undoStack.length === 0}>
                ↶ Undo
              </button>
              <button @click=${this.clearKeyframes}>Clear</button>
            </div>
          </div>
        ` : ''}
        
        ${this.showConfig ? html`
          <div class="config-panel">
            <div class="config-row">
              <label>Duration (hours):</label>
              <input 
                type="number" 
                min="1" 
                max="168" 
                .value=${this.duration.toString()}
                @change=${this.updateDuration}
              />
            </div>
            <div class="config-row">
              <label>Time Slots:</label>
              <input 
                type="number" 
                min="1" 
                max="288" 
                .value=${this.slots.toString()}
                @change=${this.updateSlots}
              />
            </div>
            <div class="config-row">
              <label>Prev Day End:</label>
              <input 
                type="number" 
                min="${this.minValue}" 
                max="${this.maxValue}" 
                step="0.01"
                placeholder="Auto"
                .value=${this.previousDayEndValue?.toString() || ''}
                @change=${this.updatePreviousDayEnd}
              />
            </div>
            <div class="config-row">
              <label>Min Value:</label>
              <input 
                type="number" 
                step="0.1"
                .value=${this.minValue.toString()}
                @change=${this.updateMinValue}
              />
            </div>
            <div class="config-row">
              <label>Max Value:</label>
              <input 
                type="number" 
                step="0.1"
                .value=${this.maxValue.toString()}
                @change=${this.updateMaxValue}
              />
            </div>
            <div class="config-row">
              <label>Snap Value:</label>
              <input 
                type="number" 
                min="0"
                step="0.01"
                placeholder="None"
                .value=${this.snapValue > 0 ? this.snapValue.toString() : ''}
                @change=${this.updateSnapValue}
              />
            </div>
            <div class="config-row">
              <label>X Axis Label:</label>
              <input 
                type="text" 
                placeholder="e.g. Time"
                .value=${this.xAxisLabel}
                @input=${this.updateXAxisLabel}
              />
            </div>
            <div class="config-row">
              <label>Y Axis Label:</label>
              <input 
                type="text" 
                placeholder="e.g. Value"
                .value=${this.yAxisLabel}
                @input=${this.updateYAxisLabel}
              />
            </div>
          </div>
        ` : ''}
        
        <div style="position: relative;">
          ${this.backgroundGraphs.length > 0 ? html`
            <div class="graph-legend ${this.legendCollapsed ? 'collapsed' : ''}">
              <div class="graph-legend-header" @click=${this.toggleLegend}>
                <span class="graph-legend-toggle">▶</span>
                <span>Legend</span>
              </div>
              ${!this.legendCollapsed ? html`
                <div class="graph-legend-items">
                  ${this.backgroundGraphs.map((bgGraph, graphIndex) => html`
                    <div class="graph-legend-item" title=${bgGraph.label || `Entity ${graphIndex + 1}`}>
                      <span class="graph-legend-swatch" style="background: ${this.getBackgroundGraphColor(bgGraph, graphIndex)};"></span>
                      <span class="graph-legend-label">${bgGraph.label || `Entity ${graphIndex + 1}`}</span>
                    </div>
                  `)}
                </div>
              ` : ''}
            </div>
          ` : ''}
          <div class="timeline-canvas-wrapper ${this.collapsed ? '' : 'expanded'}" @click=${this.collapsed && this.allowCollapse ? this.toggleCollapse : null}>
            <div class="timeline-canvas ${this.collapsed ? 'collapsed' : ''} ${this.isDragging ? 'dragging' : ''}">
              <canvas 
                style="touch-action: none;"
                @click=${this.handleCanvasClick}
                @dblclick=${this.handleCanvasDoubleClick}
                @contextmenu=${this.handleCanvasContextMenu}
                @mousedown=${this.handleCanvasMouseDown}
                @mousemove=${this.handleCanvasMouseMove}
                @mouseup=${this.handleCanvasMouseUp}
                @mouseleave=${this.handleCanvasMouseLeave}
                @touchstart=${this.handleCanvasMouseDown}
                @touchmove=${this.handleCanvasMouseMove}
                @touchend=${this.handleCanvasMouseUp}
                @touchcancel=${this.handleCanvasMouseUp}
              ></canvas>
              <div class="cursor-tooltip" hidden></div>
            </div>
            ${this.collapsed ? html`<div class="expand-hint">Click to expand</div>` : ''}
          </div>
          ${this.showScrollNavLeft ? html`
            <div class="scroll-nav left" @click=${this.scrollToStart}>◀</div>
          ` : ''}
          ${this.showScrollNavRight ? html`
            <div class="scroll-nav right" @click=${this.scrollToEnd}>▶</div>
          ` : ''}
        </div>
        
        <div class="info">
          Double-click to add • Drag to move • Right-click/hold to delete • ${this.keyframes.length} keyframes
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'keyframe-timeline': KeyframeTimeline;
  }
}
