/**
 * Interactive Temperature Graph for Climate Scheduler
 * Allows adding, dragging, and removing temperature nodes
 */

class TemperatureGraph {
    constructor(svgElement, temperatureUnit = '°C', graphSnapStep = 0.1, serverTimeZone = null) {
        this.svg = svgElement;
        this.nodes = [];
        this.historyData = []; // Array of {entityId, entityName, data: [{time, temp}], color}
        this.advanceHistory = []; // Array of {activated_at, target_time, cancelled_at}
        this.draggingNode = null;
        this.draggingSegment = null; // {startIndex, endIndex, initialStartTime, initialEndTime, initialPointerMinutes}
        this.dragOffset = { x: 0, y: 0 };
        this.initialNodeState = null; // Store initial node state to detect actual changes
        this.lastTapTime = 0;
        this.lastTapNode = null;
        this.lastClickTime = 0;
        this.lastClickPoint = null;
        this.tooltip = null;
        this.hoverLine = null;
        this.hoverTimeLabel = null;
        this.temperatureUnit = temperatureUnit;
        this.graphSnapStep = graphSnapStep; // Temperature snap step for rounding
        this.serverTimeZone = serverTimeZone; // Server timezone for time calculations
        this.undoStack = [];
        this.undoButton = null;
        this.tooltipMode = 'history'; // 'history' or 'cursor'
        this.hoveredNode = null; // Track which node is being hovered
        this.selectedNodeIndex = null; // Track which node has settings panel visible
        
        // Graph dimensions
        this.width = 800;
        this.height = 400;
        this.padding = { top: 40, right: 40, bottom: 60, left: 60 };
        
        // Temperature range (5°C to 30°C or 41°F to 86°F)
        if (temperatureUnit === '°F') {
            this.minTemp = 41;  // 5°C in Fahrenheit
            this.maxTemp = 86;  // 30°C in Fahrenheit
        } else {
            this.minTemp = 5;
            this.maxTemp = 30;
        }
        
        // Time settings (24 hours in 15-minute intervals = 96 slots)
        this.timeSlots = 96;
        this.minutesPerSlot = 15;
        
        // Touch target size (48x48 recommended for mobile)
        this.nodeRadius = 8;
        this.nodeTouchRadius = 24;
        
        this.initialize();
    }
    
    initialize() {
        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
        // Prevent default touch scrolling; enables passive listeners without preventDefault
        this.svg.style.touchAction = 'none';
        this.createTooltip();
        this.setupKeyboardShortcuts();
        this.render();
        this.attachEventListeners();
        
        // Update current time line every minute
        setInterval(() => {
            if (!this.draggingNode) {
                this.render();
            }
        }, 60000);
    }
    
    createTooltip() {
        // Create tooltip element
        this.tooltip = this.createSVGElement('g', {
            class: 'tooltip',
            style: 'display: none;'
        });
        
        const bg = this.createSVGElement('rect', {
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            rx: 5,
            fill: this.getThemeColor('--surface'),
            stroke: this.getThemeColor('--accent'),
            'stroke-width': 2,
            opacity: 0.95
        });
        
        const text = this.createSVGElement('text', {
            x: 50,
            y: 25,
            'text-anchor': 'middle',
            fill: this.getThemeColor('--text-primary'),
            'font-size': '14',
            'font-weight': 'bold',
            class: 'tooltip-text'
        });
        
        this.tooltip.appendChild(bg);
        this.tooltip.appendChild(text);
        this.svg.appendChild(this.tooltip);
        
        // Create hover line and time label
        this.hoverLine = this.createSVGElement('line', {
            class: 'hover-line',
            stroke: this.getThemeColor('--accent'),
            'stroke-width': 1,
            'stroke-dasharray': '5,5',
            opacity: 0.7,
            style: 'display: none;'
        });
        this.svg.appendChild(this.hoverLine);
        
        this.hoverTimeLabel = this.createSVGElement('g', {
            class: 'hover-time-label',
            style: 'display: none;'
        });
        
        const labelBg = this.createSVGElement('rect', {
            x: 0,
            y: 0,
            width: 60,
            height: 24,
            rx: 3,
            fill: this.getThemeColor('--accent'),
            opacity: 0.9
        });
        
        const labelText = this.createSVGElement('text', {
            x: 30,
            y: 16,
            'text-anchor': 'middle',
            fill: this.getThemeColor('--background'),
            'font-size': '12',
            'font-weight': 'bold',
            class: 'time-label-text'
        });
        
        this.hoverTimeLabel.appendChild(labelBg);
        this.hoverTimeLabel.appendChild(labelText);
        this.svg.appendChild(this.hoverTimeLabel);
    }
    
    getThemeColor(varName) {
        // Try to get CSS variable from multiple sources
        // First try the SVG element itself, then panel, then document root
        let value = '';
        
        if (this.svg && this.svg.parentElement) {
            value = getComputedStyle(this.svg.parentElement).getPropertyValue(varName).trim();
        }
        
        if (!value) {
            const panel = document.querySelector('climate-scheduler-panel');
            if (panel) {
                value = getComputedStyle(panel).getPropertyValue(varName).trim();
            }
        }
        
        if (!value) {
            value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        }
        
        // Fallback to dark theme colors if still nothing
        if (!value) {
            const darkThemeDefaults = {
                '--surface': '#2d2d2d',
                '--text-primary': '#ffffff',
                '--text-secondary': '#b0b0b0',
                '--accent': '#ff9800',
                '--background': '#1e1e1e'
            };
            value = darkThemeDefaults[varName] || '#ffffff';
        }
        
        return value;
    }
    
    setUndoButton(buttonElement) {
        // Set external HTML undo button reference
        this.undoButton = buttonElement;
        
        // Click handler
        if (this.undoButton) {
            this.undoButton.addEventListener('click', () => this.undo());
            this.updateUndoButtonState();
        }
    }
    
    setupKeyboardShortcuts() {
        // Listen for Ctrl+Z
        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                event.preventDefault();
                this.undo();
            }
        });
    }

    // Allow external code to update the displayed min/max temperature range
    setMinMax(min, max) {
        // Validate numbers
        if (typeof min === 'number' && typeof max === 'number' && !Number.isNaN(min) && !Number.isNaN(max)) {
            // Ensure min is less than max; if not, swap
            if (min >= max) {
                const tmp = min;
                min = max;
                max = tmp;
            }

            this.minTemp = min;
            this.maxTemp = max;

            // Re-render to pick up new scale
            this.render();
        }
    }
    
    setAdvanceHistory(advanceHistory) {
        this.advanceHistory = advanceHistory || [];
        this.render();
    }
    
    // Time and temperature utility methods now use global functions from utils.js
    // Kept as instance methods for backward compatibility
    timeToMinutes(timeStr) {
        return timeToMinutes(timeStr);
    }
    
    minutesToTime(minutes) {
        return minutesToTime(minutes);
    }
    
    interpolateTemperature(nodes, timeStr) {
        return interpolateTemperature(nodes, timeStr);
    }
    
    saveState() {
        // Save current state to undo stack (deep copy)
        this.undoStack.push(JSON.parse(JSON.stringify(this.nodes)));
        
        // Limit undo stack to 20 states
        if (this.undoStack.length > 20) {
            this.undoStack.shift();
        }
        
        this.updateUndoButtonState();
    }
    
    undo() {
        if (this.undoStack.length === 0) return;
        
        // Restore previous state
        this.nodes = this.undoStack.pop();
        this.updateUndoButtonState();
        this.render();
        this.notifyChange();
    }
    
    updateUndoButtonState() {
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
    
    updateTooltip(x, y, time, temp) {
        const text = this.tooltip.querySelector('.tooltip-text');
        // Get temperature unit from global scope
        const unit = (typeof temperatureUnit !== 'undefined') ? temperatureUnit : '°C';
        // Handle null temperature (no change) display
        const tempDisplay = (temp === null || temp === undefined || temp === 'No Change') ? 'No Change' : `${temp}${unit}`;
        text.textContent = `${time} | ${tempDisplay}`;
        
        // Position tooltip above the cursor/node
        const tooltipX = Math.max(50, Math.min(this.width - 50, x));
        const tooltipY = Math.max(50, y - 30);
        
        this.tooltip.setAttribute('transform', `translate(${tooltipX - 50}, ${tooltipY - 40})`);
        this.tooltip.style.display = 'block';
    }
    
    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
        if (this.hoverLine) {
            this.hoverLine.style.display = 'none';
        }
        if (this.hoverTimeLabel) {
            this.hoverTimeLabel.style.display = 'none';
        }
    }
    
    showHistoryTooltipAtTime(mouseX, mouseY, timeStr) {
        if (!this.historyData || this.historyData.length === 0) return;
        
        const text = this.tooltip.querySelector('.tooltip-text');
        const bg = this.tooltip.querySelector('rect');
        
        // Update tooltip colors to match current theme
        bg.setAttribute('fill', this.getThemeColor('--surface'));
        bg.setAttribute('stroke', this.getThemeColor('--accent'));
        text.setAttribute('fill', this.getThemeColor('--text-primary'));
        
        // Show hover line
        const graphTop = this.padding.top;
        const graphBottom = this.height - this.padding.bottom;
        this.hoverLine.setAttribute('x1', mouseX);
        this.hoverLine.setAttribute('x2', mouseX);
        this.hoverLine.setAttribute('y1', graphTop);
        this.hoverLine.setAttribute('y2', graphBottom);
        this.hoverLine.style.display = 'block';
        
        // Show time label above X axis
        const labelText = this.hoverTimeLabel.querySelector('.time-label-text');
        labelText.textContent = timeStr;
        const labelBg = this.hoverTimeLabel.querySelector('rect');
        
        // Calculate label width based on text
        const tempLabel = this.createSVGElement('text', {
            'font-size': '12',
            'font-weight': 'bold'
        });
        tempLabel.textContent = timeStr;
        this.svg.appendChild(tempLabel);
        const labelWidth = Math.max(60, tempLabel.getBBox().width + 16);
        this.svg.removeChild(tempLabel);
        
        labelBg.setAttribute('width', labelWidth);
        labelText.setAttribute('x', labelWidth / 2);
        
        const labelX = Math.max(0, Math.min(this.width - labelWidth, mouseX - labelWidth / 2));
        const labelY = graphBottom + 5;
        this.hoverTimeLabel.setAttribute('transform', `translate(${labelX}, ${labelY})`);
        this.hoverTimeLabel.style.display = 'block';
        
        // Find the closest history data point for each entity at this time
        const temps = [];
        this.historyData.forEach(entityHistory => {
            const temp = this.findTempAtTime(entityHistory.data, timeStr);
            if (temp !== null) {
                temps.push({
                    name: entityHistory.entityName || entityHistory.entityId,
                    temp: temp,
                    color: entityHistory.color
                });
            }
        });
        
        if (temps.length === 0) {
            this.hideTooltip();
            return;
        }
        
        // Clear existing content
        text.textContent = '';
        
        // Create multi-line tooltip
        const lineHeight = 18;
        const padding = 10;
        
        // Add each entity's temperature (no time header now)
        temps.forEach((item, index) => {
            const tspan = this.createSVGElement('tspan', {
                x: padding,
                y: padding + 4 + (index * lineHeight),
                'text-anchor': 'start'
            });
            tspan.textContent = `${item.name}: ${item.temp.toFixed(1)}${this.temperatureUnit}`;
            text.appendChild(tspan);
        });
        
        // Calculate required width based on content
        const bbox = text.getBBox();
        const tooltipWidth = Math.max(150, bbox.width + (padding * 2));
        const totalHeight = (temps.length * lineHeight) + (padding * 2);
        
        bg.setAttribute('height', totalHeight);
        bg.setAttribute('width', tooltipWidth);
        
        // Position tooltip (keep it within graph bounds)
        const halfWidth = tooltipWidth / 2;
        const tooltipX = Math.max(halfWidth, Math.min(this.width - halfWidth, mouseX));
        const tooltipY = Math.max(totalHeight + 10, mouseY - 20);
        
        this.tooltip.setAttribute('transform', `translate(${tooltipX - halfWidth}, ${tooltipY - totalHeight})`);
        this.tooltip.style.display = 'block';
    }
    
    showCursorTooltip(mouseX, mouseY, timeStr, temp) {
        const text = this.tooltip.querySelector('.tooltip-text');
        const bg = this.tooltip.querySelector('rect');
        
        // Update tooltip colors to match current theme
        bg.setAttribute('fill', this.getThemeColor('--surface'));
        bg.setAttribute('stroke', this.getThemeColor('--accent'));
        text.setAttribute('fill', this.getThemeColor('--text-primary'));
        
        // Clear existing content
        text.textContent = '';
        
        // Simple tooltip showing cursor position
        const lineHeight = 18;
        const padding = 10;
        
        const timeTspan = this.createSVGElement('tspan', {
            x: padding,
            y: padding + 4,
            'text-anchor': 'start'
        });
        timeTspan.textContent = `Time: ${timeStr}`;
        text.appendChild(timeTspan);
        
        const tempTspan = this.createSVGElement('tspan', {
            x: padding,
            y: padding + 4 + lineHeight,
            'text-anchor': 'start'
        });
        tempTspan.textContent = `Temp: ${temp}${this.temperatureUnit}`;
        text.appendChild(tempTspan);
        
        // Calculate required width based on content
        const bbox = text.getBBox();
        const tooltipWidth = Math.max(120, bbox.width + (padding * 2));
        const totalHeight = (2 * lineHeight) + (padding * 2);
        
        bg.setAttribute('height', totalHeight);
        bg.setAttribute('width', tooltipWidth);
        
        // Position tooltip (keep it within graph bounds)
        const halfWidth = tooltipWidth / 2;
        const tooltipX = Math.max(halfWidth, Math.min(this.width - halfWidth, mouseX));
        const tooltipY = Math.max(totalHeight + 10, mouseY - 20);
        
        this.tooltip.setAttribute('transform', `translate(${tooltipX - halfWidth}, ${tooltipY - totalHeight})`);
        this.tooltip.style.display = 'block';
    }
    
    findTempAtTime(dataPoints, targetTime) {
        if (!dataPoints || dataPoints.length === 0) return null;
        
        // Convert time to minutes for comparison
        const targetMinutes = this.timeToMinutes(targetTime);
        
        // Find the most recent temperature at or before the target time
        let lastSeenTemp = null;
        
        for (const point of dataPoints) {
            const pointMinutes = this.timeToMinutes(point.time);
            
            // If this point is at or before the target time, it's a candidate
            if (pointMinutes <= targetMinutes) {
                lastSeenTemp = point.temp;
            } else {
                // Once we've passed the target time, stop searching
                break;
            }
        }
        
        return lastSeenTemp;
    }
    
    timeToMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }
    
    render() {
        // Remove existing graph content (but preserve tooltip)
        const existingG = this.svg.querySelector('g:not(.tooltip)');
        if (existingG) {
            existingG.remove();
        }
        
        // Create main group
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        // Draw grid and axes
        this.drawGrid(g);
        this.drawAxes(g);
        
        // Draw history data (actual room temperature)
        if (this.historyData && this.historyData.length > 0) {
            this.drawHistoryLine(g);
            this.drawHistoryLegend(g);
        }
        
        // Draw advance markers and lines
        if (this.advanceHistory && this.advanceHistory.length > 0) {
            this.drawAdvanceMarkers(g);
        }
        
        // Draw temperature line
        if (this.nodes.length > 0) {
            this.drawTemperatureLine(g);
        }

        // Draw advance-applied overlay (adds a visual node/segment when an advance is active)
        if (this.advanceHistory && this.advanceHistory.length > 0 && this.nodes.length > 0) {
            this.drawAdvanceAppliedOverlay(g);
        }
        
        // Draw nodes
        this.drawNodes(g);
        
        // Insert before tooltip (so tooltip stays on top)
        if (this.tooltip) {
            this.svg.insertBefore(g, this.tooltip);
        } else {
            this.svg.appendChild(g);
        }
    }
    
    drawHistoryLine(g) {
        if (!this.historyData || this.historyData.length === 0) return;
        
        // Default colors for multiple entities
        const defaultColors = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ffeb3b', '#795548'];
        
        // Draw each entity's history
        this.historyData.forEach((entityHistory, entityIndex) => {
            if (!entityHistory.data || entityHistory.data.length === 0) return;
            
            const color = entityHistory.color || defaultColors[entityIndex % defaultColors.length];
            
            // Create path for this entity's history line
            let pathData = '';
            
            for (let i = 0; i < entityHistory.data.length; i++) {
                const point = entityHistory.data[i];
                const x = this.timeToX(point.time);
                const y = this.tempToY(point.temp);
                
                if (i === 0) {
                    pathData += `M ${x} ${y}`;
                } else {
                    pathData += ` L ${x} ${y}`;
                }
            }
            
            if (pathData) {
                const path = this.createSVGElement('path', {
                    d: pathData,
                    stroke: color,
                    'stroke-width': 2,
                    fill: 'none',
                    opacity: 0.6
                });
                g.appendChild(path);
                
                // Add small dots at each history point
                entityHistory.data.forEach(point => {
                    const x = this.timeToX(point.time);
                    const y = this.tempToY(point.temp);
                    
                    const dot = this.createSVGElement('circle', {
                        cx: x,
                        cy: y,
                        r: 2,
                        fill: color,
                        opacity: 0.5,
                        style: 'pointer-events: none;'
                    });
                    
                    g.appendChild(dot);
                });
            }
        });
    }
    
    drawHistoryLegend(g) {
        if (!this.historyData || this.historyData.length <= 1) return; // No legend needed for single entity
        
        const defaultColors = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ffeb3b', '#795548'];
        const legendX = this.padding.left + 10;
        const legendY = this.padding.top + 10;
        const lineHeight = 20;
        
        this.historyData.forEach((entityHistory, index) => {
            const color = entityHistory.color || defaultColors[index % defaultColors.length];
            const y = legendY + (index * lineHeight);
            
            // Color indicator line
            const line = this.createSVGElement('line', {
                x1: legendX,
                y1: y,
                x2: legendX + 20,
                y2: y,
                stroke: color,
                'stroke-width': 3,
                opacity: 0.7
            });
            g.appendChild(line);
            
            // Entity name
            const text = this.createSVGElement('text', {
                x: legendX + 25,
                y: y + 4,
                fill: this.getThemeColor('--text-secondary'),
                'font-size': '12'
            });
            text.textContent = entityHistory.entityName || entityHistory.entityId;
            g.appendChild(text);
        });
    }
    
    drawAdvanceMarkers(g) {
        const graphHeight = this.height - this.padding.top - this.padding.bottom;
        const nowUTC = new Date();
        const now = getServerNow(this.serverTimeZone);
        const todayMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        
        // Debug logging
        console.log('Drawing advance markers, history:', this.advanceHistory);
        
        this.advanceHistory.forEach(event => {
            console.log('Processing event:', event);
            console.log('  cancelled_at:', event.cancelled_at);
            console.log('  target_time:', event.target_time);
            
            const activatedTimeUTC = new Date(event.activated_at);
            const activatedTime = getServerDate(activatedTimeUTC, this.serverTimeZone);
            const activatedMinutes = (activatedTimeUTC - todayMidnight) / (1000 * 60);
            
            // Only draw if activated today
            if (activatedMinutes >= 0 && activatedMinutes < 24 * 60) {
                const activatedX = this.timeToX(`${String(activatedTime.getHours()).padStart(2, '0')}:${String(activatedTime.getMinutes()).padStart(2, '0')}`);
                
                // Get the target temperature from the target node
                const targetTemp = event.target_node ? event.target_node.temp : null;
                const markerY = targetTemp !== null ? this.tempToY(targetTemp) : this.padding.top;
                
                // Draw activation marker (diamond) at the target temperature level
                const markerSize = 8;
                const markerPath = `M ${activatedX},${markerY - markerSize} L ${activatedX + markerSize},${markerY} L ${activatedX},${markerY + markerSize} L ${activatedX - markerSize},${markerY} Z`;
                const marker = this.createSVGElement('path', {
                    d: markerPath,
                    fill: '#00ff00',
                    stroke: '#00aa00',
                    'stroke-width': 2,
                    opacity: 0.8
                });
                g.appendChild(marker);
                
                // Determine end point
                let endX, endY, wasCancelled = false;
                
                // Check if this advance was cancelled
                const isCancelled = !!(event.cancelled_at && 
                                      event.cancelled_at !== 'null' && 
                                      event.cancelled_at !== 'None');
                
                console.log('  isCancelled:', isCancelled);
                
                if (isCancelled) {
                    // Cancelled - draw to cancellation time at the same advance temperature
                    const cancelledTimeUTC = new Date(event.cancelled_at);
                    const cancelledTime = getServerDate(cancelledTimeUTC, this.serverTimeZone);
                    const cancelledMinutes = (cancelledTimeUTC - todayMidnight) / (1000 * 60);
                    
                    console.log('  Drawing cancelled line to:', event.cancelled_at);
                    
                    if (cancelledMinutes >= 0 && cancelledMinutes < 24 * 60) {
                        const cancelledTimeStr = `${String(cancelledTime.getHours()).padStart(2, '0')}:${String(cancelledTime.getMinutes()).padStart(2, '0')}`;
                        endX = this.timeToX(cancelledTimeStr);
                        
                        // Keep at the same temperature as the advance (horizontal line)
                        endY = markerY;
                        wasCancelled = true;
                        
                        // Draw cancellation marker (X) at the advance temperature
                        const xSize = 6;
                        const cancelX = this.createSVGElement('path', {
                            d: `M ${endX - xSize},${endY - xSize} L ${endX + xSize},${endY + xSize} M ${endX + xSize},${endY - xSize} L ${endX - xSize},${endY + xSize}`,
                            stroke: '#ff0000',
                            'stroke-width': 3,
                            'stroke-linecap': 'round',
                            opacity: 0.8
                        });
                        g.appendChild(cancelX);
                    }
                } else if (event.target_time && targetTemp !== null) {
                    // Not cancelled - check if the advance is still active (current time hasn't passed target time)
                    const currentMinutes = (now - todayMidnight) / (1000 * 60);
                    const targetMinutes = this.timeToMinutes(event.target_time);
                    
                    console.log('  Current time (minutes):', currentMinutes);
                    console.log('  Target time (minutes):', targetMinutes);
                    
                    // Only draw the line if the advance is still active (hasn't reached target time yet)
                    if (currentMinutes < targetMinutes) {
                        console.log('  Drawing active line to target_time:', event.target_time);
                        endX = this.timeToX(event.target_time);
                        endY = this.tempToY(targetTemp);
                    } else {
                        console.log('  Advance expired, not drawing line');
                    }
                }
                
                // Draw dotted line connecting the activation point to the end point
                if (endX !== undefined) {
                    const dottedLine = this.createSVGElement('line', {
                        x1: activatedX,
                        y1: markerY,
                        x2: endX,
                        y2: endY,
                        stroke: wasCancelled ? '#ff6666' : '#66ff66',
                        'stroke-width': 2,
                        'stroke-dasharray': '5,5',
                        opacity: 0.6
                    });
                    g.appendChild(dottedLine);
                }
            }
        });
    }

    drawAdvanceAppliedOverlay(g) {
        const nowUTC = new Date();
        const now = getServerNow(this.serverTimeZone);
        const todayMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const currentMinutes = (nowUTC - todayMidnight) / (1000 * 60);

        // Use the most recent active (not-cancelled, not-expired) advance event.
        const activeEvents = (this.advanceHistory || [])
            .filter((event) => {
                if (!event || !event.activated_at || !event.target_time) return false;

                const isCancelled = !!(
                    event.cancelled_at &&
                    event.cancelled_at !== 'null' &&
                    event.cancelled_at !== 'None'
                );
                if (isCancelled) return false;

                const targetMinutes = this.timeToMinutes(event.target_time);
                return currentMinutes < targetMinutes;
            })
            .sort((a, b) => {
                const ta = new Date(a.activated_at).getTime();
                const tb = new Date(b.activated_at).getTime();
                return ta - tb;
            });

        if (activeEvents.length === 0) return;

        const event = activeEvents[activeEvents.length - 1];
        const targetNode = event.target_node;
        const targetTemp = targetNode && typeof targetNode.temp === 'number' ? targetNode.temp : null;
        const isNoChange = !!(targetNode && targetNode.noChange);
        if (targetTemp === null || isNoChange) return;

        const activatedTimeUTC = new Date(event.activated_at);
        const activatedTime = getServerDate(activatedTimeUTC, this.serverTimeZone);
        const activatedMinutes = (activatedTimeUTC - todayMidnight) / (1000 * 60);
        if (activatedMinutes < 0 || activatedMinutes >= 24 * 60) return;

        const activatedTimeStr = `${String(activatedTime.getHours()).padStart(2, '0')}:${String(activatedTime.getMinutes()).padStart(2, '0')}`;
        const activatedX = this.timeToX(activatedTimeStr);
        const endX = this.timeToX(event.target_time);
        const yTarget = this.tempToY(targetTemp);

        // Determine the schedule's temperature at the activation time so we can draw the step from it.
        const sortedNodes = [...this.nodes].sort((a, b) => this.timeToMinutes(a.time) - this.timeToMinutes(b.time));
        const nodesWithTemp = sortedNodes.filter((n) => !n.noChange);
        if (nodesWithTemp.length === 0) return;
        const scheduleTempAtActivation = this.interpolateTemperature(nodesWithTemp, activatedTimeStr);
        if (typeof scheduleTempAtActivation !== 'number') return;
        const ySchedule = this.tempToY(scheduleTempAtActivation);

        // Draw the applied override as a green step segment, plus a round node at activation.
        const path = this.createSVGElement('path', {
            d: `M ${activatedX} ${ySchedule} L ${activatedX} ${yTarget} L ${endX} ${yTarget}`,
            stroke: '#00ff00',
            'stroke-width': 3,
            fill: 'none',
            'stroke-linecap': 'square',
            'stroke-linejoin': 'miter',
            opacity: 0.9,
            style: 'pointer-events: none;'
        });
        g.appendChild(path);

        const node = this.createSVGElement('circle', {
            cx: activatedX,
            cy: yTarget,
            r: 6,
            fill: '#00ff00',
            stroke: '#ffffff',
            'stroke-width': 2,
            opacity: 0.95,
            style: 'pointer-events: none;'
        });
        g.appendChild(node);
    }
    
    drawGrid(g) {
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const graphHeight = this.height - this.padding.top - this.padding.bottom;
        
        // Vertical grid lines and labels (every 15 minutes)
        for (let quarter = 0; quarter <= 96; quarter++) {
            const hour = Math.floor(quarter / 4);
            const minutes = (quarter % 4) * 15;
            const x = this.padding.left + (quarter / 96) * graphWidth;
            
            // Only draw grid lines on the hour
            if (minutes === 0 && hour <= 24) {
                const line = this.createSVGElement('line', {
                    x1: x,
                    y1: this.padding.top,
                    x2: x,
                    y2: this.padding.top + graphHeight,
                    stroke: '#444',
                    'stroke-width': hour % 6 === 0 ? 2 : 1,
                    'stroke-opacity': hour % 6 === 0 ? 0.5 : 0.2
                });
                g.appendChild(line);
            }
            
            // Labels for hour and half-hour marks only
            if (hour < 24 && (minutes === 0 || minutes === 30)) {
                const text = this.createSVGElement('text', {
                    x: x,
                    y: this.padding.top + graphHeight + 20,
                    'text-anchor': 'middle',
                    fill: this.getThemeColor('--text-secondary'),
                    'font-size': minutes === 0 ? '12' : '10'
                });
                
                if (minutes === 0) {
                    // Hour labels as numbers
                    text.textContent = hour.toString();
                } else {
                    // Half-hour labels as dots
                    text.textContent = '·';
                    text.setAttribute('font-size', '16');
                    text.setAttribute('font-weight', 'bold');
                }
                
                g.appendChild(text);
            }
        }
        
        // Horizontal grid lines (every 5 degrees)
        for (let temp = this.minTemp; temp <= this.maxTemp; temp += 5) {
            const y = this.tempToY(temp);
            const line = this.createSVGElement('line', {
                x1: this.padding.left,
                y1: y,
                x2: this.padding.left + graphWidth,
                y2: y,
                stroke: '#444',
                'stroke-width': 1,
                'stroke-opacity': 0.3
            });
            g.appendChild(line);
            
            // Temperature labels
            const text = this.createSVGElement('text', {
                x: this.padding.left - 10,
                y: y + 4,
                'text-anchor': 'end',
                fill: this.getThemeColor('--text-secondary'),
                'font-size': '12'
            });
            const unit = (typeof temperatureUnit !== 'undefined') ? temperatureUnit : '°C';
            text.textContent = `${temp}${unit}`;
            g.appendChild(text);
        }
    }
    
    drawAxes(g) {
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const graphHeight = this.height - this.padding.top - this.padding.bottom;
        
        // X-axis
        const xAxis = this.createSVGElement('line', {
            x1: this.padding.left,
            y1: this.padding.top + graphHeight,
            x2: this.padding.left + graphWidth,
            y2: this.padding.top + graphHeight,
            stroke: this.getThemeColor('--text-primary'),
            'stroke-width': 2
        });
        g.appendChild(xAxis);
        
        // Y-axis
        const yAxis = this.createSVGElement('line', {
            x1: this.padding.left,
            y1: this.padding.top,
            x2: this.padding.left,
            y2: this.padding.top + graphHeight,
            stroke: this.getThemeColor('--text-primary'),
            'stroke-width': 2
        });
        g.appendChild(yAxis);
        
        // Current time indicator (use server timezone)
        const now = getServerNow(this.serverTimeZone);
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const currentTime = this.minutesToTime(currentMinutes);
        const currentX = this.timeToX(currentTime);
        
        const timeLine = this.createSVGElement('line', {
            x1: currentX,
            y1: this.padding.top,
            x2: currentX,
            y2: this.padding.top + graphHeight,
            stroke: '#00ff00',
            'stroke-width': 2,
            'stroke-dasharray': '5,5',
            opacity: 0.7
        });
        g.appendChild(timeLine);
        
        // Time label at top
        const timeLabel = this.createSVGElement('text', {
            x: currentX,
            y: this.padding.top - 10,
            'text-anchor': 'middle',
            fill: '#00ff00',
            'font-size': '12',
            'font-weight': 'bold'
        });
        timeLabel.textContent = currentTime;
        g.appendChild(timeLabel);
        
        // Axis labels
        const xLabel = this.createSVGElement('text', {
            x: this.padding.left + graphWidth / 2,
            y: this.height - 10,
            'text-anchor': 'middle',
            fill: this.getThemeColor('--text-primary'),
            'font-size': '14',
            'font-weight': 'bold'
        });
        xLabel.textContent = 'Time (24 hours)';
        g.appendChild(xLabel);
        
        const yLabel = this.createSVGElement('text', {
            x: 20,
            y: this.padding.top + graphHeight / 2,
            'text-anchor': 'middle',
            fill: this.getThemeColor('--text-primary'),
            'font-size': '14',
            'font-weight': 'bold',
            transform: `rotate(-90, 20, ${this.padding.top + graphHeight / 2})`
        });
        yLabel.textContent = `Temperature (${this.temperatureUnit})`;
        g.appendChild(yLabel);
    }
    
    drawTemperatureLine(g) {
        // Sort nodes by time
        const sortedNodes = [...this.nodes].sort((a, b) => 
            this.timeToMinutes(a.time) - this.timeToMinutes(b.time)
        );
        
        if (sortedNodes.length < 1) return;
        
        // Filter nodes that are not marked as "no change"
        const nodesWithTemp = sortedNodes.filter(node => !node.noChange);
        
        if (nodesWithTemp.length < 1) return; // No temperature nodes to draw
        
        // Create path with step function (hold value until next node)
        let pathData = '';
        
        // Start from midnight with temperature from previous day's last node
        // In 7-day or weekday/weekend modes, use previousDayLastTemp if set
        // Otherwise fall back to current day's last node (for all_days mode)
        const startX = this.timeToX("00:00");
        const startTemp = (this.previousDayLastTemp !== null && this.previousDayLastTemp !== undefined) 
            ? this.previousDayLastTemp 
            : nodesWithTemp[nodesWithTemp.length - 1].temp;
        pathData = `M ${startX} ${this.tempToY(startTemp)}`;
        
        // Draw steps for each node that has a temperature
        let currentTemp = startTemp;
        sortedNodes.forEach((node) => {
            const x = this.timeToX(node.time);
            
            // Skip nodes marked as "no change" - don't draw line to them
            if (node.noChange) {
                return;
            }
            
            // Draw horizontal line at current temp to this node's x position
            pathData += ` L ${x} ${this.tempToY(currentTemp)}`;
            
            // Draw vertical line up/down to new temperature
            pathData += ` L ${x} ${this.tempToY(node.temp)}`;
            
            currentTemp = node.temp;
        });
        
        // Extend final temperature to end of day
        const endX = this.timeToX("24:00");
        pathData += ` L ${endX} ${this.tempToY(currentTemp)}`;
        
        const path = this.createSVGElement('path', {
            d: pathData,
            stroke: '#ff9800',
            'stroke-width': 3,
            fill: 'none',
            'stroke-linecap': 'square',
            'stroke-linejoin': 'miter'
        });
        
        g.appendChild(path);
        
        // Draw wraparound indicator from last node to first node (only if both have temp)
        if (nodesWithTemp.length > 1) {
            const lastNode = nodesWithTemp[nodesWithTemp.length - 1];
            const firstNode = nodesWithTemp[0];
            
            // Visual indicator showing the connection wraps around
            const wrapPath = this.createSVGElement('path', {
                d: `M ${this.timeToX(lastNode.time)} ${this.tempToY(lastNode.temp)} 
                    L ${endX} ${this.tempToY(lastNode.temp)} 
                    M ${startX} ${this.tempToY(lastNode.temp)} 
                    L ${this.timeToX(firstNode.time)} ${this.tempToY(lastNode.temp)}
                    L ${this.timeToX(firstNode.time)} ${this.tempToY(firstNode.temp)}`,
                stroke: '#ff9800',
                'stroke-width': 3,
                fill: 'none',
                'stroke-dasharray': '5,5',
                'stroke-linecap': 'square',
                opacity: 0.5
            });
            g.appendChild(wrapPath);
        }
    }
    
    drawNodes(g) {
        this.nodes.forEach((node, index) => {
            const x = this.timeToX(node.time);
            const y = this.tempToY(node.temp);
            
            // Touch target (invisible larger circle)
            const touchTarget = this.createSVGElement('circle', {
                cx: x,
                cy: y,
                r: this.nodeTouchRadius,
                fill: 'transparent',
                cursor: 'pointer',
                'data-node-index': index
            });
            touchTarget.classList.add('node-touch-target');
            
            // Visible node - different style for "no change" nodes
            const isSelected = this.selectedNodeIndex === index;
            const isNoChange = node.noChange === true;
            const nodeColor = isNoChange ? (isSelected ? '#ff9800' : '#9e9e9e') : (isSelected ? '#4caf50' : '#03a9f4');
            const circle = this.createSVGElement('circle', {
                cx: x,
                cy: y,
                r: this.nodeRadius,
                fill: nodeColor,
                stroke: '#fff',
                'stroke-width': 2,
                cursor: 'pointer',
                'data-node-index': index
            });
            circle.classList.add('node');
            
            // Add a special marker for "no change" nodes (horizontal line through node)
            if (isNoChange) {
                const marker = this.createSVGElement('line', {
                    x1: x - this.nodeRadius,
                    y1: y,
                    x2: x + this.nodeRadius,
                    y2: y,
                    stroke: '#fff',
                    'stroke-width': 2,
                    'pointer-events': 'none'
                });
                g.appendChild(marker);
            }
            
            // Node label (hidden if this node is being dragged)
            const text = this.createSVGElement('text', {
                x: x,
                y: y - 20,
                'text-anchor': 'middle',
                fill: this.getThemeColor('--text-primary'),
                'font-size': '11',
                'font-weight': 'bold',
                'pointer-events': 'none',
                'data-node-index': index
            });
            text.textContent = isNoChange ? 'No Change' : `${node.temp}${this.temperatureUnit}`;
            text.classList.add('node-label');
            
            // Hide label if this node is being dragged
            if (this.draggingNode === index) {
                text.style.display = 'none';
            }
            
            g.appendChild(touchTarget);
            g.appendChild(circle);
            g.appendChild(text);
        });
    }
    
    attachEventListeners() {
        // Mouse events
        this.svg.addEventListener('mousedown', this.handlePointerDown.bind(this));
        this.svg.addEventListener('mousemove', this.handlePointerMove.bind(this));
        this.svg.addEventListener('mouseup', this.handlePointerUp.bind(this));
        this.svg.addEventListener('mouseleave', (e) => {
            this.hideTooltip();
            if (this.hoveredNode !== null) {
                this.hoveredNode = null;
                this.render();
            }
        });
        
        // Also listen for mouseup on document to catch releases outside the SVG
        document.addEventListener('mouseup', this.handlePointerUp.bind(this));
        
        // Touch events (passive for performance; touch-action disables scrolling)
        this.svg.addEventListener('touchstart', this.handlePointerDown.bind(this), { passive: true });
        this.svg.addEventListener('touchmove', this.handlePointerMove.bind(this), { passive: true });
        this.svg.addEventListener('touchend', this.handlePointerUp.bind(this));
        this.svg.addEventListener('touchcancel', this.handlePointerUp.bind(this));
    }
    
    handlePointerDown(event) {
        // Avoid preventDefault on touch events; touch-action handles scroll behavior
        if (event.type !== 'touchstart') {
            event.preventDefault();
        }
        
        const point = this.getEventPoint(event);
        const clickedNode = this.getNodeAtPoint(point);
        
        if (clickedNode !== null) {
            // Store initial position and node info
            this.lastTapNode = clickedNode;
            this.lastTapTime = Date.now();
            this.startDragPoint = point;
            
            // Save initial node state to detect changes
            const node = this.nodes[clickedNode];
            this.initialNodeState = {
                time: node.time,
                temp: node.temp
            };
            
            // Save state before potential drag
            this.saveState();
            
            // Start potential drag
            this.draggingNode = clickedNode;
            
            // Calculate drag offset
            const nodeY = this.tempToY(node.temp);
            
            this.dragOffset.x = point.x - this.timeToX(node.time);
            this.dragOffset.y = point.y - nodeY;
            
            // Show tooltip immediately
            const isNoChange = node.noChange === true;
            const displayTemp = isNoChange ? 'No Change' : node.temp;
            this.updateTooltip(
                this.timeToX(node.time),
                nodeY,
                node.time,
                displayTemp
            );
            
            // Render to hide the label
            this.render();
        } else {
            // Check if clicking on a segment
            const clickedSegment = this.getSegmentAtPoint(point);
            
            if (clickedSegment !== null) {
                // Save state before dragging segment
                this.saveState();
                
                // Start segment drag
                this.draggingSegment = {
                    startIndex: clickedSegment.startIndex,
                    endIndex: clickedSegment.endIndex,
                    initialStartTime: this.nodes[clickedSegment.startIndex].time,
                    initialEndTime: this.nodes[clickedSegment.endIndex].time,
                    initialPointerMinutes: this.xToMinutes(point.x)
                };
                
                this.render();
            } else {
                // Check for double-click to add new node
                const now = Date.now();
                const timeSinceLastClick = now - this.lastClickTime;
                const isSameLocation = this.lastClickPoint && 
                    Math.abs(point.x - this.lastClickPoint.x) < 10 &&
                    Math.abs(point.y - this.lastClickPoint.y) < 10;
                
                if (timeSinceLastClick < 500 && isSameLocation) {
                    // Double-click detected - add node
                    this.addNode(point);
                    this.lastClickTime = 0; // Reset to prevent triple-click issues
                    this.lastClickPoint = null;
                } else {
                    // First click - just record it
                    this.lastClickTime = now;
                    this.lastClickPoint = point;
                }
            }
        }
    }
    
    handlePointerMove(event) {
        const point = this.getEventPoint(event);
        
        if (this.draggingNode === null && this.draggingSegment === null) {
            // Update hovered node based on cursor position
            const hoveredNodeIndex = this.getNodeAtPoint(point);
            if (hoveredNodeIndex !== this.hoveredNode) {
                this.hoveredNode = hoveredNodeIndex;
                this.render();
            }
            
            // Not dragging - show tooltip based on mode
            const isInGraphArea = point.x >= this.padding.left && 
                                   point.x <= this.width - this.padding.right &&
                                   point.y >= this.padding.top && 
                                   point.y <= this.height - this.padding.bottom;
            
            if (isInGraphArea) {
                const mouseTime = this.xToTime(point.x);
                
                if (this.tooltipMode === 'history' && this.historyData && this.historyData.length > 0) {
                    // Show historical temperature
                    this.showHistoryTooltipAtTime(point.x, point.y, mouseTime);
                } else if (this.tooltipMode === 'cursor') {
                    // Show cursor position (time and temperature)
                    const mouseTemp = this.yToTemp(point.y);
                    const clampedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, mouseTemp));
                    const multiplier = 1 / this.graphSnapStep;
                    const roundedTemp = Math.round(clampedTemp * multiplier) / multiplier;
                    const snappedTime = this.snapToInterval(mouseTime);
                    this.showCursorTooltip(point.x, point.y, snappedTime, roundedTemp);
                } else {
                    this.hideTooltip();
                }
            } else {
                this.hideTooltip();
            }
            return;
        }
        
        // Avoid preventDefault on touchmove; touch-action handles scroll behavior
        if (event.type !== 'touchmove') {
            event.preventDefault();
        }
        
        // Handle segment dragging
        if (this.draggingSegment !== null) {
            const pointerMinutes = this.xToMinutes(point.x);
            const deltaMinutes = pointerMinutes - this.draggingSegment.initialPointerMinutes;
            const snappedDelta = Math.round(deltaMinutes / this.minutesPerSlot) * this.minutesPerSlot;
            
            const startMinutes = this.timeToMinutes(this.draggingSegment.initialStartTime);
            const endMinutes = this.timeToMinutes(this.draggingSegment.initialEndTime);
            
            const newStartMinutes = startMinutes + snappedDelta;
            const newEndMinutes = endMinutes + snappedDelta;
            
            // Check if both times are within bounds (0-1440 minutes)
            if (newStartMinutes >= 0 && newEndMinutes <= 1440) {
                const newStartTime = this.minutesToTime(newStartMinutes);
                const newEndTime = this.minutesToTime(newEndMinutes);
                
                // Check if any other nodes conflict with these times
                const hasConflict = this.nodes.some((n, i) => {
                    if (i === this.draggingSegment.startIndex || i === this.draggingSegment.endIndex) {
                        return false;
                    }
                    return n.time === newStartTime || n.time === newEndTime;
                });
                
                if (!hasConflict) {
                    this.nodes[this.draggingSegment.startIndex].time = newStartTime;
                    this.nodes[this.draggingSegment.endIndex].time = newEndTime;
                    
                    // Update settings panels if visible
                    this.updateNodeSettingsIfVisible(this.draggingSegment.startIndex);
                    this.updateNodeSettingsIfVisible(this.draggingSegment.endIndex);
                }
            }
            
            this.render();
            return;
        }
        
        // Update node time (horizontal movement)
        const newTime = this.xToTime(point.x - this.dragOffset.x);
        const snappedTime = this.snapToInterval(newTime);
        
        // Update node temperature (vertical movement)
        const node = this.nodes[this.draggingNode];
        const newTemp = this.yToTemp(point.y - this.dragOffset.y);
        const clampedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, newTemp));
        const multiplier = 1 / this.graphSnapStep;
        const roundedTemp = Math.round(clampedTemp * multiplier) / multiplier;
        this.nodes[this.draggingNode].temp = roundedTemp;
        
        // Check if another node already exists at this time
        const existingIndex = this.nodes.findIndex((n, i) => 
            i !== this.draggingNode && n.time === snappedTime
        );
        
        // Only update time if the slot is free
        if (existingIndex === -1) {
            this.nodes[this.draggingNode].time = snappedTime;
        }
        
        // Update the settings panel if it's showing this node
        this.updateNodeSettingsIfVisible(this.draggingNode);
        
        // Show tooltip based on mode
        if (this.tooltipMode === 'cursor') {
            // Show cursor position (time and temperature being dragged to)
            const isNoChange = this.nodes[this.draggingNode].noChange === true;
            const displayTemp = isNoChange ? 'No Change' : this.nodes[this.draggingNode].temp;
            const displayY = this.tempToY(this.nodes[this.draggingNode].temp);
            this.updateTooltip(
                this.timeToX(this.nodes[this.draggingNode].time),
                displayY,
                this.nodes[this.draggingNode].time,
                displayTemp
            );
        } else {
            // History mode - show time/temp at cursor position
            const mouseTime = this.xToTime(point.x);
            const snappedMouseTime = this.snapToInterval(mouseTime);
            const mouseTemp = this.yToTemp(point.y);
            const clampedMouseTemp = Math.max(this.minTemp, Math.min(this.maxTemp, mouseTemp));
            const multiplier = 1 / this.graphSnapStep;
            const roundedMouseTemp = Math.round(clampedMouseTemp * multiplier) / multiplier;
            this.showCursorTooltip(point.x, point.y, snappedMouseTime, roundedMouseTemp);
        }
        
        this.render();
    }
    
    handlePointerUp(event) {
        if (this.draggingNode !== null) {
            const point = this.getEventPoint(event);
            const dragDistance = this.startDragPoint ? 
                Math.sqrt(Math.pow(point.x - this.startDragPoint.x, 2) + Math.pow(point.y - this.startDragPoint.y, 2)) : 999;

            // Check if node values actually changed
            const node = this.nodes[this.draggingNode];
            const nodeChanged = this.initialNodeState && 
                (node.time !== this.initialNodeState.time || node.temp !== this.initialNodeState.temp);

            // Only save if values actually changed
            if (nodeChanged) {
                this.notifyChange();
            } else {
                // No actual change - remove the saved state to keep undo stack clean
                if (this.undoStack.length > 0) {
                    this.undoStack.pop();
                    this.updateUndoButtonState();
                }
            }

            // Always show node settings (whether clicked or dragged)
            this.showNodeSettings(this.draggingNode);

            this.draggingNode = null;
            this.draggingSegment = null;
            this.initialNodeState = null;
            this.hideTooltip();
            this.startDragPoint = null;
            // Render to show the label again
            this.render();
        } else if (this.draggingSegment !== null) {
            // Segment drag completed - notify change
            this.notifyChange();
            this.draggingSegment = null;
            this.hideTooltip();
            this.render();
        } else {
            this.draggingNode = null;
            this.draggingSegment = null;
            this.hideTooltip();
        }
    }
    
    addNode(point) {
        // Save state before adding node
        this.saveState();
        
        const time = this.xToTime(point.x);
        const temp = this.yToTemp(point.y);
        
        // Snap to 15-minute intervals
        const snappedTime = this.snapToInterval(time);
        const clampedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, temp));
        
        // Check if node already exists at this time
        const existingIndex = this.nodes.findIndex(n => n.time === snappedTime);
        if (existingIndex !== -1) {
            // Update existing node
            const multiplier = 1 / this.graphSnapStep;
            this.nodes[existingIndex].temp = Math.round(clampedTemp * multiplier) / multiplier;
        } else {
            // Add new node
            const multiplier = 1 / this.graphSnapStep;
            this.nodes.push({
                time: snappedTime,
                temp: Math.round(clampedTemp * multiplier) / multiplier
            });
        }
        
        this.render();
        this.notifyChange();
    }
    
    removeNode(index) {
        // Save state before removing node
        this.saveState();
        
        this.nodes.splice(index, 1);
        this.render();
        this.notifyChange();
    }
    
    getNodeAtPoint(point) {
        // Preconditions
        if (this.nodes.length == 0) {
            return null;  // No nodes, so no node at point
        }
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
            throw new Error('point must be an object with numeric x and y properties')
        }

        // Logic
        let closestIndex = null;
        let closestDistance = Infinity;
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const x = this.timeToX(node.time);
            const y = this.tempToY(node.temp);
            const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
            
            if (distance <= this.nodeTouchRadius && distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }
        return closestIndex;
    }

    getSortedNodeIndices() {
        return [...Array(this.nodes.length).keys()].sort((a, b) => 
            this.timeToMinutes(this.nodes[a].time) - this.timeToMinutes(this.nodes[b].time)
        );
    }

    getSegments() {
        const indices = this.getSortedNodeIndices();
        const segments = [];

        for (let i = 0; i < indices.length - 1; i++) {
            const startIndex = indices[i];
            const endIndex = indices[i + 1];
            const startNode = this.nodes[startIndex];
            const endNode = this.nodes[endIndex];

            const xStart = this.timeToX(startNode.time);
            const xEnd = this.timeToX(endNode.time);
            const y = this.tempToY(startNode.temp);

            segments.push({
                startIndex,
                endIndex,
                xStart: Math.min(xStart, xEnd),
                xEnd: Math.max(xStart, xEnd),
                tempY: y
            });
        }

        return segments;
    }

    getSegmentAtPoint(point) {
        if (this.nodes.length < 2) return null;

        const segments = this.getSegments();
        const threshold = 12; // px buffer for easier grabbing

        for (const segment of segments) {
            if (point.x >= segment.xStart - threshold && point.x <= segment.xEnd + threshold) {
                const distance = Math.abs(point.y - segment.tempY);
                if (distance <= threshold) {
                    return { startIndex: segment.startIndex, endIndex: segment.endIndex };
                }
            }
        }

        return null;
    }
    
    getEventPoint(event) {
        let clientX, clientY;
        
        if (event.type.startsWith('touch')) {
            const touch = event.touches[0] || event.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        // Use SVG's native coordinate transformation
        const pt = this.svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());
        
        return {
            x: svgP.x,
            y: svgP.y
        };
    }
    
    // Coordinate conversion methods
    timeToX(timeStr) {
        const minutes = this.timeToMinutes(timeStr);
        const graphWidth = this.width - this.padding.left - this.padding.right;
        return this.padding.left + (minutes / 1440) * graphWidth;
    }
    
    xToTime(x) {
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const minutes = ((x - this.padding.left) / graphWidth) * 1440;
        return this.minutesToTime(Math.max(0, Math.min(1440, minutes)));
    }

    xToMinutes(x) {
        return this.timeToMinutes(this.xToTime(x));
    }
    
    tempToY(temp) {
        const graphHeight = this.height - this.padding.top - this.padding.bottom;
        const ratio = (temp - this.minTemp) / (this.maxTemp - this.minTemp);
        return this.padding.top + graphHeight - (ratio * graphHeight);
    }
    
    yToTemp(y) {
        const graphHeight = this.height - this.padding.top - this.padding.bottom;
        const ratio = (this.padding.top + graphHeight - y) / graphHeight;
        return this.minTemp + ratio * (this.maxTemp - this.minTemp);
    }
    
    // These duplicate definitions are removed - now delegating to global functions
    
    snapToInterval(timeStr) {
        const minutes = this.timeToMinutes(timeStr);
        const snappedMinutes = Math.round(minutes / this.minutesPerSlot) * this.minutesPerSlot;
        return this.minutesToTime(Math.min(1440, snappedMinutes));
    }
    
    createSVGElement(type, attributes) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', type);
        for (const [key, value] of Object.entries(attributes)) {
            element.setAttribute(key, value);
        }
        return element;
    }
    
    showNodeSettings(nodeIndex) {
        const node = this.nodes[nodeIndex];
        if (!node) return;
        
        // Update selected node and re-render to show green highlight
        this.selectedNodeIndex = nodeIndex;
        this.render();
        
        // Dispatch event so app.js can handle it with entity context
        const event = new CustomEvent('nodeSettings', {
            detail: { nodeIndex, node }
        });
        this.svg.dispatchEvent(event);
    }
    
    updateNodeSettingsIfVisible(nodeIndex) {
        // Dispatch update event if this node's settings are currently visible
        const event = new CustomEvent('nodeSettingsUpdate', {
            detail: { nodeIndex, node: this.nodes[nodeIndex] }
        });
        this.svg.dispatchEvent(event);
    }
    
    setTooltipMode(mode) {
        this.tooltipMode = mode;
    }
    
    // Public methods
    setNodes(nodes) {
        this.nodes = nodes.map(n => ({ ...n }));
        this.render();
    }
    
    setPreviousDayLastTemp(temp) {
        // Set the temperature from the previous day's last node
        // Used for drawing the line at the start of the current day
        this.previousDayLastTemp = temp;
        this.render();
    }
    
    getNodes() {
        return this.nodes.map(n => ({ ...n }));
    }
    
    updateNode(index, properties) {
        if (index >= 0 && index < this.nodes.length) {
            Object.assign(this.nodes[index], properties);
            // Don't re-render - let the caller decide when to render
        }
    }
    
    setHistoryData(historyData) {
        // Support both old format (array of {time, temp}) and new format (array of entities)
        if (!historyData || historyData.length === 0) {
            this.historyData = [];
        } else if (historyData[0] && historyData[0].entityId !== undefined) {
            // New format: array of {entityId, entityName, data, color}
            this.historyData = historyData;
        } else {
            // Old format: array of {time, temp} - convert to new format
            this.historyData = [{
                entityId: 'single',
                entityName: 'Temperature',
                data: historyData,
                color: '#2196f3'
            }];
        }
        this.render();
    }
    
    notifyChange(force = false) {
        // Dispatch custom event for external listeners
        const event = new CustomEvent('nodesChanged', {
            detail: { nodes: this.getNodes(), force: force }
        });
        this.svg.dispatchEvent(event);
    }
    
    removeNodeByIndex(index) {
        this.removeNode(index);
    }
}
