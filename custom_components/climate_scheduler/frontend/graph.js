/**
 * Interactive Temperature Graph for Climate Scheduler
 * Allows adding, dragging, and removing temperature nodes
 */

class TemperatureGraph {
    constructor(svgElement, temperatureUnit = '°C') {
        this.svg = svgElement;
        this.nodes = [];
        this.historyData = []; // Array of {entityId, entityName, data: [{time, temp}], color}
        this.draggingNode = null;
        this.dragOffset = { x: 0, y: 0 };
        this.lastTapTime = 0;
        this.lastTapNode = null;
        this.lastClickTime = 0;
        this.lastClickPoint = null;
        this.tooltip = null;
        this.hoverLine = null;
        this.hoverTimeLabel = null;
        this.temperatureUnit = temperatureUnit;
        this.undoStack = [];
        this.undoButton = null;
        
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
            fill: '#1a1a1a',
            stroke: '#ff9800',
            'stroke-width': 2,
            opacity: 0.95
        });
        
        const text = this.createSVGElement('text', {
            x: 50,
            y: 25,
            'text-anchor': 'middle',
            fill: '#fff',
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
            stroke: '#ff9800',
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
            fill: '#ff9800',
            opacity: 0.9
        });
        
        const labelText = this.createSVGElement('text', {
            x: 30,
            y: 16,
            'text-anchor': 'middle',
            fill: '#1a1a1a',
            'font-size': '12',
            'font-weight': 'bold',
            class: 'time-label-text'
        });
        
        this.hoverTimeLabel.appendChild(labelBg);
        this.hoverTimeLabel.appendChild(labelText);
        this.svg.appendChild(this.hoverTimeLabel);
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
        text.textContent = `${time} | ${temp}${unit}`;
        
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
        
        // Draw temperature line
        if (this.nodes.length > 0) {
            this.drawTemperatureLine(g);
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
                fill: '#b0b0b0',
                'font-size': '12'
            });
            text.textContent = entityHistory.entityName || entityHistory.entityId;
            g.appendChild(text);
        });
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
                    fill: '#b0b0b0',
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
                fill: '#b0b0b0',
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
            stroke: '#fff',
            'stroke-width': 2
        });
        g.appendChild(xAxis);
        
        // Y-axis
        const yAxis = this.createSVGElement('line', {
            x1: this.padding.left,
            y1: this.padding.top,
            x2: this.padding.left,
            y2: this.padding.top + graphHeight,
            stroke: '#fff',
            'stroke-width': 2
        });
        g.appendChild(yAxis);
        
        // Current time indicator
        const now = new Date();
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
            fill: '#fff',
            'font-size': '14',
            'font-weight': 'bold'
        });
        xLabel.textContent = 'Time (24 hours)';
        g.appendChild(xLabel);
        
        const yLabel = this.createSVGElement('text', {
            x: 20,
            y: this.padding.top + graphHeight / 2,
            'text-anchor': 'middle',
            fill: '#fff',
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
        
        // Create path with step function (hold value until next node)
        let pathData = '';
        
        // Start from midnight with last node's temperature (wraps from previous day)
        const startX = this.timeToX("00:00");
        const startTemp = sortedNodes[sortedNodes.length - 1].temp;
        pathData = `M ${startX} ${this.tempToY(startTemp)}`;
        
        // Draw steps for each node
        let currentTemp = startTemp;
        sortedNodes.forEach((node) => {
            const x = this.timeToX(node.time);
            
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
        
        // Draw wraparound indicator from last node to first node
        if (sortedNodes.length > 1) {
            const lastNode = sortedNodes[sortedNodes.length - 1];
            const firstNode = sortedNodes[0];
            
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
            
            // Visible node
            const circle = this.createSVGElement('circle', {
                cx: x,
                cy: y,
                r: this.nodeRadius,
                fill: '#03a9f4',
                stroke: '#fff',
                'stroke-width': 2,
                cursor: 'pointer',
                'data-node-index': index
            });
            circle.classList.add('node');
            
            // Node label (hidden if this node is being dragged)
            const text = this.createSVGElement('text', {
                x: x,
                y: y - 20,
                'text-anchor': 'middle',
                fill: '#fff',
                'font-size': '11',
                'font-weight': 'bold',
                'pointer-events': 'none',
                'data-node-index': index
            });
            text.textContent = `${node.temp}°C`;
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
        });
        
        // Also listen for mouseup on document to catch releases outside the SVG
        document.addEventListener('mouseup', this.handlePointerUp.bind(this));
        
        // Touch events
        this.svg.addEventListener('touchstart', this.handlePointerDown.bind(this), { passive: false });
        this.svg.addEventListener('touchmove', this.handlePointerMove.bind(this), { passive: false });
        this.svg.addEventListener('touchend', this.handlePointerUp.bind(this));
        this.svg.addEventListener('touchcancel', this.handlePointerUp.bind(this));
    }
    
    handlePointerDown(event) {
        event.preventDefault();
        
        const point = this.getEventPoint(event);
        const clickedNode = this.getNodeAtPoint(point);
        
        if (clickedNode !== null) {
            // Store initial position and node info
            this.lastTapNode = clickedNode;
            this.lastTapTime = Date.now();
            this.startDragPoint = point;
            
            // Save state before potential drag
            this.saveState();
            
            // Start potential drag
            this.draggingNode = clickedNode;
            const node = this.nodes[clickedNode];
            this.dragOffset.x = point.x - this.timeToX(node.time);
            this.dragOffset.y = point.y - this.tempToY(node.temp);
            
            // Show tooltip immediately
            this.updateTooltip(
                this.timeToX(node.time),
                this.tempToY(node.temp),
                node.time,
                node.temp
            );
            
            // Render to hide the label
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
    
    handlePointerMove(event) {
        const point = this.getEventPoint(event);
        
        if (this.draggingNode === null) {
            // Not dragging - show history tooltip at current mouse position
            const isInGraphArea = point.x >= this.padding.left && 
                                   point.x <= this.width - this.padding.right &&
                                   point.y >= this.padding.top && 
                                   point.y <= this.height - this.padding.bottom;
            
            if (isInGraphArea && this.historyData && this.historyData.length > 0) {
                const mouseTime = this.xToTime(point.x);
                this.showHistoryTooltipAtTime(point.x, point.y, mouseTime);
            } else {
                this.hideTooltip();
            }
            return;
        }
        
        event.preventDefault();
        
        // Update node time (horizontal movement)
        const newTime = this.xToTime(point.x - this.dragOffset.x);
        const snappedTime = this.snapToInterval(newTime);
        
        // Update node temperature (vertical movement)
        const newTemp = this.yToTemp(point.y - this.dragOffset.y);
        const clampedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, newTemp));
        const roundedTemp = Math.round(clampedTemp * 2) / 2; // Round to 0.5°C
        
        // Check if another node already exists at this time
        const existingIndex = this.nodes.findIndex((n, i) => 
            i !== this.draggingNode && n.time === snappedTime
        );
        
        // Only update time if the slot is free
        if (existingIndex === -1) {
            this.nodes[this.draggingNode].time = snappedTime;
        }
        
        this.nodes[this.draggingNode].temp = roundedTemp;
        
        // Show tooltip with current values
        this.updateTooltip(
            this.timeToX(this.nodes[this.draggingNode].time),
            this.tempToY(roundedTemp),
            this.nodes[this.draggingNode].time,
            roundedTemp
        );
        
        this.render();
    }
    
    handlePointerUp(event) {
        if (this.draggingNode !== null) {
            const point = this.getEventPoint(event);
            const dragDistance = this.startDragPoint ? 
                Math.sqrt(Math.pow(point.x - this.startDragPoint.x, 2) + Math.pow(point.y - this.startDragPoint.y, 2)) : 999;
            
            // If didn't drag much (less than 5 pixels), treat as a click to show settings
            if (dragDistance < 5) {
                // No actual drag happened - remove the saved state
                if (this.undoStack.length > 0) {
                    this.undoStack.pop();
                    this.updateUndoButtonState();
                }
                this.showNodeSettings(this.draggingNode);
            } else {
                // Actual drag - notify change
                this.notifyChange();
            }
            
            this.draggingNode = null;
            this.hideTooltip();
            this.startDragPoint = null;
            // Render to show the label again
            this.render();
        } else {
            this.draggingNode = null;
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
            this.nodes[existingIndex].temp = Math.round(clampedTemp * 2) / 2;
        } else {
            // Add new node
            this.nodes.push({
                time: snappedTime,
                temp: Math.round(clampedTemp * 2) / 2
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
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const x = this.timeToX(node.time);
            const y = this.tempToY(node.temp);
            const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
            
            if (distance <= this.nodeTouchRadius) {
                return i;
            }
        }
        return null;
    }
    
    getEventPoint(event) {
        const rect = this.svg.getBoundingClientRect();
        let clientX, clientY;
        
        if (event.type.startsWith('touch')) {
            const touch = event.touches[0] || event.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        // Convert to SVG coordinates
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
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
    
    timeToMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }
    
    minutesToTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }
    
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
        
        // Dispatch event so app.js can handle it with entity context
        const event = new CustomEvent('nodeSettings', {
            detail: { nodeIndex, node }
        });
        this.svg.dispatchEvent(event);
    }
    
    // Public methods
    setNodes(nodes) {
        this.nodes = nodes.map(n => ({ ...n }));
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
