/**
 * Main Application Logic
 * Connects the UI components with the Home Assistant API
 */

// Helper function to get the correct document root for DOM queries
function getDocumentRoot() {
    return window.climateSchedulerPanelRoot || document;
}

let haAPI;
let graph;
let climateEntities = [];
let entitySchedules = new Map(); // Track which entities have schedules locally
let temperatureUnit = '°C'; // Default to Celsius, updated from HA config
let storedTemperatureUnit = null; // Unit that schedules were saved in

// Temperature conversion functions are now in utils.js

function convertScheduleNodes(nodes, fromUnit, toUnit) {
    if (!nodes || nodes.length === 0 || fromUnit === toUnit) return nodes;
    const multiplier = 1 / graphSnapStep;
    return nodes.map(node => ({
        ...node,
        temp: Math.round(convertTemperature(node.temp, fromUnit, toUnit) * multiplier) / multiplier
    }));
}
let allGroups = {}; // Store all groups data
let allEntities = {}; // Store all entities data with their schedules
let currentGroup = null; // Currently selected group
let currentEntityId = null; // Currently selected individual entity (legacy path, mostly unused now)
let editingProfile = null; // Profile being edited (null means editing active profile)
let tooltipMode = 'history'; // 'history' or 'cursor'
let debugPanelEnabled = localStorage.getItem('debugPanelEnabled') === 'true'; // Debug panel visibility
let graphSnapStep = parseFloat(localStorage.getItem('graphSnapStep')) || 0.5; // Temperature snap step for graph dragging
let inputTempStep = parseFloat(localStorage.getItem('inputTempStep')) || 0.1; // Temperature step for input fields
let currentDay = null; // Currently selected day for editing (e.g., 'mon', 'weekday')
let currentScheduleMode = 'all_days'; // Current schedule mode: 'all_days', '5/2', 'individual'
let isLoadingSchedule = false; // Flag to prevent auto-save during schedule loading
let isSaveInProgress = false; // Flag to prevent concurrent saves
let pendingSaveNeeded = false; // Flag to indicate a save was skipped and needs to be retried
let saveTimeout = null; // Timeout for debouncing save operations
const SAVE_DEBOUNCE_MS = 300; // Wait 300ms after last change before saving
let serverTimeZone = null; // Store the Home Assistant server timezone

// Debug logging function
function debugLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
        //
    
    if (debugPanelEnabled) {
        const debugContent = getDocumentRoot().querySelector('#debug-content');
        if (debugContent) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `debug-message ${type}`;
            messageDiv.innerHTML = `<span class="debug-timestamp">${timestamp}</span>${message}`;
            debugContent.appendChild(messageDiv);
            debugContent.scrollTop = debugContent.scrollHeight;
        }
    }
}

function showToast(message, type = 'info', duration = 4000) {
    const root = getDocumentRoot();
    let container = root.querySelector('.toast-container');
    
    // Create container if it doesn't exist
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        root.appendChild(container);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            // Remove container if empty
            if (container.children.length === 0) {
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }
        }, 300); // Match animation duration
    }, duration);
}

// Initialize application
async function initApp() {
    try {
        // Detect mobile app environment
        const isMobileApp = /HomeAssistant|Home%20Assistant/.test(navigator.userAgent);
        if (isMobileApp) {
            // Running in Home Assistant mobile app
        }
        
        // Initialize Home Assistant API (only if not already initialized)
        if (!haAPI) {
            haAPI = new HomeAssistantAPI();
        }
        await haAPI.connect();
        
        // Get Home Assistant configuration for temperature unit and timezone
        const config = await haAPI.getConfig();
        if (config && config.unit_system && config.unit_system.temperature) {
            temperatureUnit = config.unit_system.temperature === '°F' ? '°F' : '°C';
        }
        if (config && config.time_zone) {
            serverTimeZone = config.time_zone;
            debugLog(`Server timezone: ${serverTimeZone}`);
        }
        
        // Note: graph is initialized when entity/group is selected for editing
        // No need to initialize it on page load
        
        // Load climate entities
        await loadClimateEntities();
        
        // Load all schedules from backend
        await loadAllSchedules();
        
        // Load groups
        await loadGroups();
        
        // Subscribe to state changes
        await haAPI.subscribeToStateChanges();
        haAPI.onStateUpdate(handleStateUpdate);
        
        // Set up UI event listeners
        setupEventListeners();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        console.error('Error stack:', error.stack);
        console.error('Error message:', error.message);
        
        // Show user-friendly error in the UI
        const container = getDocumentRoot().querySelector('.container');
        if (container) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <h2>❌ Connection Failed</h2>
                    <p style="color: #666; margin: 20px 0;">Could not connect to Home Assistant</p>
                    <details style="text-align: left; max-width: 600px; margin: 20px auto; padding: 10px; background: #f5f5f5; border-radius: 8px;">
                        <summary style="cursor: pointer; font-weight: bold;">Technical Details</summary>
                        <pre style="margin-top: 10px; overflow-x: auto;">${error.message}\n\n${error.stack}</pre>
                    </details>
                    <p style="margin-top: 20px;">
                        <strong>Troubleshooting:</strong><br>
                        • Try refreshing the page (pull down on mobile)<br>
                        • Check if you're logged into Home Assistant<br>
                        • Restart the Home Assistant app<br>
                        • Check Settings → Companion App → Debugging
                    </p>
                </div>
            `;
        }
    }
}

// Load all climate entities
async function loadClimateEntities() {
    try {
        climateEntities = await haAPI.getClimateEntities();
        await renderEntityList();
        // Entity list rendered
    } catch (error) {
        console.error('Failed to load climate entities:', error);
        alert('Failed to load climate entities');
    }
}

// Load all schedules from backend to populate entitySchedules Map
async function loadAllSchedules() {
    try {
        // Load schedules for all entities
        for (const entity of climateEntities) {
            const result = await haAPI.getSchedule(entity.entity_id);
            
            // Extract schedule from response wrapper
            const schedule = result?.response || result;
            
            // Only add to entitySchedules if it has nodes AND is not ignored
            // The enabled state affects visual display, not categorization
            if (schedule && schedule.nodes && schedule.nodes.length > 0 && !schedule.ignored) {
                // Entity has a schedule and is not ignored - add to Map
                entitySchedules.set(entity.entity_id, schedule.nodes);
            }
        }
        
        // Re-render entity list with loaded schedules
        await renderEntityList();
    } catch (error) {
        console.error('Failed to load schedules:', error);
    }
}

// Load all groups from backend
async function loadGroups() {
    try {
        const result = await haAPI.getGroups();
        
        // Extract groups from response - may be wrapped in response.groups
        let groups = result?.response || result || {};
        
        // If there's a 'groups' key, use that instead
        if (groups.groups && typeof groups.groups === 'object') {
            groups = groups.groups;
        }
        
        allGroups = groups;
        
        // Render groups section
        renderGroups();
        
        // Render unmonitored entities section
        renderIgnoredEntities();
        
        // Re-render entity list now that groups are loaded
        // This will hide entities that are in groups
        await renderEntityList();
    } catch (error) {
        console.error('Failed to load groups:', error);
        allGroups = {};
    }
}

// Render groups in the groups section
function renderGroups() {
    const groupsList = getDocumentRoot().querySelector('#groups-list');
    const groupsCount = getDocumentRoot().querySelector('#groups-count');
    if (!groupsList) return;
    
    // Save current expanded/collapsed state and current editing group
    const expandedStates = {};
    const containers = groupsList.querySelectorAll('.group-container');
    containers.forEach(container => {
        const groupName = container.dataset.groupName;
        if (groupName) {
            expandedStates[groupName] = {
                collapsed: container.classList.contains('collapsed'),
                editing: container.classList.contains('expanded')
            };
        }
    });
    
    // Clear existing groups
    groupsList.innerHTML = '';
    
    // Filter out ignored single-entity groups
    const groupNames = Object.keys(allGroups).filter(groupName => {
        const groupData = allGroups[groupName];
        // Hide single-entity groups that are marked as ignored
        const isSingleEntity = groupData.entities && groupData.entities.length === 1;
        const isIgnored = groupData.ignored === true;
        return !(isSingleEntity && isIgnored);
    });
    
    // Update count
    if (groupsCount) {
        groupsCount.textContent = groupNames.length;
    }
    
    if (groupNames.length === 0) {
        groupsList.innerHTML = '<p style="color: var(--secondary-text-color); padding: 16px; text-align: center;">No groups created yet</p>';
        return;
    }
    
    // Create container for each group
    groupNames.forEach(groupName => {
        const groupContainer = createGroupContainer(groupName, allGroups[groupName]);
        
        // Restore previous state if it existed
        const savedState = expandedStates[groupName];
        if (savedState) {
            if (savedState.collapsed) {
                groupContainer.classList.add('collapsed');
                const toggleIcon = groupContainer.querySelector('.group-toggle-icon');
                if (toggleIcon) {
                    toggleIcon.style.transform = 'rotate(-90deg)';
                }
            }
            if (savedState.editing) {
                // Re-expand the editor for this group
                setTimeout(() => editGroupSchedule(groupName), 0);
            }
        }
        
        groupsList.appendChild(groupContainer);
    });
}

// Render unmonitored entities in the unmonitored section
function renderIgnoredEntities() {
    const ignoredContainer = getDocumentRoot().querySelector('#ignored-entities-container');
    const ignoredCount = getDocumentRoot().querySelector('#ignored-count');
    if (!ignoredContainer) return;
    
    // Find all climate entities that are NOT in a monitored group
    // This includes: 1) entities not in any group, 2) entities in single-entity groups with ignored=true
    const unmonitoredEntities = climateEntities.filter(entity => {
        const entityId = entity.entity_id;
        
        // Check if entity is in any group
        let isInMonitoredGroup = false;
        for (const [groupName, groupData] of Object.entries(allGroups)) {
            if (groupData.entities && groupData.entities.includes(entityId)) {
                // Found the entity in a group
                const isSingleEntity = groupData.entities.length === 1;
                const isIgnored = groupData.ignored === true;
                
                // If it's in a single-entity group that's ignored, it's unmonitored
                // If it's in any other group (multi-entity or monitored single-entity), it's monitored
                if (!isSingleEntity || !isIgnored) {
                    isInMonitoredGroup = true;
                }
                break;
            }
        }
        
        // Include if NOT in a monitored group
        return !isInMonitoredGroup;
    });
    
    // Sort alphabetically by friendly name
    unmonitoredEntities.sort((a, b) => {
        const nameA = (a.attributes?.friendly_name || a.entity_id).toLowerCase();
        const nameB = (b.attributes?.friendly_name || b.entity_id).toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    // Update count
    if (ignoredCount) {
        ignoredCount.textContent = unmonitoredEntities.length;
    }
    
    // Clear existing content
    ignoredContainer.innerHTML = '';
    
    if (unmonitoredEntities.length === 0) {
        ignoredContainer.innerHTML = '<p style="color: var(--secondary-text-color); padding: 16px; text-align: center;">No unmonitored entities</p>';
        return;
    }
    
    // Render each unmonitored entity
    unmonitoredEntities.forEach(entity => {
        const entityId = entity.entity_id;
        const friendlyName = entity.attributes?.friendly_name || entityId;
        
        const item = document.createElement('div');
        item.className = 'ignored-entity-item';
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer;';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = friendlyName;
        nameSpan.style.flex = '1';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 8px;';
        
        const unignoreBtn = document.createElement('button');
        unignoreBtn.textContent = 'Monitor';
        unignoreBtn.className = 'btn-secondary-outline';
        unignoreBtn.style.cssText = 'padding: 4px 12px; font-size: 0.85rem;';
        unignoreBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Start monitoring ${friendlyName}?\n\nThis entity will be managed by the scheduler again.`)) {
                try {
                    await haAPI.setIgnored(entityId, false);
                    
                    // Verify the entity was created successfully
                    const schedule = await haAPI.getSchedule(entityId);
                    if (schedule && schedule.ignored === false) {
                        showToast(`${friendlyName} is now monitored. Refresh the page to edit its schedule.`, 'success');
                    } else {
                        showToast(`${friendlyName} status updated, but verification failed. Try refreshing the page.`, 'warning');
                    }
                    
                    // Reload groups to update the display
                    await loadGroups();
                } catch (error) {
                    console.error('Failed to monitor entity:', error);
                    showToast('Failed to monitor entity: ' + error.message, 'error');
                }
            }
        };
        
        const addToGroupBtn = document.createElement('button');
        addToGroupBtn.textContent = 'Add to Group';
        addToGroupBtn.className = 'btn-primary-outline';
        addToGroupBtn.style.cssText = 'padding: 4px 12px; font-size: 0.85rem;';
        addToGroupBtn.onclick = async (e) => {
            e.stopPropagation();
            
            // Show the add to group modal without monitoring yet
            const modal = getDocumentRoot().querySelector('#add-to-group-modal');
            const entityNameEl = getDocumentRoot().querySelector('#add-entity-name');
            
            if (modal && entityNameEl) {
                // Store entity info on modal
                modal.dataset.entityId = entityId;
                modal.dataset.isUnmonitoredAdd = 'true';
                entityNameEl.textContent = friendlyName;
                
                // Show the modal (will populate groups in existing handler)
                showAddToGroupModal(entityId);
            } else {
                showToast(`Failed to show group selection modal`, 'error');
            }
        };
        
        buttonContainer.appendChild(unignoreBtn);
        buttonContainer.appendChild(addToGroupBtn);
        
        item.appendChild(nameSpan);
        item.appendChild(buttonContainer);
        ignoredContainer.appendChild(item);
    });
}

// Track last click time per group to prevent duplicate clicks
const lastClickTime = {};
const CLICK_DEBOUNCE_MS = 500;
let isProcessingGroupClick = false;

// Create a group container element
function createGroupContainer(groupName, groupData) {
    const container = document.createElement('div');
    container.className = 'group-container collapsed';
    container.dataset.groupName = groupName;
    
    // Create header
    const header = document.createElement('div');
    header.className = 'group-header';
    
    const leftSide = document.createElement('div');
    leftSide.style.display = 'flex';
    leftSide.style.alignItems = 'center';
    leftSide.style.gap = '8px';
    
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'group-toggle-icon';
    toggleIcon.textContent = '▼';
    toggleIcon.style.transform = 'rotate(-90deg)';
    
    const title = document.createElement('span');
    title.className = 'group-title';
    
    // Always display the actual group name for consistency with service calls/actions
    title.textContent = groupName;
    
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `${groupData.entities?.length || 0} entities`;
    
    leftSide.appendChild(toggleIcon);
    leftSide.appendChild(title);
    leftSide.appendChild(count);
    
    header.appendChild(leftSide);
    
    // Add rename button for all groups
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    actions.style.cssText = 'display: flex; gap: 4px; align-items: center;';
    
    // Enable/disable toggle - reuse the styled toggle switch from settings
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle-switch';
    toggleLabel.title = 'Enable schedule';

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = groupData.enabled !== false;

    const sliderSpan = document.createElement('span');
    sliderSpan.className = 'slider';

    // Handle toggle changes
    toggleInput.addEventListener('click', async (e) => {
        e.stopPropagation();
    });
    toggleInput.addEventListener('change', async (e) => {
        e.stopPropagation();
        const newState = toggleInput.checked;
        toggleInput.disabled = true;
        try {
            if (newState) {
                await haAPI.enableGroup(groupName);
                showToast(`Enabled scheduling for ${groupName}`, 'success');
            } else {
                await haAPI.disableGroup(groupName);
                showToast(`Disabled scheduling for ${groupName}`, 'info');
            }
            await loadGroups();
        } catch (error) {
            console.error('Failed to toggle group enabled state:', error);
            showToast('Failed to update enabled state: ' + (error.message || error), 'error');
            // Revert
            toggleInput.checked = !newState;
        } finally {
            toggleInput.disabled = false;
        }
    });

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(sliderSpan);
    actions.appendChild(toggleLabel);
    
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎';
    renameBtn.className = 'btn-icon';
    renameBtn.title = 'Rename group';
    renameBtn.style.cssText = 'padding: 4px 8px; font-size: 1rem; background: none; border: none; cursor: pointer; color: var(--text-secondary);';
    renameBtn.onclick = async (e) => {
        e.stopPropagation();
        const newName = prompt(`Rename group "${groupName}" to:`, groupName);
        if (newName && newName.trim() !== '' && newName !== groupName) {
            try {
                await haAPI.renameGroup(groupName, newName.trim());
                showToast(`Renamed group to: ${newName}`, 'success');
                await loadGroups();
            } catch (error) {
                console.error('Failed to rename group:', error);
                showToast('Failed to rename group: ' + error.message, 'error');
            }
        }
    };
    
    actions.appendChild(renameBtn);
    header.appendChild(actions);
    
    // Toggle collapse/expand and edit schedule on header click
    header.onclick = async (e) => {
        // Don't trigger if clicking on action buttons
        if (e.target.closest('.group-actions')) return;
        
        // Prevent event bubbling
        e.stopPropagation();
        e.preventDefault();
        
        // Block if there's a save in progress
        if (isSaveInProgress) {
            console.log(`[Schedule] Ignoring click on group: ${groupName} (save in progress)`);
            return;
        }
        
        // Global lock: only process one group click at a time
        if (isProcessingGroupClick) {
            console.log(`[Schedule] Ignoring click on group: ${groupName} (already processing another group)`);
            return;
        }
        
        // Debounce: prevent multiple rapid clicks on the same group
        const now = Date.now();
        const lastClick = lastClickTime[groupName] || 0;
        if (now - lastClick < CLICK_DEBOUNCE_MS) {
            console.log(`[Schedule] Ignoring duplicate click on group: ${groupName} (debounced)`);
            return;
        }
        lastClickTime[groupName] = now;
        
        // Set processing flag
        isProcessingGroupClick = true;
        
        try {
            // Check if we're currently editing this group
            const isCurrentlyExpanded = currentGroup === groupName && container.classList.contains('expanded');
            
            if (isCurrentlyExpanded) {
                // Collapse the editor
                collapseAllEditors();
                currentGroup = null;
            } else {
                // Expand the editor
                await editGroupSchedule(groupName);
            }
            
            // Also toggle the entities list visibility
            container.classList.toggle('collapsed');
            toggleIcon.style.transform = container.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
        } finally {
            // Release the lock
            isProcessingGroupClick = false;
        }
    };
    
    container.appendChild(header);
    
    return container;
}// Edit group schedule - load group schedule into editor
async function editGroupSchedule(groupName, day = null) {
    // Fetch fresh group data from server before editing
    try {
        const groupsData = await haAPI.getGroups();
        if (groupsData && groupsData[groupName]) {
            allGroups[groupName] = groupsData[groupName];
        }
    } catch (error) {
        console.error('Failed to fetch fresh group data:', error);
    }
    
    const groupData = allGroups[groupName];
    if (!groupData) return;
    
    // Set loading flag to prevent auto-saves during editor setup
    isLoadingSchedule = true;
        //
    
    // Collapse all other editors first
    collapseAllEditors();
    
    // Set current group
    currentGroup = groupName;
    
    // Load schedule mode and day
    currentScheduleMode = groupData.schedule_mode || 'all_days';
    
    if (!day) {
        // Determine which day to load based on mode
        const now = new Date();
        const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
        
        if (currentScheduleMode === 'all_days') {
            currentDay = 'all_days';
        } else if (currentScheduleMode === '5/2') {
            currentDay = (weekday === 'sat' || weekday === 'sun') ? 'weekend' : 'weekday';
        } else {
            currentDay = weekday;
        }
    } else {
        currentDay = day;
    }
    
    // Find the group container
    const groupContainer = getDocumentRoot().querySelector(`.group-container[data-group-name="${groupName}"]`);
    if (!groupContainer) return;
    
    // Mark as expanded
    groupContainer.classList.add('expanded');
    
    // Create and insert editor inside the group container (append to the end)
    const editor = createScheduleEditor();
    groupContainer.appendChild(editor);
    
    // Hide entity status section (replaced by group table)
    const entityStatus = editor.querySelector('.entity-status');
    if (entityStatus) {
        entityStatus.style.display = 'none';
    }
    
    // Recreate graph with the new SVG element
    const svgElement = editor.querySelector('#temperature-graph');
    if (svgElement) {
        graph = new TemperatureGraph(svgElement, temperatureUnit, graphSnapStep, serverTimeZone);
        graph.setTooltipMode(tooltipMode);
        // Apply configured min/max if available
        if (minTempSetting !== null && maxTempSetting !== null && typeof graph.setMinMax === 'function') {
            graph.setMinMax(minTempSetting, maxTempSetting);
        }
        
        // Attach graph event listeners (permanent listeners)
        svgElement.addEventListener('nodeSettings', handleNodeSettings);
        
        // Handle node updates during dragging
        svgElement.addEventListener('nodeSettingsUpdate', (event) => {
            const { nodeIndex, node } = event.detail;
            const panel = editor.querySelector('#node-settings-panel');
            
            // Only update if this node's panel is currently showing
            if (panel && panel.style.display !== 'none' && parseInt(panel.dataset.nodeIndex) === nodeIndex) {
                const tempInput = panel.querySelector('#node-temp-input');
                const tempNoChange = panel.querySelector('#temp-no-change');
                const tempUpBtn = panel.querySelector('#temp-up');
                const tempDownBtn = panel.querySelector('#temp-down');
                const timeInput = panel.querySelector('#node-time-input');
                
                // Update time
                if (timeInput) timeInput.value = node.time;
                
                // Update temperature and checkbox state
                const isNoChange = node.noChange === true;
                if (tempNoChange) tempNoChange.checked = isNoChange;
                if (tempInput) {
                    tempInput.value = (node.temp !== null && node.temp !== undefined) ? node.temp : '';
                    tempInput.disabled = isNoChange;
                }
                if (tempUpBtn) tempUpBtn.disabled = isNoChange;
                if (tempDownBtn) tempDownBtn.disabled = isNoChange;
            }
        });
        
        // Create and insert settings panel after the graph container but before instructions
        const graphContainer = svgElement.closest('.graph-container') || svgElement.parentElement;
        const instructionsContainer = editor.querySelector('.instructions-container');
        
        if (graphContainer && instructionsContainer) {
            const settingsPanel = createSettingsPanel(groupData, editor);
            if (settingsPanel) {
                instructionsContainer.before(settingsPanel);
            }
            
            // Check if any entities in the group are preset-only and show notice if needed
            const presetOnlyNotice = createPresetOnlyNotice(groupData.entities, groupName);
            if (presetOnlyNotice) {
                instructionsContainer.before(presetOnlyNotice);
            }
            
            // Insert group members table after instructions
            const groupTable = createGroupMembersTable(groupData.entities);
            if (groupTable) {
                instructionsContainer.after(groupTable);
            }
        }
    }
    
    // Load nodes for the selected day
    let nodes = [];
    if (groupData.schedules && groupData.schedules[currentDay]) {
        nodes = groupData.schedules[currentDay];
        //
    } else if (currentDay === "weekday" && groupData.schedules && groupData.schedules["mon"]) {
        // If weekday key doesn't exist, try loading from Monday
        nodes = groupData.schedules["mon"];
        //
    } else if (currentDay === "weekend" && groupData.schedules && groupData.schedules["sat"]) {
        // If weekend key doesn't exist, try loading from Saturday
        nodes = groupData.schedules["sat"];
        //
    } else if (groupData.nodes) {
        // Backward compatibility
        nodes = groupData.nodes;
        //
    } else {
        //
    }
    
    // Migrate old nodes that have temp=null to use noChange property
    nodes = nodes.map(node => {
        if ((node.temp === null || node.temp === undefined) && !node.hasOwnProperty('noChange')) {
            return { ...node, noChange: true, temp: 20 }; // Default position at 20°C
        }
        return node;
    });
    
    currentSchedule = nodes.length > 0 ? nodes.map(n => ({...n})) : [];
    
    // Find the SVG element
    const svg = editor.querySelector('#temperature-graph');
    
    // Set initial nodes
    graph.setNodes(currentSchedule);
    
    // Set previous day's last temperature for graph rendering
    setPreviousDayLastTempForGraph(groupData, currentDay);
    
    // Always attach the permanent nodesChanged listener for auto-save
    if (svg) {
        svg.removeEventListener('nodesChanged', handleGraphChange); // Remove any previous
        svg.addEventListener('nodesChanged', handleGraphChange);
    }
    
    // Update schedule mode UI
    updateScheduleModeUI();
    
    // Load history data for all entities in the group
    await loadGroupHistoryData(groupData.entities);
    
    // Load advance history for the first entity in the group
    if (groupData.entities && groupData.entities.length > 0) {
        await loadAdvanceHistory(groupData.entities[0]);
    }
    
    // Set enabled state from saved group data
    const scheduleEnabled = editor.querySelector('#schedule-enabled');
    if (scheduleEnabled) {
        scheduleEnabled.checked = groupData.enabled !== false;
    }
    
    updateScheduledTemp();
    
    // Reattach event listeners
    attachEditorEventListeners(editor);
    
    // Update paste button state
    updatePasteButtonState();
    
    // Clear loading flag now that setup is complete
        //
    isLoadingSchedule = false;
}

// Create settings panel with controls and mode selector
function createSettingsPanel(groupData, editor) {
    const container = document.createElement('div');
    container.className = 'schedule-settings-container';
    
    // Create toggle header
    const toggleHeader = document.createElement('div');
    toggleHeader.className = 'schedule-settings-toggle';
    toggleHeader.innerHTML = `
        <span class="toggle-icon" style="transform: rotate(-90deg);">▼</span>
        <span class="toggle-text">Schedule Settings</span>
    `;
    toggleHeader.style.cursor = 'pointer';
    toggleHeader.style.userSelect = 'none';
    
    // Create settings panel content
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'schedule-settings-panel collapsed';
    settingsPanel.style.display = 'none';
    
    // Check if this is a single-entity group (for ignore button visibility)
    const isSingleEntityGroup = groupData && groupData.entities && groupData.entities.length === 1;
    
    // Add editor controls (buttons)
    let controlsHTML = `
        <div class="editor-controls">
            <button id="undo-btn" class="btn-secondary-outline schedule-btn" title="Undo last change (Ctrl+Z)" disabled>Undo</button>
            <button id="copy-schedule-btn" class="btn-secondary-outline schedule-btn" title="Copy current schedule">Copy Schedule</button>
            <button id="paste-schedule-btn" class="btn-secondary-outline schedule-btn" title="Paste copied schedule" disabled>Paste Schedule</button>
            <button id="test-fire-event-btn" class="btn-secondary-outline schedule-btn" title="Test fire event with current active node">🧪 Test Event</button>
            <button id="clear-advance-history-btn" class="btn-secondary-outline schedule-btn" title="Clear advance history markers">Clear Advance History</button>`;
    
    // Only show unmonitor button for single-entity groups
    if (isSingleEntityGroup) {
        controlsHTML += `<button id="ignore-entity-btn" class="btn-secondary-outline schedule-btn" title="Stop monitoring this thermostat">Unmonitor</button>`;
    }
    
    controlsHTML += `
            <button id="clear-schedule-btn" class="btn-danger-outline schedule-btn" title="Clear entire schedule">Clear Schedule</button>`;
    
    // Add delete group button if this is a group
    if (groupData) {
        controlsHTML += `<button id="delete-group-btn" class="btn-danger schedule-btn" title="Delete this group">Delete Group</button>`;
    }
    
    controlsHTML += `
            <label class="toggle-switch">
                <input type="checkbox" id="schedule-enabled">
                <span class="slider"></span>
                <span class="toggle-label">Enabled</span>
            </label>
        </div>
    `;
    
    // Add profile selector
    const profileSelectorHTML = `
        <div class="profile-selector">
            <h3>Schedule Profile</h3>
            <div class="profile-controls">
                <select id="profile-dropdown" class="profile-dropdown">
                    <option value="Default">Default</option>
                </select>
                <button id="edit-profile-btn" class="btn-profile btn-edit-profile" title="Edit selected profile">Edit</button>
                <button id="new-profile-btn" class="btn-profile" title="Create new profile">＋</button>
                <button id="rename-profile-btn" class="btn-profile" title="Rename profile">✎</button>
                <button id="delete-profile-btn" class="btn-profile" title="Delete profile">✕</button>
            </div>
        </div>
    `;
    
    // Add schedule mode selector
    const modeSelectorHTML = `
        <div class="schedule-mode-selector">
            <h3>Schedule Mode</h3>
            <div class="mode-options">
                <div class="mode-option">
                    <input type="radio" name="schedule-mode" value="all_days" id="mode-all-days" checked>
                    <label for="mode-all-days">All Days</label>
                </div>
                <div class="mode-option">
                    <input type="radio" name="schedule-mode" value="5/2" id="mode-5-2">
                    <label for="mode-5-2">5/2 (Weekday/Weekend)</label>
                </div>
                <div class="mode-option">
                    <input type="radio" name="schedule-mode" value="individual" id="mode-individual">
                    <label for="mode-individual">Individual Days</label>
                </div>
            </div>
            <div class="day-selector" id="day-selector">
                <div class="day-buttons">
                    <button class="day-btn" data-day="mon">Mon</button>
                    <button class="day-btn" data-day="tue">Tue</button>
                    <button class="day-btn" data-day="wed">Wed</button>
                    <button class="day-btn" data-day="thu">Thu</button>
                    <button class="day-btn" data-day="fri">Fri</button>
                    <button class="day-btn" data-day="sat">Sat</button>
                    <button class="day-btn" data-day="sun">Sun</button>
                </div>
            </div>
            <div class="weekday-selector" id="weekday-selector">
                <div class="day-buttons">
                    <button class="day-btn weekday-btn" data-day="weekday">Weekday</button>
                    <button class="day-btn weekday-btn" data-day="weekend">Weekend</button>
                </div>
            </div>
        </div>
    `;
    
    settingsPanel.innerHTML = controlsHTML + profileSelectorHTML + modeSelectorHTML;
    
    // Toggle functionality
    toggleHeader.onclick = () => {
        const isCollapsed = settingsPanel.classList.contains('collapsed');
        if (isCollapsed) {
            settingsPanel.classList.remove('collapsed');
            settingsPanel.style.display = 'block';
            toggleHeader.querySelector('.toggle-icon').style.transform = 'rotate(0deg)';
        } else {
            settingsPanel.classList.add('collapsed');
            settingsPanel.style.display = 'none';
            toggleHeader.querySelector('.toggle-icon').style.transform = 'rotate(-90deg)';
        }
    };
    
    container.appendChild(toggleHeader);
    container.appendChild(settingsPanel);
    
    // Connect undo button to graph and add delete group handler
    setTimeout(() => {
        const undoBtn = container.querySelector('#undo-btn');
        if (undoBtn && graph) {
            graph.setUndoButton(undoBtn);
        }
        
        // Add delete group button handler if this is a group
        if (groupData) {
            const deleteGroupBtn = container.querySelector('#delete-group-btn');
            if (deleteGroupBtn) {
                deleteGroupBtn.onclick = () => {
                    // Get group name from currentGroup or from groupData
                    const groupName = currentGroup;
                    if (groupName) {
                        confirmDeleteGroup(groupName);
                    }
                };
            }
        }
        
        // Add profile management handlers
        setupProfileHandlers(container, groupData);
    }, 0);
    
    return container;
}

// Show/hide editing profile indicator
function showEditingProfileIndicator(editingProfile, activeProfile) {
    let indicator = getDocumentRoot().querySelector('#editing-profile-indicator');
    
    if (editingProfile && editingProfile !== activeProfile) {
        if (!indicator) {
            // Create indicator if it doesn't exist
            const graphContainer = getDocumentRoot().querySelector('.graph-container');
            if (graphContainer) {
                indicator = document.createElement('div');
                indicator.id = 'editing-profile-indicator';
                indicator.style.cssText = 'font-weight: bold; padding: 8px; margin-bottom: 8px; text-align: center; color: var(--accent-color); border: 1px solid var(--divider-color); border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 12px;';
                graphContainer.insertBefore(indicator, graphContainer.firstChild);
            }
        }
        if (indicator) {
            indicator.innerHTML = `
                <span>Editing Profile: ${editingProfile}</span>
                <button id="close-editing-profile" style="padding: 4px 12px; cursor: pointer; background: var(--primary-color); color: var(--text-primary-color); border: none; border-radius: 4px; font-weight: normal;">Done</button>
            `;
            indicator.style.display = 'flex';
            
            // Add click handler to Close button
            const closeBtn = indicator.querySelector('#close-editing-profile');
            if (closeBtn) {
                closeBtn.onclick = async () => {
                    // Clear editing state
                    editingProfile = null;
                    
                    // Load the active profile back into the graph
                    if (currentGroup && allGroups[currentGroup]) {
                        const groupData = allGroups[currentGroup];
                        const activeProfile = groupData.active_profile || 'Default';
                        const profileData = groupData.profiles && groupData.profiles[activeProfile];
                        
                        if (profileData) {
                            currentScheduleMode = profileData.schedule_mode || 'all_days';
                            const schedules = profileData.schedules || {};
                            const day = currentDay || 'all_days';
                            const nodes = schedules[day] || schedules['all_days'] || [];
                            
                            if (graph) {
                                graph.setNodes(nodes);
                            }
                            
                            // Update UI
                            updateScheduleModeUI();
                        }
                    }
                    
                    // Hide the indicator
                    showEditingProfileIndicator(null, activeProfile);
                    showToast('Returned to active profile', 'info');
                };
            }
        }
    } else {
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
}

// Setup profile management event handlers
async function setupProfileHandlers(container, groupData) {
    if (!groupData || !currentGroup) {
        console.warn('setupProfileHandlers - no group data, aborting');
        return;
    }
    
    // Load and populate profiles
    await loadProfiles(container, currentGroup);
    
    // Profile dropdown change handler (no automatic loading)
    const profileDropdown = container.querySelector('#profile-dropdown');
    
    // Edit profile button handler
    const editProfileBtn = container.querySelector('#edit-profile-btn');
    if (editProfileBtn && profileDropdown) {
        editProfileBtn.onclick = async () => {
            const selectedProfile = profileDropdown.value;
            const activeProfile = groupData.active_profile;
            
            try {
                // Load group data to get the latest profile schedules
                const groupsResult = await haAPI.getGroups();
                allGroups = groupsResult.groups || {};
                
                // Load the selected profile's schedule data into the graph
                const updatedGroupData = allGroups[currentGroup];
                if (updatedGroupData && updatedGroupData.profiles && updatedGroupData.profiles[selectedProfile]) {
                    const profileData = updatedGroupData.profiles[selectedProfile];
                    
                    // Track which profile we're editing
                    editingProfile = selectedProfile;
                    
                    // Update the schedules to show the selected profile
                    currentScheduleMode = profileData.schedule_mode || 'all_days';
                    const schedules = profileData.schedules || {};
                    const day = currentDay || 'all_days';
                    const nodes = schedules[day] || schedules['all_days'] || [];
                    
                    if (graph) {
                        graph.setNodes(nodes);
                    }
                    
                    // Show editing indicator if editing a different profile than active
                    if (selectedProfile !== activeProfile) {
                        showEditingProfileIndicator(selectedProfile, activeProfile);
                    } else {
                        showEditingProfileIndicator(null, activeProfile);
                    }
                }
                
                showToast(`Now editing profile: ${selectedProfile}`, 'info');
            } catch (error) {
                console.error('Failed to load profile:', error);
                showToast('Failed to load profile: ' + error.message, 'error');
            }
        };
    }
    
    // New profile button
    const newProfileBtn = container.querySelector('#new-profile-btn');
    if (newProfileBtn) {
        newProfileBtn.onclick = async () => {
            const profileName = prompt('Enter name for new profile:');
            if (!profileName || profileName.trim() === '') return;
            
            try {
                await haAPI.createProfile(currentGroup, profileName.trim());
                showToast(`Created profile: ${profileName}`, 'success');
                await loadProfiles(container, currentGroup);
                updateGraphProfileDropdown();
            } catch (error) {
                console.error('Failed to create profile:', error);
                showToast('Failed to create profile: ' + error.message, 'error');
            }
        };
    }
    
    // Rename profile button
    const renameProfileBtn = container.querySelector('#rename-profile-btn');
    if (renameProfileBtn) {
        renameProfileBtn.onclick = async () => {
            const dropdown = container.querySelector('#profile-dropdown');
            const currentProfile = dropdown?.value;
            if (!currentProfile) return;
            
            const newName = prompt(`Rename profile "${currentProfile}" to:`, currentProfile);
            if (!newName || newName.trim() === '' || newName === currentProfile) return;
            
            try {
                await haAPI.renameProfile(currentGroup, currentProfile, newName.trim());
                showToast(`Renamed profile to: ${newName}`, 'success');
                await loadProfiles(container, currentGroup);
                updateGraphProfileDropdown();
            } catch (error) {
                console.error('Failed to rename profile:', error);
                showToast('Failed to rename profile: ' + error.message, 'error');
            }
        };
    }
    
    // Delete profile button
    const deleteProfileBtn = container.querySelector('#delete-profile-btn');
    if (deleteProfileBtn) {
        deleteProfileBtn.onclick = async () => {
            const dropdown = container.querySelector('#profile-dropdown');
            const currentProfile = dropdown?.value;
            if (!currentProfile) return;
            
            if (!confirm(`Delete profile "${currentProfile}"?`)) return;
            
            try {
                await haAPI.deleteProfile(currentGroup, currentProfile);
                showToast(`Deleted profile: ${currentProfile}`, 'success');
                await loadProfiles(container, currentGroup);
                updateGraphProfileDropdown();
            } catch (error) {
                console.error('Failed to delete profile:', error);
                showToast('Failed to delete profile: ' + error.message, 'error');
            }
        };
    }
}

// Load and populate profiles dropdown
async function loadProfiles(container, targetId) {
    try {
        const result = await haAPI.getProfiles(targetId);
        const profiles = result.profiles || {};
        const activeProfile = result.active_profile || 'Default';
        
        const dropdown = container.querySelector('#profile-dropdown');
        if (!dropdown) {
            console.warn('loadProfiles - dropdown not found');
            return;
        }
        
        // Clear and repopulate dropdown
        dropdown.innerHTML = '';
        Object.keys(profiles).forEach(profileName => {
            const option = document.createElement('option');
            option.value = profileName;
            option.textContent = profileName;
            if (profileName === activeProfile) {
                option.selected = true;
            }
            dropdown.appendChild(option);
        });
        
        // Update button states
        const renameBtn = container.querySelector('#rename-profile-btn');
        const deleteBtn = container.querySelector('#delete-profile-btn');
        const profileCount = Object.keys(profiles).length;
        
        if (renameBtn) renameBtn.disabled = profileCount === 0;
        if (deleteBtn) deleteBtn.disabled = profileCount <= 1;
        
    } catch (error) {
        console.error('Failed to load profiles:', error);
    }
}

// Create preset-only notice for groups with entities that don't support temperature
function createPresetOnlyNotice(entityIds, groupName) {
    if (!entityIds || entityIds.length === 0) {
        return null; // Virtual groups don't need this notice
    }
    
    // Check if any entities are preset-only (null current_temperature)
    const presetOnlyEntities = entityIds.filter(entityId => {
        const entity = climateEntities.find(e => e.entity_id === entityId);
        return entity && entity.attributes && entity.attributes.current_temperature === null;
    });
    
    if (presetOnlyEntities.length === 0) {
        return null; // No preset-only entities
    }
    
    // Check if this notice has been dismissed for this group (session storage)
    const dismissKey = `preset-notice-dismissed-${groupName}`;
    if (sessionStorage.getItem(dismissKey) === 'true') {
        return null;
    }
    
    // Create notice banner
    const notice = document.createElement('div');
    notice.className = 'preset-only-notice';
    notice.style.cssText = `
        background: var(--warning-color, #ff9800);
        color: white;
        padding: 12px 16px;
        margin: 8px 0;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 14px;
        line-height: 1.4;
    `;
    
    const message = document.createElement('div');
    message.style.flex = '1';
    
    const count = presetOnlyEntities.length;
    const entityWord = count === 1 ? 'entity' : 'entities';
    const hasWord = count === 1 ? 'has' : 'have';
    
    message.innerHTML = `
        <strong>⚠️ Preset-Only ${count === 1 ? 'Entity' : 'Entities'} Detected</strong><br>
        ${count} ${entityWord} in this group ${hasWord} no temperature sensor and will only receive mode changes (HVAC, fan, swing, preset).
    `;
    
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '✕';
    dismissBtn.style.cssText = `
        background: transparent;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0 8px;
        margin-left: 16px;
        opacity: 0.8;
        transition: opacity 0.2s;
    `;
    dismissBtn.title = 'Dismiss this notice';
    
    dismissBtn.addEventListener('mouseenter', () => {
        dismissBtn.style.opacity = '1';
    });
    dismissBtn.addEventListener('mouseleave', () => {
        dismissBtn.style.opacity = '0.8';
    });
    
    dismissBtn.addEventListener('click', () => {
        sessionStorage.setItem(dismissKey, 'true');
        notice.style.transition = 'opacity 0.3s, max-height 0.3s';
        notice.style.opacity = '0';
        notice.style.maxHeight = '0';
        notice.style.padding = '0 16px';
        notice.style.margin = '0';
        setTimeout(() => {
            notice.remove();
        }, 300);
    });
    
    notice.appendChild(message);
    notice.appendChild(dismissBtn);
    
    return notice;
}

// Create group members table element
function createGroupMembersTable(entityIds) {
    if (!entityIds || entityIds.length === 0) {
        // Return a message for virtual groups (no entities)
        const container = document.createElement('div');
        container.className = 'group-members-container';
        container.innerHTML = `
            <div style="padding: 16px; text-align: center; color: var(--secondary-text-color); font-style: italic;">
                Virtual Schedule (No Entities) - Events Only
            </div>
        `;
        return container;
    }
    
    // Create container wrapper
    const container = document.createElement('div');
    container.className = 'group-members-container';
    
    // Create toggle header
    const toggleHeader = document.createElement('div');
    toggleHeader.className = 'group-members-toggle';
    toggleHeader.innerHTML = `
        <span class="toggle-icon">▶</span>
        <span class="toggle-text">Member Entities (${entityIds.length})</span>
    `;
    
    // Create table
    const table = document.createElement('div');
    table.className = 'group-members-table collapsed';
    table.style.display = 'none';
    
    // Toggle functionality
    toggleHeader.onclick = async () => {
        console.log('[Group Members Toggle] Clicked!');
        const isCollapsed = table.classList.contains('collapsed');
        if (isCollapsed) {
            // Fetch fresh entity states before expanding
            await loadClimateEntities();
            
            // Refresh table data
            const now = getServerNow(serverTimeZone);
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            const groupSchedule = graph ? graph.getNodes() : [];
            
            // Update each row with fresh data
            entityIds.forEach(entityId => {
                const row = table.querySelector(`.group-members-row[data-entity-id="${entityId}"]`);
                if (!row) return;
                
                const entity = climateEntities.find(e => e.entity_id === entityId);
                if (!entity) return;
                
                // Update current temp
                const currentCell = row.children[1];
                const currentTemp = entity.attributes?.current_temperature;
                currentCell.textContent = (Number.isFinite(currentTemp)) ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';

                // Update target temp
                const targetCell = row.children[2];
                const targetTemp = entity.attributes?.temperature;
                targetCell.textContent = (Number.isFinite(targetTemp)) ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';

                // Update scheduled temp
                const scheduledCell = row.children[3];
                if (groupSchedule.length > 0) {
                    const scheduledTemp = interpolateTemperature(groupSchedule, currentTime);
                    scheduledCell.textContent = (Number.isFinite(scheduledTemp)) ? `${scheduledTemp.toFixed(1)}${temperatureUnit}` : 'No Change';
                } else {
                    scheduledCell.textContent = '--';
                }
            });
            
            table.classList.remove('collapsed');
            table.style.display = 'block';
            toggleHeader.querySelector('.toggle-icon').style.transform = 'rotate(90deg)';
        } else {
            table.classList.add('collapsed');
            table.style.display = 'none';
            toggleHeader.querySelector('.toggle-icon').style.transform = 'rotate(0deg)';
        }
    };
    
    // Create header
    const header = document.createElement('div');
    header.className = 'group-members-header';
    header.innerHTML = '<span>Name</span><span>Current</span><span>Target</span><span>Scheduled</span><span style="text-align: center;">Actions</span>';
    table.appendChild(header);
    
    // Get current time for scheduled temp calculation
    const now = getServerNow(serverTimeZone);
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    // Get the group's schedule if it exists
    const groupSchedule = graph ? graph.getNodes() : [];
    
    // Create rows for each entity
    entityIds.forEach(entityId => {
        const entity = climateEntities.find(e => e.entity_id === entityId);
        if (!entity) return;
        
        const row = document.createElement('div');
        row.className = 'group-members-row';
        row.dataset.entityId = entityId;
        
        const nameCell = document.createElement('span');
        nameCell.textContent = entity.attributes?.friendly_name || entityId;
        
        const currentCell = document.createElement('span');
        const currentTemp = entity.attributes?.current_temperature;
        currentCell.textContent = (Number.isFinite(currentTemp)) ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';

        const targetCell = document.createElement('span');
        const targetTemp = entity.attributes?.temperature;
        targetCell.textContent = (Number.isFinite(targetTemp)) ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';

        const scheduledCell = document.createElement('span');
        if (groupSchedule.length > 0) {
            const scheduledTemp = interpolateTemperature(groupSchedule, currentTime);
            scheduledCell.textContent = (Number.isFinite(scheduledTemp)) ? `${scheduledTemp.toFixed(1)}${temperatureUnit}` : 'No Change';
        } else {
            scheduledCell.textContent = '--';
        }
        
        // Add action buttons cell
        const actionCell = document.createElement('span');
        actionCell.style.textAlign = 'center';
        actionCell.style.display = 'flex';
        actionCell.style.gap = '4px';
        actionCell.style.justifyContent = 'center';
        
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-icon-small move-entity-btn';
        moveBtn.innerHTML = 'M';
        moveBtn.title = 'Move to another group';
        moveBtn.onclick = (e) => {
            e.stopPropagation();
            const groupName = currentGroup;
            if (groupName) {
                showMoveToGroupModal(groupName, entityId);
            }
        };
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-icon-small remove-entity-btn';
        removeBtn.innerHTML = '✕';
        removeBtn.title = 'Remove from group';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            // Get the group name from the current context
            const groupName = currentGroup;
            if (groupName) {
                removeEntityFromGroup(groupName, entityId);
            }
        };
        
        actionCell.appendChild(moveBtn);
        actionCell.appendChild(removeBtn);
        
        row.appendChild(nameCell);
        row.appendChild(currentCell);
        row.appendChild(targetCell);
        row.appendChild(scheduledCell);
        row.appendChild(actionCell);
        table.appendChild(row);
    });
    
    container.appendChild(toggleHeader);
    container.appendChild(table);
    
    return container;
}

// Display group members table above graph (deprecated - use createGroupMembersTable instead)
function displayGroupMembersTable(entityIds) {
    // Remove existing table if present
    const existingTable = getDocumentRoot().querySelector('.group-members-table');
    if (existingTable) {
        existingTable.remove();
    }
    
    const table = createGroupMembersTable(entityIds);
    if (!table) return;
    
    // Insert table before graph container
    const graphContainer = getDocumentRoot().querySelector('.graph-container');
    if (graphContainer) {
        graphContainer.parentNode.insertBefore(table, graphContainer);
    }
}

// Toggle entity inclusion (enable/disable entity)
async function toggleEntityInclusion(entityId, enable = true) {
    try {
        if (enable) {
            // Check if entity already has a schedule
            const existingSchedule = await haAPI.getSchedule(entityId);
            const schedule = existingSchedule?.response || existingSchedule;
            
            if (!schedule || !schedule.nodes || schedule.nodes.length === 0) {
                // Entity has no schedule, initialize with default
                const defaultSchedule = defaultScheduleSettings.map(node => ({...node}));
                
                await haAPI.setSchedule(entityId, defaultSchedule, 'all_days', 'all_days');
                
                // Add to local Map
                entitySchedules.set(entityId, defaultSchedule);
            } else {
                // Entity has a schedule, un-ignore it and enable it
                await haAPI.setIgnored(entityId, false);
                await haAPI.enableSchedule(entityId);
                
                // Add to local Map
                entitySchedules.set(entityId, schedule.nodes);
            }
            
            showToast('Entity enabled', 'success');
        } else {
            // Disable entity - mark as ignored instead of deleting
            try {
                await haAPI.setIgnored(entityId, true);
                
                // Remove from local Map only after successfully marked as ignored
                entitySchedules.delete(entityId);
                
                showToast('Entity ignored', 'success');
            } catch (ignoreError) {
                throw ignoreError; // Re-throw to be caught by outer catch
            }
        }
        
        // Re-render entity list to update UI
        await renderEntityList();
        
        // If enabling, optionally expand the editor for this entity
        if (enable) {
            selectEntity(entityId);
        }
    } catch (error) {
        showToast(`Failed to ${enable ? 'enable' : 'disable'} entity`, 'error');
        
        // On error, reload schedules from backend to sync state
        await loadAllSchedules();
    }
}

// Remove entity from group
async function removeEntityFromGroup(groupName, entityId) {
    // Get entity name for confirmation
    const entity = climateEntities.find(e => e.entity_id === entityId);
    const entityName = entity?.attributes?.friendly_name || entityId;
    
    if (!confirm(`Remove "${entityName}" from group "${groupName}"?\n\nThe entity will return to your active entities list.`)) {
        return;
    }
    
    try {
        await haAPI.removeFromGroup(groupName, entityId);
        
        // Close any open editors to prevent stale data
        collapseAllEditors();
        
        // Reload groups
        await loadGroups();
        
        // Reload entity list (entity should reappear in active/disabled)
        await renderEntityList();
        
        showToast(`Removed ${entityName} from ${groupName}`, 'success');
    } catch (error) {
        console.error('Failed to remove entity from group:', error);
        showToast('Failed to remove entity from group: ' + error.message, 'error');
    }
}

// Show move to group modal
function showMoveToGroupModal(currentGroupName, entityId) {
    const modal = getDocumentRoot().querySelector('#add-to-group-modal');
    const select = getDocumentRoot().querySelector('#add-to-group-select');
    const newGroupInput = getDocumentRoot().querySelector('#new-group-name-inline');
    
    if (!modal || !select) return;
    
    // Store entity ID and current group on modal
    modal.dataset.entityId = entityId;
    modal.dataset.currentGroup = currentGroupName;
    modal.dataset.isMove = 'true';
    
    // Populate group select (excluding current group)
    select.innerHTML = '<option value="">Select a group...</option>';
    Object.keys(allGroups).forEach(groupName => {
        if (groupName === currentGroupName) {
            return; // Skip current group
        }
        
        const groupData = allGroups[groupName];
        
        // Skip ignored/unmonitored groups
        const isIgnored = groupData.ignored === true;
        if (isIgnored) {
            return;
        }
        
        // Skip disabled groups
        const isEnabled = groupData.enabled !== false;
        if (!isEnabled) {
            return;
        }
        
        // For single-entity groups, use the entity's friendly name only if group name matches entity ID
        const isSingleEntity = groupData.entities && groupData.entities.length === 1;
        let displayName = groupName;
        if (isSingleEntity) {
            const targetEntityId = groupData.entities[0];
            // Only show friendly name if group name matches entity ID (auto-created)
            if (groupName === targetEntityId) {
                const entity = climateEntities.find(e => e.entity_id === targetEntityId);
                if (entity && entity.attributes?.friendly_name) {
                    displayName = entity.attributes.friendly_name;
                } else {
                    // Fallback to entity_id without the domain prefix
                    displayName = targetEntityId.split('.')[1]?.replace(/_/g, ' ') || targetEntityId;
                }
            }
            // Otherwise keep displayName as groupName (user-created group)
        }
        
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = displayName;
        select.appendChild(option);
    });
    
    // Clear new group input
    if (newGroupInput) {
        newGroupInput.value = '';
    }
    
    modal.style.display = 'flex';
}

// Show add to group modal
function showAddToGroupModal(entityId) {
    const modal = getDocumentRoot().querySelector('#add-to-group-modal');
    const select = getDocumentRoot().querySelector('#add-to-group-select');
    const newGroupInput = getDocumentRoot().querySelector('#new-group-name-inline');
    
    if (!modal || !select) return;
    
    // Store entity ID on modal
    modal.dataset.entityId = entityId;
    
    // Populate group select
    select.innerHTML = '<option value="">Select a group...</option>';
    Object.keys(allGroups).forEach(groupName => {
        const groupData = allGroups[groupName];
        
        // Skip ignored/unmonitored groups
        const isIgnored = groupData.ignored === true;
        if (isIgnored) {
            return; // Skip this group
        }
        
        // Skip disabled groups
        const isEnabled = groupData.enabled !== false;
        if (!isEnabled) {
            return; // Skip this group
        }
        
        // For single-entity groups, use the entity's friendly name only if group name matches entity ID
        const isSingleEntity = groupData.entities && groupData.entities.length === 1;
        let displayName = groupName;
        if (isSingleEntity) {
            const entityId = groupData.entities[0];
            // Only show friendly name if group name matches entity ID (auto-created)
            if (groupName === entityId) {
                const entity = climateEntities.find(e => e.entity_id === entityId);
                if (entity && entity.attributes?.friendly_name) {
                    displayName = entity.attributes.friendly_name;
                } else {
                    // Fallback to entity_id without the domain prefix
                    displayName = entityId.split('.')[1]?.replace(/_/g, ' ') || entityId;
                }
            }
            // Otherwise keep displayName as groupName (user-created group)
        }
        
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = displayName;
        select.appendChild(option);
    });
    
    // Clear new group input
    if (newGroupInput) {
        newGroupInput.value = '';
    }
    
    modal.style.display = 'flex';
}

// Confirm delete group
function confirmDeleteGroup(groupName) {
    if (!confirm(`Delete group "${groupName}"? All entities will be moved back to the entity list.`)) return;
    
    deleteGroup(groupName);
}

// Delete group
async function deleteGroup(groupName) {
    try {
        await haAPI.deleteGroup(groupName);
        
        // Reload groups
        await loadGroups();
        
        // Reload entity list (entities should reappear)
        await renderEntityList();
    } catch (error) {
        console.error('Failed to delete group:', error);
        alert('Failed to delete group');
    }
}

// Toggle group enabled/disabled
async function toggleGroupEnabled(groupName, enabled) {
    try {
        if (enabled) {
            await haAPI.enableGroup(groupName);
        } else {
            await haAPI.disableGroup(groupName);
        }
        
        // Update local state
        if (allGroups[groupName]) {
            allGroups[groupName].enabled = enabled;
        }
        
        // Group toggled
    } catch (error) {
        console.error(`Failed to ${enabled ? 'enable' : 'disable'} group:`, error);
        // Reload to sync state
        await loadGroups();
    }
}

// Render entity list (deprecated - all entities are now in groups)
async function renderEntityList() {
    // All entities should be in groups now (either multi-entity or single-entity groups)
    // This function is kept for backward compatibility but does nothing
    return;
}

// Create the schedule editor element
function createScheduleEditor() {
    const editor = document.createElement('div');
    editor.className = 'schedule-editor-inline';
    editor.innerHTML = `
        <div class="editor-header-inline">
            <div class="graph-top-controls">
                <div class="day-period-selector" id="day-period-selector" style="display: none;">
                    <div class="day-period-buttons" id="day-period-buttons">
                        <!-- Buttons will be populated based on schedule mode -->
                    </div>
                </div>
                <div class="graph-quick-actions">
                    <button id="graph-copy-btn" class="btn-quick-action" title="Copy schedule">Copy</button>
                    <button id="graph-paste-btn" class="btn-quick-action" title="Paste schedule" disabled>Paste</button>
                    <button id="graph-undo-btn" class="btn-quick-action" title="Undo last change">Undo</button>
                    <button id="advance-schedule-btn" class="btn-quick-action" title="Advance to next scheduled node">Advance</button>
                    <button id="save-schedule-btn" class="btn-quick-action btn-primary" title="Save schedule">Save</button>
                </div>
                <div class="graph-profile-selector" id="graph-profile-selector">
                    <label>Active Profile:</label>
                    <select id="graph-profile-dropdown" class="graph-profile-dropdown">
                        <option value="Default">Default</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="entity-status">
            <div class="status-item">
                <span class="status-label">Current Temp:</span>
                <span id="current-temp" class="status-value">--°C</span>
            </div>
            <div class="status-item">
                <span class="status-label">Target Temp:</span>
                <span id="target-temp" class="status-value">--°C</span>
            </div>
            <div class="status-item">
                <span class="status-label">Scheduled Temp:</span>
                <span id="scheduled-temp" class="status-value">--°C</span>
            </div>
            <div class="status-item" id="current-hvac-mode-item" style="display: none;">
                <span class="status-label">HVAC Mode:</span>
                <span id="current-hvac-mode" class="status-value">--</span>
            </div>
            <div class="status-item" id="current-fan-mode-item" style="display: none;">
                <span class="status-label">Fan Mode:</span>
                <span id="current-fan-mode" class="status-value">--</span>
            </div>
            <div class="status-item" id="current-swing-mode-item" style="display: none;">
                <span class="status-label">Swing Mode:</span>
                <span id="current-swing-mode" class="status-value">--</span>
            </div>
            <div class="status-item" id="current-preset-mode-item" style="display: none;">
                <span class="status-label">Preset Mode:</span>
                <span id="current-preset-mode" class="status-value">--</span>
            </div>
        </div>

        <div class="graph-container">
            <div class="graph-wrapper">
                <svg id="temperature-graph" viewBox="0 0 800 400">
                    <!-- Dynamically generated -->
                </svg>
                
                <!-- Node Settings Panel (inline below graph) -->
                <div id="node-settings-panel" class="node-settings-panel" style="display: none;">
                    <div class="settings-header">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <button id="prev-node" class="btn-nav-node" title="Previous node">◀</button>
                            <h3>Node Settings</h3>
                            <button id="next-node" class="btn-nav-node" title="Next node">▶</button>
                        </div>
                        <button id="close-settings" class="btn-close-settings">✕</button>
                    </div>
                    <div class="settings-grid">
                        <div class="setting-item">
                            <label>Time:</label>
                            <div class="input-spinner">
                                <button class="spinner-btn" id="time-down" title="-15 minutes">▼</button>
                                <input type="time" id="node-time-input" class="time-input" />
                                <button class="spinner-btn" id="time-up" title="+15 minutes">▲</button>
                            </div>
                        </div>
                        <div class="setting-item">
                            <label>Temperature:</label>
                            <div class="input-spinner">
                                <button class="spinner-btn" id="temp-down">▼</button>
                                <input type="number" id="node-temp-input" class="temp-input" />
                                <button class="spinner-btn" id="temp-up">▲</button>
                            </div>
                        </div>
                        <div class="setting-item" style="padding-left: 20px;">
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" id="temp-no-change" style="margin-right: 8px; cursor: pointer;" />
                                <span>No Change</span>
                            </label>
                        </div>
                        <div class="setting-item">
                            <label>HVAC Mode:</label>
                            <select id="node-hvac-mode" disabled title="Coming soon">
                                <option value="heat">Heat</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label>Fan Mode:</label>
                            <select id="node-fan-mode" disabled title="Coming soon">
                                <option value="auto">Auto</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label>Swing Mode:</label>
                            <select id="node-swing-mode" disabled title="Coming soon">
                                <option value="off">Off</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label>Preset Mode:</label>
                            <select id="node-preset-mode" disabled title="Coming soon">
                                <option value="none">None</option>
                            </select>
                        </div>
                        <div class="setting-item" style="grid-column: 1 / -1;">
                            <label style="display: block; margin-bottom: 8px;">Custom Values:</label>
                            <div style="display: flex; gap: 12px;">
                                <div style="flex: 1; min-width: 100px;">
                                    <label style="font-size: 0.9em; color: var(--secondary-text-color);">A:</label>
                                    <input type="number" id="node-value-A" class="value-input" step="any" placeholder="Optional" style="width: 100%;" />
                                </div>
                                <div style="flex: 1; min-width: 100px;">
                                    <label style="font-size: 0.9em; color: var(--secondary-text-color);">B:</label>
                                    <input type="number" id="node-value-B" class="value-input" step="any" placeholder="Optional" style="width: 100%;" />
                                </div>
                                <div style="flex: 1; min-width: 100px;">
                                    <label style="font-size: 0.9em; color: var(--secondary-text-color);">C:</label>
                                    <input type="number" id="node-value-C" class="value-input" step="any" placeholder="Optional" style="width: 100%;" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="settings-actions">
                        <button id="test-fire-event-btn" class="btn-secondary" title="Test fire event with this node">🧪 Test Event</button>
                        <button id="delete-node" class="btn-danger">Delete Node</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Instructions Section (Collapsible) -->
        <div class="instructions-container">
            <div class="instructions-toggle">
                <span class="toggle-icon">▶</span>
                <span class="toggle-text">Instructions</span>
            </div>
            <div class="graph-instructions collapsed" style="display: none;">
                <p>📍 <strong>Double-click or double-tap</strong> the line to add a new node</p>
                <p>👆 <strong>Drag nodes</strong> vertically to change temperature or horizontally to move their time</p>
                <p>⬌ <strong>Drag the horizontal segment</strong> between two nodes to shift that period while preserving its duration</p>
                <p>📋 <strong>Copy / Paste</strong> buttons duplicate a schedule across days or entities</p>
                <p>⚙️ <strong>Tap a node</strong> to open its settings panel for HVAC/fan/swing/preset values</p>
            </div>
        </div>
    `;
    return editor;
}

// Collapse all editors
function collapseAllEditors() {
    const allEditors = getDocumentRoot().querySelectorAll('.schedule-editor-inline');
    allEditors.forEach(editor => editor.remove());
    
    // Remove all close buttons
    const allCloseButtons = getDocumentRoot().querySelectorAll('.close-entity-btn');
    allCloseButtons.forEach(btn => btn.remove());
    
    const allCards = getDocumentRoot().querySelectorAll('.entity-card');
    allCards.forEach(card => {
        card.classList.remove('selected', 'expanded');
        
        // Reset add to group button text to "+"
        const addToGroupBtn = card.querySelector('.add-to-group-btn');
        if (addToGroupBtn) {
            addToGroupBtn.textContent = '+';
            addToGroupBtn.style.padding = '4px 8px';
        }
    });
    
    const allGroupContainers = getDocumentRoot().querySelectorAll('.group-container');
    allGroupContainers.forEach(container => container.classList.remove('expanded'));
}

// Attach event listeners to editor elements (for dynamically created editors)
function attachEditorEventListeners(editorElement) {
    
    // Instructions toggle
    const instructionsToggle = editorElement.querySelector('.instructions-toggle');
    const instructionsContent = editorElement.querySelector('.graph-instructions');
    if (instructionsToggle && instructionsContent) {
        instructionsToggle.onclick = () => {
            const isCollapsed = instructionsContent.classList.contains('collapsed');
            if (isCollapsed) {
                instructionsContent.classList.remove('collapsed');
                instructionsContent.style.display = 'block';
                instructionsToggle.querySelector('.toggle-icon').style.transform = 'rotate(90deg)';
            } else {
                instructionsContent.classList.add('collapsed');
                instructionsContent.style.display = 'none';
                instructionsToggle.querySelector('.toggle-icon').style.transform = 'rotate(0deg)';
            }
        };
    }
    
    // Ignore button (Unmonitor button for single-entity groups)
    const ignoreBtn = editorElement.querySelector('#ignore-entity-btn');
    if (ignoreBtn) {
        ignoreBtn.onclick = async (event) => {
            // For single-entity groups, get entity from the group
            let entityIdToUnmonitor = null;
            if (currentGroup) {
                const groupData = allGroups[currentGroup];
                if (groupData && groupData.entities && groupData.entities.length === 1) {
                    entityIdToUnmonitor = groupData.entities[0];
                }
            }
            
            if (!entityIdToUnmonitor) {
                console.error('No entity ID found to unmonitor');
                return;
            }
            
            if (confirm(`Stop monitoring ${entityIdToUnmonitor}?\n\nUnmonitored entities will not be managed by the scheduler.`)) {
                try {
                    await haAPI.setIgnored(entityIdToUnmonitor, true);
                    showToast(`${entityIdToUnmonitor} is now unmonitored`, 'success');
                    // Reload groups to update the display
                    await loadGroups();
                    // Close the editor
                    collapseAllEditors();
                    currentGroup = null;
                } catch (error) {
                    console.error('Failed to unmonitor entity:', error);
                    showToast('Failed to unmonitor entity: ' + error.message, 'error');
                }
            }
        };
    }
    
    // Copy schedule button
    const copyBtn = editorElement.querySelector('#copy-schedule-btn');
    if (copyBtn) {
        copyBtn.onclick = () => {
            copySchedule();
        };
    }
    
    // Paste schedule button
    const pasteBtn = editorElement.querySelector('#paste-schedule-btn');
    if (pasteBtn) {
        pasteBtn.onclick = () => {
            pasteSchedule();
        };
    }
    
    // Advance schedule button
    const advanceBtn = editorElement.querySelector('#advance-schedule-btn');
    if (advanceBtn) {
        // Function to update button state
        const updateAdvanceButton = async () => {
            if (currentGroup) {
                // For groups, check if any entity has an active advance
                const groupData = allGroups[currentGroup];
                if (groupData && groupData.entities) {
                    let anyActive = false;
                    for (const entityId of groupData.entities) {
                        const status = await haAPI.getAdvanceStatus(entityId);
                        if (status && status.is_active) {
                            anyActive = true;
                            break;
                        }
                    }
                    if (anyActive) {
                        advanceBtn.textContent = 'Cancel Advance';
                        advanceBtn.title = 'Cancel advance override for all entities in group';
                        advanceBtn.dataset.isOverride = 'true';
                    } else {
                        advanceBtn.textContent = 'Advance';
                        advanceBtn.title = 'Advance all entities in group to next scheduled node';
                        advanceBtn.dataset.isOverride = 'false';
                    }
                }
            }
        };
        
        // Check initial state
        updateAdvanceButton();
        
        advanceBtn.onclick = async () => {
            advanceBtn.disabled = true;
            try {
                const isOverride = advanceBtn.dataset.isOverride === 'true';
                
                if (isOverride) {
                    // Cancel advance
                    if (currentGroup) {
                        // Cancel advance for all entities in group
                        const groupData = allGroups[currentGroup];
                        if (groupData && groupData.entities) {
                            for (const entityId of groupData.entities) {
                                await haAPI.cancelAdvance(entityId);
                            }
                            showToast('Advance canceled for all entities in group', 'success');

                            // Optimistically update button state immediately
                            advanceBtn.textContent = 'Advance';
                            advanceBtn.title = 'Advance all entities in group to next scheduled node';
                            advanceBtn.dataset.isOverride = 'false';
                        }
                    }
                } else {
                    // Advance to next
                    if (currentGroup) {
                        await haAPI.advanceGroup(currentGroup);
                        showToast(`Advanced all entities in group to next scheduled node`, 'success');

                        // Optimistically update button state immediately
                        advanceBtn.textContent = 'Cancel Advance';
                        advanceBtn.title = 'Cancel advance override for all entities in group';
                        advanceBtn.dataset.isOverride = 'true';
                    }
                }
                
                // Update button state after action
                await updateAdvanceButton();
                
                // Small delay to ensure backend has updated
                await new Promise(resolve => setTimeout(resolve, 500));

                // Re-check after backend settles (important if updateAdvanceButton ran too early)
                await updateAdvanceButton();
                
                // Reload advance history to update graph
                if (currentGroup) {
                    // For groups, reload history for first entity (since they share same schedule)
                    const groupData = allGroups[currentGroup];
                    if (groupData && groupData.entities && groupData.entities.length > 0) {
                        await loadAdvanceHistory(groupData.entities[0]);
                    }
                }
            } catch (error) {
                console.error('Failed to advance/cancel schedule:', error);
                showToast('Failed: ' + error.message, 'error');
            } finally {
                advanceBtn.disabled = false;
            }
        };
    }
    
    // Clear advance history button
    const clearHistoryBtn = editorElement.querySelector('#clear-advance-history-btn');
    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = async () => {
            clearHistoryBtn.disabled = true;
            try {
                if (currentGroup) {
                    // Clear history for all entities in group
                    const groupData = allGroups[currentGroup];
                    if (groupData && groupData.entities) {
                        for (const entityId of groupData.entities) {
                            await haAPI.clearAdvanceHistory(entityId);
                        }
                        // Reload graph with first entity
                        if (groupData.entities.length > 0) {
                            await loadAdvanceHistory(groupData.entities[0]);
                        }
                        showToast('Advance history cleared for all entities in group', 'success');
                    }
                }
            } catch (error) {
                console.error('Failed to clear advance history:', error);
                showToast('Failed: ' + error.message, 'error');
            } finally {
                clearHistoryBtn.disabled = false;
            }
        };
    }
    
    // Clear schedule button
    const clearBtn = editorElement.querySelector('#clear-schedule-btn');
    if (clearBtn) {
        clearBtn.onclick = async () => {
            if (currentGroup) {
                if (confirm(`Clear schedule for group "${currentGroup}"?`)) {
                    await clearScheduleForGroup(currentGroup);
                }
            }
        };
    }
    
    // Schedule enabled toggle
    const enabledToggle = editorElement.querySelector('#schedule-enabled');
    if (enabledToggle) {
        enabledToggle.onchange = () => saveSchedule();
    }

    // Save button
    const saveBtn = editorElement.querySelector('#save-schedule-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            await saveSchedule();
            // Visual feedback
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.disabled = false;
            }, 1000);
        };
    }
    
    // Node settings panel close
    const closeSettings = editorElement.querySelector('#close-settings');
    if (closeSettings) {
        closeSettings.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            if (panel) {
                panel.style.display = 'none';
                // Clear selected node highlight
                if (graph) {
                    graph.selectedNodeIndex = null;
                    graph.render();
                }
            }
        };
    }
    
    // Node navigation buttons
    const prevNodeBtn = editorElement.querySelector('#prev-node');
    const nextNodeBtn = editorElement.querySelector('#next-node');
    
    if (prevNodeBtn) {
        prevNodeBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const currentIndex = parseInt(panel.dataset.nodeIndex);
            if (!isNaN(currentIndex) && graph && graph.nodes.length > 0) {
                const sortedIndices = graph.getSortedNodeIndices();
                const currentPos = sortedIndices.indexOf(currentIndex);
                const newPos = currentPos > 0 ? currentPos - 1 : sortedIndices.length - 1;
                const newIndex = sortedIndices[newPos];
                graph.showNodeSettings(newIndex);
            }
        };
    }
    
    if (nextNodeBtn) {
        nextNodeBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const currentIndex = parseInt(panel.dataset.nodeIndex);
            if (!isNaN(currentIndex) && graph && graph.nodes.length > 0) {
                const sortedIndices = graph.getSortedNodeIndices();
                const currentPos = sortedIndices.indexOf(currentIndex);
                const newPos = currentPos < graph.nodes.length - 1 ? currentPos + 1 : 0;
                const newIndex = sortedIndices[newPos];
                graph.showNodeSettings(newIndex);
            }
        };
    }
    
    // Time and temperature adjustment controls
    const timeInput = editorElement.querySelector('#node-time-input');
    const tempInput = editorElement.querySelector('#node-temp-input');
    const timeUpBtn = editorElement.querySelector('#time-up');
    const timeDownBtn = editorElement.querySelector('#time-down');
    const tempUpBtn = editorElement.querySelector('#temp-up');
    const tempDownBtn = editorElement.querySelector('#temp-down');
    
    const updateNodeFromInputs = () => {
        const panel = editorElement.querySelector('#node-settings-panel');
        const nodeIndex = parseInt(panel.dataset.nodeIndex);
        if (isNaN(nodeIndex) || !graph) return;
        
        const node = graph.nodes[nodeIndex];
        if (!node) return;
        
        // Update time
        if (timeInput && timeInput.value) {
            node.time = timeInput.value;
        }
        
        // Update temperature
        const tempNoChange = editorElement.querySelector('#temp-no-change');
        if (tempNoChange && tempNoChange.checked) {
            node.noChange = true;
        } else {
            node.noChange = false;
            if (tempInput && tempInput.value) {
                const temp = parseFloat(tempInput.value);
                if (!isNaN(temp)) {
                    node.temp = temp;
                }
            }
        }
        
        graph.render();
        saveSchedule();
    };
    
    if (timeInput) {
        timeInput.addEventListener('change', updateNodeFromInputs);
        timeInput.addEventListener('blur', updateNodeFromInputs);
    }
    
    if (tempInput) {
        tempInput.addEventListener('change', updateNodeFromInputs);
        tempInput.addEventListener('blur', updateNodeFromInputs);
    }
    
    if (timeUpBtn) {
        timeUpBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            // Parse time and add 15 minutes
            const [hours, minutes] = node.time.split(':').map(Number);
            let totalMinutes = hours * 60 + minutes + 15;
            if (totalMinutes >= 1440) totalMinutes -= 1440; // Wrap at 24h
            
            const newHours = Math.floor(totalMinutes / 60);
            const newMinutes = totalMinutes % 60;
            node.time = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
            
            timeInput.value = node.time;
            graph.render();
            saveSchedule();
        };
    }
    
    if (timeDownBtn) {
        timeDownBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            // Parse time and subtract 15 minutes
            const [hours, minutes] = node.time.split(':').map(Number);
            let totalMinutes = hours * 60 + minutes - 15;
            if (totalMinutes < 0) totalMinutes += 1440; // Wrap at 0
            
            const newHours = Math.floor(totalMinutes / 60);
            const newMinutes = totalMinutes % 60;
            node.time = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
            
            timeInput.value = node.time;
            graph.render();
            saveSchedule();
        };
    }
    
    if (tempUpBtn) {
        tempUpBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            // Check if no-change is enabled
            const tempNoChange = editorElement.querySelector('#temp-no-change');
            if (tempNoChange && tempNoChange.checked) return;
            
            // Increment based on inputTempStep setting
            const multiplier = 1 / inputTempStep;
            node.temp = Math.round((node.temp + inputTempStep) * multiplier) / multiplier;
            
            tempInput.value = node.temp;
            graph.render();
            saveSchedule();
        };
    }
    
    if (tempDownBtn) {
        tempDownBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            // Check if no-change is enabled
            const tempNoChange = editorElement.querySelector('#temp-no-change');
            if (tempNoChange && tempNoChange.checked) return;
            
            // Decrement based on inputTempStep setting
            const multiplier = 1 / inputTempStep;
            node.temp = Math.round((node.temp - inputTempStep) * multiplier) / multiplier;
            
            tempInput.value = node.temp;
            graph.render();
            saveSchedule();
        };
    };
    
    // Test fire event button (in node settings)
    const testFireBtn = editorElement.querySelector('#test-fire-event-btn');
    if (testFireBtn) {
        testFireBtn.onclick = async () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph || !currentGroup) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            testFireBtn.disabled = true;
            try {
                // Get current day
                const now = new Date();
                const currentDay = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][now.getDay() === 0 ? 6 : now.getDay() - 1];
                
                await haAPI.testFireEvent(currentGroup, node, currentDay);
                showToast(`Test event fired for node at ${node.time}`, 'success');
            } catch (error) {
                console.error('Failed to test fire event:', error);
                showToast('Failed to fire test event: ' + error.message, 'error');
            } finally {
                testFireBtn.disabled = false;
            }
        };
    }
    
    // Delete node button
    const deleteNode = editorElement.querySelector('#delete-node');
    if (deleteNode) {
        deleteNode.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (!isNaN(nodeIndex) && graph) {
                graph.removeNodeByIndex(nodeIndex);
                panel.style.display = 'none';
                saveSchedule();
            }
        };
    }
    
    // Handle no-change checkbox
    const tempNoChange = editorElement.querySelector('#temp-no-change');
    if (tempNoChange) {
        tempNoChange.onchange = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (isNaN(nodeIndex) || !graph) return;
            
            const node = graph.nodes[nodeIndex];
            if (!node) return;
            
            if (tempNoChange.checked) {
                // Set to no change
                node.noChange = true;
                tempInput.disabled = true;
                tempUpBtn.disabled = true;
                tempDownBtn.disabled = true;
            } else {
                // Restore to normal temperature node
                node.noChange = false;
                if (node.temp === null || node.temp === undefined) {
                    node.temp = 20; // Default temp
                }
                tempInput.value = node.temp;
                tempInput.disabled = false;
                tempUpBtn.disabled = false;
                tempDownBtn.disabled = false;
            }
            
            graph.render();
            saveSchedule();
        };
    }
    
    // Auto-save node settings when dropdowns change
    const hvacModeSelect = editorElement.querySelector('#node-hvac-mode');
    const fanModeSelect = editorElement.querySelector('#node-fan-mode');
    const swingModeSelect = editorElement.querySelector('#node-swing-mode');
    const presetModeSelect = editorElement.querySelector('#node-preset-mode');
    
    const autoSaveNodeSettings = async () => {
        const panel = editorElement.querySelector('#node-settings-panel');
        if (!panel) return;
        
        const nodeIndex = parseInt(panel.dataset.nodeIndex);
        if (isNaN(nodeIndex) || !graph) return;
        
        // Get the actual node from the graph
        const node = graph.nodes[nodeIndex];
        if (!node) return;
        
        // Update or delete properties based on dropdown values
        if (hvacModeSelect && hvacModeSelect.closest('.setting-item').style.display !== 'none') {
            const hvacMode = hvacModeSelect.value;
            if (hvacMode) {
                node.hvac_mode = hvacMode;
            } else {
                delete node.hvac_mode;
            }
        }
        
        if (fanModeSelect && fanModeSelect.closest('.setting-item').style.display !== 'none') {
            const fanMode = fanModeSelect.value;
            if (fanMode) {
                node.fan_mode = fanMode;
            } else {
                delete node.fan_mode;
            }
        }
        
        if (swingModeSelect && swingModeSelect.closest('.setting-item').style.display !== 'none') {
            const swingMode = swingModeSelect.value;
            if (swingMode) {
                node.swing_mode = swingMode;
            } else {
                delete node.swing_mode;
            }
        }
        
        if (presetModeSelect && presetModeSelect.closest('.setting-item').style.display !== 'none') {
            const presetMode = presetModeSelect.value;
            if (presetMode) {
                node.preset_mode = presetMode;
            } else {
                delete node.preset_mode;
            }
        }
        
        // Update value fields
        const valueAInput = editorElement.querySelector('#node-value-A');
        const valueBInput = editorElement.querySelector('#node-value-B');
        const valueCInput = editorElement.querySelector('#node-value-C');
        
        if (valueAInput) {
            const val = valueAInput.value.trim();
            node['A'] = val !== '' ? parseFloat(val) : null;
        }
        if (valueBInput) {
            const val = valueBInput.value.trim();
            node['B'] = val !== '' ? parseFloat(val) : null;
        }
        if (valueCInput) {
            const val = valueCInput.value.trim();
            node['C'] = val !== '' ? parseFloat(val) : null;
        }
        
        // This will trigger save and force immediate update
        graph.notifyChange(true);
    };
    
    // Attach change listeners to all dropdowns and value inputs
    if (hvacModeSelect) hvacModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (fanModeSelect) fanModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (swingModeSelect) swingModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (presetModeSelect) presetModeSelect.addEventListener('change', autoSaveNodeSettings);
    
    const valueAInput = editorElement.querySelector('#node-value-A');
    const valueBInput = editorElement.querySelector('#node-value-B');
    const valueCInput = editorElement.querySelector('#node-value-C');
    if (valueAInput) valueAInput.addEventListener('change', autoSaveNodeSettings);
    if (valueBInput) valueBInput.addEventListener('change', autoSaveNodeSettings);
    if (valueCInput) valueCInput.addEventListener('change', autoSaveNodeSettings);
    
    // Schedule mode radio buttons
    const modeRadios = editorElement.querySelectorAll('input[name="schedule-mode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                const newMode = e.target.value;
                await switchScheduleMode(newMode);
            }
        });
    });
    
    // Day selector buttons (for individual mode)
    const dayButtons = editorElement.querySelectorAll('#day-selector .day-btn');
    dayButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            await switchDay(btn.dataset.day);
        });
    });
    
    // Weekday selector buttons (for 5/2 mode)
    const weekdayButtons = editorElement.querySelectorAll('#weekday-selector .day-btn');
    weekdayButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            await switchDay(btn.dataset.day);
        });
    });
    
    // Graph quick action buttons
    const graphCopyBtn = editorElement.querySelector('#graph-copy-btn');
    if (graphCopyBtn) {
        graphCopyBtn.onclick = () => {
            copySchedule();
        };
    }
    
    const graphPasteBtn = editorElement.querySelector('#graph-paste-btn');
    if (graphPasteBtn) {
        graphPasteBtn.onclick = () => {
            pasteSchedule();
        };
    }
    
    const graphUndoBtn = editorElement.querySelector('#graph-undo-btn');
    if (graphUndoBtn && graph) {
        graph.setUndoButton(graphUndoBtn);
    }
}

// Clipboard for schedule copy/paste
let scheduleClipboard = null;

// Update paste button state based on clipboard
function updatePasteButtonState() {
    const pasteBtn = getDocumentRoot().querySelector('#paste-schedule-btn');
    if (pasteBtn) {
        pasteBtn.disabled = !scheduleClipboard || scheduleClipboard.length === 0;
    }
    const graphPasteBtn = getDocumentRoot().querySelector('#graph-paste-btn');
    if (graphPasteBtn) {
        graphPasteBtn.disabled = !scheduleClipboard || scheduleClipboard.length === 0;
    }
}

// Copy current schedule to clipboard
function copySchedule() {
    const nodes = graph.getNodes();
    if (nodes && nodes.length > 0) {
        // Deep copy the nodes
        scheduleClipboard = nodes.map(n => ({...n}));
        
        // Enable paste buttons
        updatePasteButtonState();
        
        // Visual feedback
        const copyBtn = getDocumentRoot().querySelector('#copy-schedule-btn');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1000);
        }
    }
}

// Paste schedule from clipboard
async function pasteSchedule() {
    if (!scheduleClipboard || scheduleClipboard.length === 0) {
        return;
    }
    
    // Deep copy from clipboard
    const nodes = scheduleClipboard.map(n => ({...n}));
    
    // Update graph
    graph.setNodes(nodes);
    
    // Save the pasted schedule
    await saveSchedule();
    
    // Visual feedback
    const pasteBtn = getDocumentRoot().querySelector('#paste-schedule-btn');
    if (pasteBtn) {
        const originalText = pasteBtn.textContent;
        pasteBtn.textContent = 'Pasted!';
        setTimeout(() => {
            pasteBtn.textContent = originalText;
        }, 1000);
    }
}

// Clear schedule for an entity
async function clearScheduleForEntity(entityId) {
    try {
        // Reset to user-configured default schedule
        const defaultSchedule = defaultScheduleSettings.map(node => ({...node}));
        
        // Save default schedule to HA with current day and mode
        await haAPI.setSchedule(entityId, defaultSchedule, currentDay, currentScheduleMode);
        
        // Update local state
        entitySchedules.set(entityId, defaultSchedule);
        
        // Update graph with default schedule
        if (graph) {
            graph.setNodes(defaultSchedule);
        }
        
        // Update current schedule reference
        currentSchedule = defaultSchedule;
        
        showToast('Schedule cleared', 'success');
    } catch (error) {
        console.error('Failed to clear schedule:', error);
        showToast('Failed to clear schedule. Please try again.', 'error');
    }
}

// Clear schedule for a group
async function clearScheduleForGroup(groupName) {
    try {
        const groupData = allGroups[groupName];
        if (!groupData) return;
        
        // Reset to user-configured default schedule
        const defaultSchedule = defaultScheduleSettings.map(node => ({...node}));
        
        // Update group schedules based on schedule mode
        const scheduleMode = groupData.schedule_mode || 'all_days';
        
        // Save default schedule for each day based on schedule mode
        if (scheduleMode === 'all_days') {
            await haAPI.setGroupSchedule(groupName, defaultSchedule, 'all_days', scheduleMode);
            groupData.schedules = { all_days: defaultSchedule };
        } else if (scheduleMode === '5/2') {
            await haAPI.setGroupSchedule(groupName, defaultSchedule.map(node => ({...node})), 'weekday', scheduleMode);
            await haAPI.setGroupSchedule(groupName, defaultSchedule.map(node => ({...node})), 'weekend', scheduleMode);
            groupData.schedules = {
                weekday: defaultSchedule.map(node => ({...node})),
                weekend: defaultSchedule.map(node => ({...node}))
            };
        } else if (scheduleMode === 'individual') {
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            for (const day of days) {
                await haAPI.setGroupSchedule(groupName, defaultSchedule.map(node => ({...node})), day, scheduleMode);
            }
            groupData.schedules = {
                mon: defaultSchedule.map(node => ({...node})),
                tue: defaultSchedule.map(node => ({...node})),
                wed: defaultSchedule.map(node => ({...node})),
                thu: defaultSchedule.map(node => ({...node})),
                fri: defaultSchedule.map(node => ({...node})),
                sat: defaultSchedule.map(node => ({...node})),
                sun: defaultSchedule.map(node => ({...node}))
            };
        }
        
        // Update graph with default schedule for current day
        if (graph) {
            graph.setNodes(defaultSchedule);
        }
        
        // Update current schedule reference
        currentSchedule = defaultSchedule;
        
        showToast(`Cleared schedule for group "${groupName}"`, 'success');
    } catch (error) {
        console.error('Failed to clear group schedule:', error);
        showToast('Failed to clear group schedule. Please try again.', 'error');
    }
}

// Update schedule mode UI to reflect current mode and day
function updateScheduleModeUI() {
    // Update mode radio buttons
    const modeRadios = getDocumentRoot().querySelectorAll('input[name="schedule-mode"]');
    modeRadios.forEach(radio => {
        radio.checked = (radio.value === currentScheduleMode);
    });
    
    // Show/hide appropriate day selectors
    const daySelector = getDocumentRoot().querySelector('#day-selector');
    const weekdaySelector = getDocumentRoot().querySelector('#weekday-selector');
    
    if (daySelector && weekdaySelector) {
        // Hide both first
        daySelector.classList.remove('visible');
        weekdaySelector.classList.remove('visible');
        
        // Show the appropriate one
        if (currentScheduleMode === 'individual') {
            daySelector.classList.add('visible');
        } else if (currentScheduleMode === '5/2') {
            weekdaySelector.classList.add('visible');
        }
    }
    
    // Update active day button
    if (currentScheduleMode === 'individual') {
        getDocumentRoot().querySelectorAll('#day-selector .day-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.day === currentDay);
        });
    } else if (currentScheduleMode === '5/2') {
        getDocumentRoot().querySelectorAll('#weekday-selector .day-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.day === currentDay);
        });
    }
    
    // Update day/period selector above graph
    updateGraphDaySelector();
    
    // Update graph title to show current day
    updateGraphTitle();
}

// Update the day/period selector above the graph
function updateGraphDaySelector() {
    const dayPeriodSelector = getDocumentRoot().querySelector('#day-period-selector');
    const dayPeriodButtons = getDocumentRoot().querySelector('#day-period-buttons');
    
    if (!dayPeriodSelector || !dayPeriodButtons) return;
    
    // Update profile dropdown
    updateGraphProfileDropdown();
    
    // Hide selector if in all_days mode
    if (currentScheduleMode === 'all_days') {
        dayPeriodSelector.style.display = 'none';
        return;
    }
    
    // Show selector
    dayPeriodSelector.style.display = 'block';
    
    // Clear existing buttons
    dayPeriodButtons.innerHTML = '';
    
    // Create buttons based on mode
    if (currentScheduleMode === 'individual') {
        const days = [
            { value: 'mon', label: 'Mon' },
            { value: 'tue', label: 'Tue' },
            { value: 'wed', label: 'Wed' },
            { value: 'thu', label: 'Thu' },
            { value: 'fri', label: 'Fri' },
            { value: 'sat', label: 'Sat' },
            { value: 'sun', label: 'Sun' }
        ];
        
        days.forEach(day => {
            const btn = document.createElement('button');
            btn.className = 'day-period-btn';
            btn.textContent = day.label;
            btn.dataset.day = day.value;
            if (currentDay === day.value) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', async () => {
                await switchDay(day.value);
            });
            dayPeriodButtons.appendChild(btn);
        });
    } else if (currentScheduleMode === '5/2') {
        const periods = [
            { value: 'weekday', label: 'Weekday' },
            { value: 'weekend', label: 'Weekend' }
        ];
        
        periods.forEach(period => {
            const btn = document.createElement('button');
            btn.className = 'day-period-btn';
            btn.textContent = period.label;
            btn.dataset.day = period.value;
            if (currentDay === period.value) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', async () => {
                await switchDay(period.value);
            });
            dayPeriodButtons.appendChild(btn);
        });
    }
}

// Update the profile dropdown above the graph
function updateGraphProfileDropdown() {
    const graphProfileDropdown = getDocumentRoot().querySelector('#graph-profile-dropdown');
    if (!graphProfileDropdown) {
        return;
    }
    
    // Get current active profile
    const activeProfile = (currentGroup && allGroups[currentGroup]?.active_profile) || 'Default';
    
    // Get all profiles
    const profiles = (currentGroup && allGroups[currentGroup]?.profiles ? Object.keys(allGroups[currentGroup].profiles) : ['Default']);
    
    // Update dropdown options
    graphProfileDropdown.innerHTML = '';
    profiles.forEach(profileName => {
        const option = document.createElement('option');
        option.value = profileName;
        option.textContent = profileName;
        if (profileName === activeProfile) {
            option.selected = true;
        }
        graphProfileDropdown.appendChild(option);
    });
    
    // Remove existing event listener by cloning
    const newDropdown = graphProfileDropdown.cloneNode(true);
    graphProfileDropdown.parentNode.replaceChild(newDropdown, graphProfileDropdown);
    
    // Set the value after cloning to ensure it's selected
    newDropdown.value = activeProfile;
    
    // Add event listener for profile change
    newDropdown.addEventListener('change', async (e) => {
        const newProfile = e.target.value;
        
        try {
            if (currentGroup) {
                await haAPI.setActiveProfile(currentGroup, newProfile);
                
                // Reload group data from server
                const groupsResult = await haAPI.getGroups();
                allGroups = groupsResult.groups || groupsResult;
                
                // editGroupSchedule will call updateGraphProfileDropdown via updateGraphDaySelector
                await editGroupSchedule(currentGroup);
            }
            
            showToast(`Switched to profile: ${newProfile}`, 'success');
        } catch (error) {
            console.error('Failed to switch profile:', error);
            showToast('Failed to switch profile', 'error');
        }
    });
}

// Set previous day's last temperature for graph rendering
function setPreviousDayLastTempForGraph(groupData, currentDayParam) {
    if (!graph || !groupData || !groupData.schedules) return;
    
    const scheduleMode = groupData.schedule_mode || 'all_days';
    
    // In all_days mode, previous day is same as current day
    if (scheduleMode === 'all_days') {
        graph.setPreviousDayLastTemp(null);
        return;
    }
    
    // Determine previous day based on schedule mode
    let previousDayKey = null;
    
    if (scheduleMode === '5/2') {
        // In weekday/weekend mode
        if (currentDayParam === 'weekday') {
            // Previous period is weekend
            previousDayKey = 'weekend';
        } else if (currentDayParam === 'weekend') {
            // Previous period is weekday (Friday)
            previousDayKey = 'weekday';
        }
    } else if (scheduleMode === 'individual') {
        // In 7-day mode, get actual previous day
        const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const currentIndex = days.indexOf(currentDayParam);
        if (currentIndex !== -1) {
            previousDayKey = days[(currentIndex - 1 + 7) % 7];
        }
    }
    
    // Get previous day's schedule
    if (previousDayKey && groupData.schedules[previousDayKey]) {
        const previousDayNodes = groupData.schedules[previousDayKey];
        if (previousDayNodes && previousDayNodes.length > 0) {
            // Find the last node with a temperature (not noChange)
            const nodesWithTemp = previousDayNodes.filter(n => !n.noChange && n.temp !== null && n.temp !== undefined);
            if (nodesWithTemp.length > 0) {
                const lastNode = nodesWithTemp[nodesWithTemp.length - 1];
                graph.setPreviousDayLastTemp(lastNode.temp);
                return;
            }
        }
    }
    
    // If no previous day data found, don't set it (will fall back to current day's last node)
    graph.setPreviousDayLastTemp(null);
}

// Update graph title to show which day is being edited
function updateGraphTitle() {
    const graphWrapper = getDocumentRoot().querySelector('.graph-wrapper');
    let titleElement = graphWrapper.querySelector('.schedule-day-title');
    
    if (!titleElement) {
        titleElement = document.createElement('div');
        titleElement.className = 'schedule-day-title';
        titleElement.style.marginBottom = '10px';
        titleElement.style.fontSize = '0.9rem';
        titleElement.style.color = 'var(--text-secondary)';
        graphWrapper.insertBefore(titleElement, graphWrapper.firstChild);
    }
    
    if (currentScheduleMode === 'all_days') {
        titleElement.textContent = 'Schedule (All Days)';
    } else if (currentScheduleMode === '5/2') {
        const dayName = currentDay === 'weekday' ? 'Weekdays' : 'Weekend';
        titleElement.textContent = `Schedule (${dayName})`;
    } else {
        const dayNames = {
            'mon': 'Monday',
            'tue': 'Tuesday', 
            'wed': 'Wednesday',
            'thu': 'Thursday',
            'fri': 'Friday',
            'sat': 'Saturday',
            'sun': 'Sunday'
        };
        titleElement.textContent = `Schedule (${dayNames[currentDay] || currentDay})`;
    }
}

// Switch to a different schedule mode
async function switchScheduleMode(newMode) {
    if (!currentGroup) return;
    
    currentScheduleMode = newMode;
    
    // Determine default day for new mode
    const now = new Date();
    const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    
    if (newMode === 'all_days') {
        currentDay = 'all_days';
    } else if (newMode === '5/2') {
        currentDay = (weekday === 'sat' || weekday === 'sun') ? 'weekend' : 'weekday';
    } else {
        currentDay = weekday;
    }
    
    // Save the mode change to backend first
    if (currentGroup) {
        const nodes = graph.getNodes();
        await haAPI.setGroupSchedule(currentGroup, nodes, currentDay, currentScheduleMode);
        
        // Update local group data
        if (allGroups[currentGroup]) {
            allGroups[currentGroup].schedule_mode = currentScheduleMode;
        }
    }
    
    // Update UI
    updateScheduleModeUI();
    
    // Reload group data from backend to get latest saved state
    if (currentGroup) {
        const result = await haAPI.getGroups();
        let groups = result?.response || result || {};
        if (groups.groups && typeof groups.groups === 'object') {
            groups = groups.groups;
        }
        allGroups = groups;
        
        const groupData = allGroups[currentGroup];
        if (!groupData) return;
        
        // Load nodes for the selected day
        let nodes = [];
        if (groupData.schedules && groupData.schedules[currentDay]) {
            nodes = groupData.schedules[currentDay];
        } else if (currentDay === "weekday" && groupData.schedules && groupData.schedules["mon"]) {
            // If weekday key doesn't exist, try loading from Monday
            nodes = groupData.schedules["mon"];
        } else if (currentDay === "weekend" && groupData.schedules && groupData.schedules["sat"]) {
            // If weekend key doesn't exist, try loading from Saturday
            nodes = groupData.schedules["sat"];
        } else if (groupData.nodes) {
            // Backward compatibility
            nodes = groupData.nodes;
        }
        
        currentSchedule = nodes.length > 0 ? nodes.map(n => ({...n})) : [];
        
        // Set loading flag to prevent auto-save during graph update
        isLoadingSchedule = true;
        //
        
        // Update graph with new nodes
        graph.setNodes(currentSchedule);
        
        // Set previous day's last temperature for graph rendering
        setPreviousDayLastTempForGraph(groupData, currentDay);
        
        // Clear loading flag after a delay
        setTimeout(() => {
            isLoadingSchedule = false;
        //
        }, 100);
        
        // Clear editing profile and hide indicator when returning to active profile
        editingProfile = null;
        showEditingProfileIndicator(null, groupData.active_profile);
        
        // Update scheduled temp display
        updateScheduledTemp();
    }
}

// Switch to a different day
async function switchDay(day) {
    if (!currentGroup) return;
    
    // Switching day - no need to save since auto-save already persisted changes
    currentDay = day;
    
    // Day updated
    
    // Update UI first
    updateScheduleModeUI();
    
    // Reload schedule for selected day - update in place without recreating editor
    if (currentGroup) {
        // Reload group data from backend to get latest saved state
        // Reloading group data
        const result = await haAPI.getGroups();
        let groups = result?.response || result || {};
        if (groups.groups && typeof groups.groups === 'object') {
            groups = groups.groups;
        }
        allGroups = groups;
        
        const groupData = allGroups[currentGroup];
        if (!groupData) return;
        
        // Load nodes for the selected day
        let nodes = [];
        if (groupData.schedules && groupData.schedules[currentDay]) {
            nodes = groupData.schedules[currentDay];
        } else if (currentDay === "weekday" && groupData.schedules && groupData.schedules["mon"]) {
            // If weekday key doesn't exist, try loading from Monday
            nodes = groupData.schedules["mon"];
        } else if (currentDay === "weekend" && groupData.schedules && groupData.schedules["sat"]) {
            // If weekend key doesn't exist, try loading from Saturday
            nodes = groupData.schedules["sat"];
        } else if (groupData.nodes) {
            // Backward compatibility
            nodes = groupData.nodes;
        }
        
        currentSchedule = nodes.length > 0 ? nodes.map(n => ({...n})) : [];
        
        // Set loading flag to prevent auto-save during graph update
        isLoadingSchedule = true;
        //
        
        // Update graph with new nodes
        graph.setNodes(currentSchedule);
        
        // Set previous day's last temperature for graph rendering
        setPreviousDayLastTempForGraph(groupData, currentDay);
        
        // Clear loading flag after a delay
        setTimeout(() => {
            isLoadingSchedule = false;
        //
        }, 100);
        
        // Clear editing profile and hide indicator when returning to active profile
        editingProfile = null;
        showEditingProfileIndicator(null, groupData.active_profile);
        
        // Update scheduled temp display
        updateScheduledTemp();
    }
}

// Load history data for current day
async function loadHistoryData(entityId) {
    try {
        // Get start of today in server timezone
        const nowServer = getServerNow(serverTimeZone);
        const today = new Date(Date.UTC(nowServer.getFullYear(), nowServer.getMonth(), nowServer.getDate(), 0, 0, 0, 0));
        
        // Get current time
        const now = new Date();
        
        // Fetch history from Home Assistant
        const historyResult = await haAPI.getHistory(entityId, today, now);
        
        if (!historyResult || !historyResult[entityId]) {
            graph.setHistoryData([]);
            return;
        }
        
        // Process history data - extract current_temperature
        const historyData = [];
        const stateHistory = historyResult[entityId] || [];
        
        for (const state of stateHistory) {
            // Handle both abbreviated format (a, lu) and full format (attributes, last_updated)
            const attributes = state.a || state.attributes;
            const lastUpdated = state.lu || state.last_updated;
            
            if (!attributes) continue;
            
            const temp = parseFloat(attributes.current_temperature);
            if (!isNaN(temp)) {
                // Parse last_updated - could be ISO string, Unix timestamp, or Unix timestamp in milliseconds
                let stateTime;
                if (typeof lastUpdated === 'string') {
                    stateTime = new Date(lastUpdated);
                } else if (typeof lastUpdated === 'number') {
                    // Check if it's in seconds or milliseconds
                    stateTime = lastUpdated > 10000000000 
                        ? new Date(lastUpdated) 
                        : new Date(lastUpdated * 1000);
                } else {
                    continue; // Skip if we can't parse the time
                }
                
                const hours = stateTime.getHours().toString().padStart(2, '0');
                const minutes = stateTime.getMinutes().toString().padStart(2, '0');
                const timeStr = `${hours}:${minutes}`;
                
                historyData.push({
                    time: timeStr,
                    temp: temp
                });
            }
        }
        
        graph.setHistoryData(historyData);
    } catch (error) {
        console.error('Failed to load history data:', error);
        graph.setHistoryData([]);
    }
}

// Load history data for multiple entities (used for groups)
async function loadGroupHistoryData(entityIds) {
    if (!entityIds || entityIds.length === 0) {
        graph.setHistoryData([]);
        return;
    }
    
    try {
        // Get start of today in server timezone
        const nowServer = getServerNow(serverTimeZone);
        const today = new Date(Date.UTC(nowServer.getFullYear(), nowServer.getMonth(), nowServer.getDate(), 0, 0, 0, 0));
        
        // Get current time
        const now = new Date();
        
        const allHistoryData = [];
        const defaultColors = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ffeb3b', '#795548'];
        
        // Load history for each entity
        for (let i = 0; i < entityIds.length; i++) {
            const entityId = entityIds[i];
            const entity = climateEntities.find(e => e.entity_id === entityId);
            
            try {
                const historyResult = await haAPI.getHistory(entityId, today, now);
                
                if (historyResult && historyResult[entityId]) {
                    const historyData = [];
                    const stateHistory = historyResult[entityId] || [];
                    
                    for (const state of stateHistory) {
                        // Handle both abbreviated format (a, lu) and full format (attributes, last_updated)
                        const attributes = state.a || state.attributes;
                        const lastUpdated = state.lu || state.last_updated;
                        
                        if (!attributes) continue;
                        
                        const temp = parseFloat(attributes.current_temperature);
                        if (!isNaN(temp)) {
                            // Parse last_updated - could be ISO string, Unix timestamp, or Unix timestamp in milliseconds
                            let utcTime;
                            if (typeof lastUpdated === 'string') {
                                utcTime = new Date(lastUpdated);
                            } else if (typeof lastUpdated === 'number') {
                                // Check if it's in seconds or milliseconds
                                utcTime = lastUpdated > 10000000000 
                                    ? new Date(lastUpdated) 
                                    : new Date(lastUpdated * 1000);
                            } else {
                                continue; // Skip if we can't parse the time
                            }
                            
                            // Convert to server timezone
                            const stateTime = utcToServerDate(utcTime, serverTimeZone);
                            const hours = stateTime.getHours().toString().padStart(2, '0');
                            const minutes = stateTime.getMinutes().toString().padStart(2, '0');
                            const timeStr = `${hours}:${minutes}`;
                            
                            historyData.push({
                                time: timeStr,
                                temp: temp
                            });
                        }
                    }
                    
                    if (historyData.length > 0) {
                        allHistoryData.push({
                            entityId: entityId,
                            entityName: entity?.attributes?.friendly_name || entityId,
                            data: historyData,
                            color: defaultColors[i % defaultColors.length]
                        });
                    }
                }
            } catch (error) {
                console.error(`Failed to load history for ${entityId}:`, error);
            }
        }
        
        graph.setHistoryData(allHistoryData);
    } catch (error) {
        console.error('Failed to load group history data:', error);
        graph.setHistoryData([]);
    }
}

// Save schedule (auto-save, no alerts)
async function saveSchedule() {
    console.debug('[SAVE] saveSchedule() called', {
        timestamp: new Date().toISOString(),
        isLoadingSchedule,
        isSaveInProgress,
        hasPendingTimeout: saveTimeout !== null,
        currentGroup,
        currentDay,
        currentScheduleMode
    });

    // Don't save if we're in the middle of loading a schedule
    if (isLoadingSchedule) {
        console.debug('[SAVE] Skipped: isLoadingSchedule=true');
        return;
    }
    
    // If a save is already in progress, mark pending and return
    if (isSaveInProgress) {
        console.warn('[SAVE] Save in progress, marking pending save needed.');
        pendingSaveNeeded = true;
        return;
    }
    
    // Clear any existing debounce timeout
    if (saveTimeout) {
        console.debug('[SAVE] Clearing previous debounce timeout');
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    
    // Debounce: wait for changes to settle before saving
    console.debug(`[SAVE] Debouncing save for ${SAVE_DEBOUNCE_MS}ms`);
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        performSave();
    }, SAVE_DEBOUNCE_MS);
}

// Perform the actual save operation (called after debounce delay)
async function performSave() {
    const saveStartTime = performance.now();
    
    console.debug('[SAVE] performSave() executing', {
        timestamp: new Date().toISOString(),
        currentGroup,
        currentDay,
        currentScheduleMode
    });
    
    // Set save in progress flag
    isSaveInProgress = true;
    
    // Check if we're editing a group schedule
    if (currentGroup) {
        const nodes = graph.getNodes();
        console.debug('[SAVE] Group mode detected', {
            groupName: currentGroup,
            nodeCount: nodes.length,
            day: currentDay,
            scheduleMode: currentScheduleMode
        });
        
        try {
            const enabled = getDocumentRoot().querySelector('#schedule-enabled').checked;
            
            // Check if we're editing a non-active profile
            const groupData = allGroups[currentGroup];
            const activeProfile = groupData ? groupData.active_profile : null;
            const needsProfileSwitch = editingProfile && editingProfile !== activeProfile;
            
            // Temporarily switch to editing profile if needed
            if (needsProfileSwitch) {
                console.debug('[SAVE] Switching profile', { from: activeProfile, to: editingProfile });
                await haAPI.setActiveProfile(currentGroup, editingProfile);
            }
            
            // Save to group schedule with day and mode
            const setGroupScheduleStart = performance.now();
            console.debug('[SAVE] Calling setGroupSchedule', {
                groupName: currentGroup,
                nodeCount: nodes.length,
                day: currentDay,
                scheduleMode: currentScheduleMode,
                timeSinceSaveStart: (setGroupScheduleStart - saveStartTime).toFixed(2) + 'ms'
            });
            await haAPI.setGroupSchedule(currentGroup, nodes, currentDay, currentScheduleMode);
            console.debug('[SAVE] setGroupSchedule succeeded', {
                duration: (performance.now() - setGroupScheduleStart).toFixed(2) + 'ms'
            });
            
            // Update local cache immediately with the saved data
            if (allGroups[currentGroup]) {
                if (!allGroups[currentGroup].schedules) {
                    allGroups[currentGroup].schedules = {};
                }
                allGroups[currentGroup].schedules[currentDay] = JSON.parse(JSON.stringify(nodes));
            }
            
            // Switch back to original active profile if we changed it
            if (needsProfileSwitch && activeProfile) {
                console.debug('[SAVE] Switching profile back', { to: activeProfile });
                await haAPI.setActiveProfile(currentGroup, activeProfile);
            }
            
            // Update enabled state
            if (enabled) {
                console.debug('[SAVE] Calling enableGroup');
                await haAPI.enableGroup(currentGroup);
            } else {
                console.debug('[SAVE] Calling disableGroup');
                await haAPI.disableGroup(currentGroup);
            }
            
            // Update local state
            if (allGroups[currentGroup]) {
                allGroups[currentGroup].enabled = enabled;
            }
            
            console.debug('[SAVE] Group save completed successfully', {
                totalDuration: (performance.now() - saveStartTime).toFixed(2) + 'ms'
            });
        } catch (error) {
            console.error('[SAVE] Failed to auto-save group schedule:', {
                error,
                errorCode: error?.code,
                errorMessage: error?.message,
                translationKey: error?.translation_key,
                groupName: currentGroup,
                timeSinceSaveStart: (performance.now() - saveStartTime).toFixed(2) + 'ms'
            });
        } finally {
            isSaveInProgress = false;
            console.debug('[SAVE] isSaveInProgress flag cleared');
            
            // If another save was requested while this one was in progress, trigger it now
            if (pendingSaveNeeded) {
                console.debug('[SAVE] Pending save detected, triggering debounced save');
                pendingSaveNeeded = false;
                // Call saveSchedule (not performSave) to go through debouncing again
                saveSchedule();
            }
        }
        return;
    }
    
    // Note: Entity-only save path removed - all schedules (including single entities)
    // are now saved as groups via set_group_schedule above.
    console.debug('[SAVE] No currentGroup set, nothing to save');
    isSaveInProgress = false;
}

// Handle graph changes - auto-save and sync if needed
async function handleGraphChange(event, force = false) {
    // Handle graph change
    console.log('[GRAPH] handleGraphChange triggered', {
        timestamp: new Date().toISOString(),
        eventType: event?.type,
        force,
        currentGroup
    });
    
    // If event has detail.force, use that
    if (event && event.detail && event.detail.force !== undefined) {
        force = event.detail.force;
    }
    
    updateScheduledTemp();
    const savePromise = saveSchedule();
    await savePromise;
    return savePromise;
    
    // Check if we need to update thermostats immediately
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const nodes = graph.getNodes();
    
    // Find active node
    const sorted = [...nodes].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    const currentMinutes = timeToMinutes(currentTime);
    
    let activeNode = null;
    for (const node of sorted) {
        if (timeToMinutes(node.time) <= currentMinutes) {
            activeNode = node;
        } else {
            break;
        }
    }
    if (!activeNode && sorted.length > 0) {
        activeNode = sorted[sorted.length - 1];
    }
    
    if (!activeNode) return;
    
    const scheduledTemp = activeNode.temp;
    
    // Handle group schedule updates
    if (currentGroup) {
        updateAllGroupMemberScheduledTemps();
        
        // Update all thermostats in the group
        const groupData = allGroups[currentGroup];
        if (groupData && groupData.entities) {
            for (const entityId of groupData.entities) {
                const entity = climateEntities.find(e => e.entity_id === entityId);
                if (!entity) continue;
                
                const currentTarget = entity.attributes.temperature;
                
                // If scheduled temp is different from current target, update immediately
                if (Math.abs(scheduledTemp - currentTarget) > 0.1) {
                    try {
                        await haAPI.callService('climate', 'set_temperature', {
                            entity_id: entityId,
                            temperature: scheduledTemp
                        });
                        // Temperature updated
                    } catch (error) {
                        console.error(`Failed to update ${entityId}:`, error);
                    }
                }
                
                // Apply HVAC mode if specified and entity supports it
                if (activeNode.hvac_mode && entity.attributes.hvac_modes && 
                    entity.attributes.hvac_modes.includes(activeNode.hvac_mode)) {
                    const currentHvacMode = entity.state || entity.attributes.hvac_mode;
                    if (force || currentHvacMode !== activeNode.hvac_mode) {
                        // HVAC mode updated
                        try {
                            await haAPI.callService('climate', 'set_hvac_mode', {
                                entity_id: entityId,
                                hvac_mode: activeNode.hvac_mode
                            });
                        } catch (error) {
                            console.error(`Failed to set HVAC mode for ${entityId}:`, error);
                        }
                    }
                }
                
                // Apply fan mode if specified and entity supports it
                if (activeNode.fan_mode && entity.attributes.fan_modes && 
                    entity.attributes.fan_modes.includes(activeNode.fan_mode)) {
                    if (force || entity.attributes.fan_mode !== activeNode.fan_mode) {
                        // Fan mode updated
                        try {
                            await haAPI.callService('climate', 'set_fan_mode', {
                                entity_id: entityId,
                                fan_mode: activeNode.fan_mode
                            });
                        } catch (error) {
                            console.error(`Failed to set fan mode for ${entityId}:`, error);
                        }
                    }
                }
                
                // Apply swing mode if specified and entity supports it
                if (activeNode.swing_mode && entity.attributes.swing_modes && 
                    entity.attributes.swing_modes.includes(activeNode.swing_mode)) {
                    if (force || entity.attributes.swing_mode !== activeNode.swing_mode) {
                        // Swing mode updated
                        try {
                            await haAPI.callService('climate', 'set_swing_mode', {
                                entity_id: entityId,
                                swing_mode: activeNode.swing_mode
                            });
                        } catch (error) {
                            console.error(`Failed to set swing mode for ${entityId}:`, error);
                        }
                    }
                }
                
                // Apply preset mode if specified and entity supports it
                if (activeNode.preset_mode && entity.attributes.preset_modes && 
                    entity.attributes.preset_modes.includes(activeNode.preset_mode)) {
                    if (force || entity.attributes.preset_mode !== activeNode.preset_mode) {
                        // Preset mode updated
                        try {
                            await haAPI.callService('climate', 'set_preset_mode', {
                                entity_id: entityId,
                                preset_mode: activeNode.preset_mode
                            });
                        } catch (error) {
                            console.error(`Failed to set preset mode for ${entityId}:`, error);
                        }
                    }
                }
            }
        }
        return;
    }
    
    // Handle individual entity schedule updates
    // Get current entity
    const entity = climateEntities.find(e => e.entity_id === currentEntityId);
    if (!entity) return;
    
    const currentTarget = entity.attributes.temperature;
    
    // If scheduled temp is different from current target, update immediately
    if (Math.abs(scheduledTemp - currentTarget) > 0.1) {
        try {
            await haAPI.callService('climate', 'set_temperature', {
                entity_id: currentEntityId,
                temperature: scheduledTemp
            });
        } catch (error) {
            console.error('Failed to update thermostat:', error);
        }
    }
    
    // Apply HVAC mode if specified
    if (activeNode.hvac_mode) {
        const currentHvacMode = entity.state || entity.attributes.hvac_mode;
        if (force || currentHvacMode !== activeNode.hvac_mode) {
            try {
                await haAPI.callService('climate', 'set_hvac_mode', {
                    entity_id: currentEntityId,
                    hvac_mode: activeNode.hvac_mode
                });
            } catch (error) {
                console.error('Failed to set HVAC mode:', error);
            }
        }
    }
    
    // Apply fan mode if specified
    if (activeNode.fan_mode && (force || entity.attributes.fan_mode !== activeNode.fan_mode)) {
        try {
            await haAPI.callService('climate', 'set_fan_mode', {
                entity_id: currentEntityId,
                fan_mode: activeNode.fan_mode
            });
        } catch (error) {
            console.error('Failed to set fan mode:', error);
        }
    }
    
    // Apply swing mode if specified
    if (activeNode.swing_mode && (force || entity.attributes.swing_mode !== activeNode.swing_mode)) {
        try {
            await haAPI.callService('climate', 'set_swing_mode', {
                entity_id: currentEntityId,
                swing_mode: activeNode.swing_mode
            });
        } catch (error) {
            console.error('Failed to set swing mode:', error);
        }
    }
    
    // Apply preset mode if specified
    if (activeNode.preset_mode && (force || entity.attributes.preset_mode !== activeNode.preset_mode)) {
        try {
            await haAPI.callService('climate', 'set_preset_mode', {
                entity_id: currentEntityId,
                preset_mode: activeNode.preset_mode
            });
        } catch (error) {
            console.error('Failed to set preset mode:', error);
        }
    }
}

// Update scheduled temperature display
function updateScheduledTemp() {
    const scheduledTempEl = getDocumentRoot().querySelector('#scheduled-temp');
    
    // Element may not exist if entity card is collapsed
    if (!scheduledTempEl) return;
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const nodes = graph.getNodes();
    
    if (nodes.length > 0) {
        const temp = interpolateTemperature(nodes, currentTime);
        scheduledTempEl.textContent = (Number.isFinite(temp)) ? `${temp.toFixed(1)}${temperatureUnit}` : 'No Change';
    } else {
        scheduledTempEl.textContent = '--';
    }
}

// Time and temperature interpolation functions are now in utils.js

// Update entity status display
function updateEntityStatus(entity) {
    if (!entity) return;
    
    const currentTempEl = getDocumentRoot().querySelector('#current-temp');
    const targetTempEl = getDocumentRoot().querySelector('#target-temp');
    
    // Elements may not exist if entity card is collapsed
    if (!currentTempEl || !targetTempEl) return;
    
    const currentTemp = entity.attributes.current_temperature;
    const targetTemp = entity.attributes.temperature;
    
    currentTempEl.textContent = (Number.isFinite(currentTemp)) ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    targetTempEl.textContent = (Number.isFinite(targetTemp)) ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
    
    // Update HVAC mode if available
    const hvacModeEl = getDocumentRoot().querySelector('#current-hvac-mode');
    const hvacModeItem = getDocumentRoot().querySelector('#current-hvac-mode-item');
    if (hvacModeEl && hvacModeItem) {
        // HVAC mode is in entity.state for climate entities, not attributes
        const hvacMode = entity.state || entity.attributes.hvac_mode;
        if (hvacMode && hvacMode !== 'unknown' && hvacMode !== 'unavailable') {
            hvacModeEl.textContent = hvacMode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            hvacModeItem.style.display = '';
        } else {
            hvacModeItem.style.display = 'none';
        }
    }
    
    // Update fan mode if available
    const fanModeEl = getDocumentRoot().querySelector('#current-fan-mode');
    const fanModeItem = getDocumentRoot().querySelector('#current-fan-mode-item');
    if (fanModeEl && fanModeItem) {
        if (entity.attributes.fan_mode) {
            fanModeEl.textContent = entity.attributes.fan_mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            fanModeItem.style.display = '';
        } else {
            fanModeItem.style.display = 'none';
        }
    }
    
    // Update swing mode if available
    const swingModeEl = getDocumentRoot().querySelector('#current-swing-mode');
    const swingModeItem = getDocumentRoot().querySelector('#current-swing-mode-item');
    if (swingModeEl && swingModeItem) {
        if (entity.attributes.swing_mode) {
            swingModeEl.textContent = entity.attributes.swing_mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            swingModeItem.style.display = '';
        } else {
            swingModeItem.style.display = 'none';
        }
    }
    
    // Update preset mode if available
    const presetModeEl = getDocumentRoot().querySelector('#current-preset-mode');
    const presetModeItem = getDocumentRoot().querySelector('#current-preset-mode-item');
    if (presetModeEl && presetModeItem) {
        if (entity.attributes.preset_mode) {
            presetModeEl.textContent = entity.attributes.preset_mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            presetModeItem.style.display = '';
        } else {
            presetModeItem.style.display = 'none';
        }
    }
}

// Handle state updates from Home Assistant
function handleStateUpdate(data) {
    const entityId = data.entity_id;
    const newState = data.new_state;
    
    if (!entityId || !newState || !entityId.startsWith('climate.')) return;
    
    // Update entity in list
    const entityIndex = climateEntities.findIndex(e => e.entity_id === entityId);
    if (entityIndex !== -1) {
        climateEntities[entityIndex] = newState;
        // Don't re-render entire list, just update the card if visible
        updateEntityCard(entityId, newState);
    }
    
    // Update current entity status if selected
    if (entityId === currentEntityId) {
        updateEntityStatus(newState);
    }
    
    // Update group members table if showing group and entity is in the group
    if (currentGroup) {
        const groupData = allGroups[currentGroup];
        if (groupData && groupData.entities && groupData.entities.includes(entityId)) {
            updateGroupMemberRow(entityId, newState);
        }
    }
}

// Handle log entries from backend
// Update a single entity card without re-rendering the entire list
function updateEntityCard(entityId, entityState) {
    // Find the card in either the active or ignored entities list
    const card = getDocumentRoot().querySelector(`.entity-card[data-entity-id="${entityId}"]`);
    if (!card) return;
    
    // Update current temperature
    const currentTempEl = card.querySelector('.current-temp');
    if (currentTempEl) {
        const ct = entityState.attributes.current_temperature;
        currentTempEl.textContent = Number.isFinite(ct) ? `${ct.toFixed(1)}${temperatureUnit}` : '--';
    }

    // Update target temperature
    const targetTempEl = card.querySelector('.target-temp');
    if (targetTempEl) {
        const tt = entityState.attributes.temperature;
        targetTempEl.textContent = Number.isFinite(tt) ? `${tt.toFixed(1)}${temperatureUnit}` : '--';
    }
}

// Update a single row in the group members table
function updateGroupMemberRow(entityId, entityState) {
    const row = getDocumentRoot().querySelector(`.group-members-row[data-entity-id="${entityId}"]`);
    if (!row) return;
    
    const currentCell = row.children[1];
    const targetCell = row.children[2];
    const scheduledCell = row.children[3];
    
    if (currentCell) {
        const currentTemp = entityState.attributes?.current_temperature;
        currentCell.textContent = (Number.isFinite(currentTemp)) ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    }

    if (targetCell) {
        const targetTemp = entityState.attributes?.temperature;
        targetCell.textContent = (Number.isFinite(targetTemp)) ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
    }
    
    // Update scheduled temp if we're viewing a group
    if (scheduledCell && currentGroup && graph) {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const nodes = graph.getNodes();
        
        if (nodes.length > 0) {
            const scheduledTemp = interpolateTemperature(nodes, currentTime);
            scheduledCell.textContent = (Number.isFinite(scheduledTemp)) ? `${scheduledTemp.toFixed(1)}${temperatureUnit}` : 'No Change';
        } else {
            scheduledCell.textContent = '--';
        }
    }
}

// Update all rows in the group members table with current scheduled temperature
function updateAllGroupMemberScheduledTemps() {
    if (!currentGroup || !graph) return;
    
    const rows = getDocumentRoot().querySelectorAll('.group-members-row');
    if (rows.length === 0) return;
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const nodes = graph.getNodes();
    
    rows.forEach(row => {
        const scheduledCell = row.children[3];
        if (scheduledCell) {
            if (nodes.length > 0) {
                const scheduledTemp = interpolateTemperature(nodes, currentTime);
                scheduledCell.textContent = (Number.isFinite(scheduledTemp)) ? `${scheduledTemp.toFixed(1)}${temperatureUnit}` : 'No Change';
            } else {
                scheduledCell.textContent = '--';
            }
        }
    });
}

// Toggle entity inclusion in scheduler
async function toggleEntityInclusion(entityId, include) {
    try {
        if (include) {
            // Check if entity already has a schedule in backend
            let existingSchedule = null;
            try {
                const result = await haAPI.getSchedule(entityId);
                const schedule = result?.response || result;
                if (schedule && schedule.nodes && schedule.nodes.length > 0) {
                    existingSchedule = schedule.nodes;
                }
            } catch (err) {
            }
            
            // Use existing schedule or create default
            const scheduleToUse = existingSchedule || [];
            
            // Add to local state immediately with a unique copy for each entity
            entitySchedules.set(entityId, JSON.parse(JSON.stringify(scheduleToUse)));
            
            // If no existing schedule, persist the default to HA with current day
            if (!existingSchedule) {
                const now = new Date();
                const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
                haAPI.setSchedule(entityId, scheduleToUse, 'all_days', 'all_days').catch(err => {
                    console.error('Failed to persist schedule to HA:', err);
                });
            }
            
            // Always enable the schedule (whether it existed or not)
            haAPI.enableSchedule(entityId).catch(err => {
                console.error('Failed to enable schedule in HA:', err);
            });
            
            // Re-render to move to active list
            await renderEntityList();
        } else {
            // When disabling, just disable it but keep the schedule data
            entitySchedules.delete(entityId);
            
            // Disable the schedule in HA (but don't clear the data)
            haAPI.disableSchedule(entityId).catch(err => {
                console.error('Failed to disable schedule in HA:', err);
            });
            
            // If it was selected, deselect it
            if (currentEntityId === entityId) {
                currentEntityId = null;
                const editorEl = getDocumentRoot().querySelector('#schedule-editor');
                if (editorEl) {
                    editorEl.style.display = 'none';
                }
            }
            
            // Re-render to move to disabled list
            await renderEntityList();
        }
    } catch (error) {
        console.error('Failed to toggle entity inclusion:', error);
    }
}

// Set up event listeners
function setupEventListeners() {
    // Schedule mode radio buttons
    const modeRadios = getDocumentRoot().querySelectorAll('input[name="schedule-mode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                const newMode = e.target.value;
                await switchScheduleMode(newMode);
            }
        });
    });
    
    // Day selector buttons (for individual mode)
    const dayButtons = getDocumentRoot().querySelectorAll('.day-btn');
    dayButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const day = btn.dataset.day;
            await switchDay(day);
        });
    });
    
    // Weekday selector buttons (for 5/2 mode)
    const weekdayButtons = getDocumentRoot().querySelectorAll('.weekday-btn');
    weekdayButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const day = btn.dataset.day;
            await switchDay(day);
        });
    });
    
    // Menu button and dropdown
    const menuButton = getDocumentRoot().querySelector('#menu-button');
    const dropdownMenu = getDocumentRoot().querySelector('#dropdown-menu');
    
    if (menuButton && dropdownMenu) {
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none';
        });
    
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!menuButton.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.style.display = 'none';
            }
        });
    }
    
    // Menu items
    const refreshEntitiesMenu = getDocumentRoot().querySelector('#refresh-entities-menu');
    if (refreshEntitiesMenu) {
        refreshEntitiesMenu.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.style.display = 'none';
            loadClimateEntities();
        });
    }
    
    const syncAllMenu = getDocumentRoot().querySelector('#sync-all-menu');
    if (syncAllMenu) {
        syncAllMenu.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.style.display = 'none';
            syncAllTemperatures();
        });
    }
    
    const reloadIntegrationMenu = getDocumentRoot().querySelector('#reload-integration-menu');
    if (reloadIntegrationMenu) {
        reloadIntegrationMenu.addEventListener('click', async () => {
            if (dropdownMenu) dropdownMenu.style.display = 'none';
            try {
                await haAPI.callService('climate_scheduler', 'reload_integration', {});
                showToast('Integration reloaded successfully', 'success');
            } catch (error) {
                console.error('Failed to reload integration:', error);
                showToast('Failed to reload integration: ' + error.message, 'error');
            }
        });
    }
    
    // Toggle ignored entities section
    const toggleIgnored = getDocumentRoot().querySelector('#toggle-ignored');
    const ignoredList = getDocumentRoot().querySelector('#ignored-entity-list');
    if (toggleIgnored && ignoredList) {
        toggleIgnored.addEventListener('click', () => {
            const toggleIcon = toggleIgnored.querySelector('.toggle-icon');
            
            if (ignoredList.style.display === 'none') {
                ignoredList.style.display = 'flex';
                if (toggleIcon) toggleIcon.textContent = '▼';
            } else {
                ignoredList.style.display = 'none';
                if (toggleIcon) toggleIcon.textContent = '▶';
            }
        });
    }
    
    // Filter ignored entities
    const ignoredFilter = getDocumentRoot().querySelector('#ignored-filter');
    if (ignoredFilter) {
        ignoredFilter.addEventListener('input', () => {
            renderEntityList();
        });
    }
    
    // NOTE: The following elements are now dynamically created in inline editors
    // and have their event listeners attached in attachEditorEventListeners():
    // - #clear-schedule-btn
    // - #schedule-enabled
    // - #close-settings
    // - #delete-node
    // - #save-node-settings
    
    // Group management event listeners
    
    // Create group button
    const createGroupBtn = getDocumentRoot().querySelector('#create-group-btn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            const modal = getDocumentRoot().querySelector('#create-group-modal');
            if (modal) {
                modal.style.display = 'flex';
            }
            const nameInput = getDocumentRoot().querySelector('#new-group-name');
            if (nameInput) {
                nameInput.value = '';
            }
        });
    }
    
    // Create group modal - cancel
    const createGroupCancel = getDocumentRoot().querySelector('#create-group-cancel');
    if (createGroupCancel) {
        createGroupCancel.addEventListener('click', () => {
            const modal = getDocumentRoot().querySelector('#create-group-modal');
            if (modal) modal.style.display = 'none';
        });
    }
    
    // Create group modal - confirm
    const createGroupConfirm = getDocumentRoot().querySelector('#create-group-confirm');
    if (createGroupConfirm) {
        createGroupConfirm.addEventListener('click', async () => {
            const groupName = getDocumentRoot().querySelector('#new-group-name').value.trim();
            if (!groupName) {
                alert('Please enter a group name');
                return;
            }
            
            if (allGroups[groupName]) {
                alert('A group with this name already exists');
                return;
            }
            
            try {
                await haAPI.createGroup(groupName);
                
                // Close modal
                const modal = getDocumentRoot().querySelector('#create-group-modal');
                if (modal) modal.style.display = 'none';
                
                // Reload groups
                await loadGroups();
            } catch (error) {
                console.error('Failed to create group:', error);
                alert('Failed to create group');
            }
        });
    }
    
    // Add to group modal - cancel
    const addToGroupCancel = getDocumentRoot().querySelector('#add-to-group-cancel');
    if (addToGroupCancel) {
        addToGroupCancel.addEventListener('click', () => {
            const modal = getDocumentRoot().querySelector('#add-to-group-modal');
            if (modal) {
                modal.style.display = 'none';
                delete modal.dataset.currentGroup;
                delete modal.dataset.isMove;
            }
        });
    }
    
    // Add to group modal - confirm
    const addToGroupConfirm = getDocumentRoot().querySelector('#add-to-group-confirm');
    if (addToGroupConfirm) {
        addToGroupConfirm.addEventListener('click', async () => {
            const modal = getDocumentRoot().querySelector('#add-to-group-modal');
            const entityId = modal ? modal.dataset.entityId : null;
            const currentGroupName = modal ? modal.dataset.currentGroup : null;
            const isMove = modal ? modal.dataset.isMove === 'true' : false;
            const isUnmonitoredAdd = modal ? modal.dataset.isUnmonitoredAdd === 'true' : false;
            const selectElement = getDocumentRoot().querySelector('#add-to-group-select');
            const newGroupInput = getDocumentRoot().querySelector('#new-group-name-inline');
            
            let groupName = selectElement ? selectElement.value : null;
            const newGroupName = newGroupInput ? newGroupInput.value.trim() : '';
            
            // Check if user wants to create a new group
            if (newGroupName) {
                if (allGroups[newGroupName]) {
                    alert('A group with this name already exists. Please select it from the dropdown or use a different name.');
                    return;
                }
                groupName = newGroupName;
                
                try {
                    // Create the new group first
                    await haAPI.createGroup(groupName);
                } catch (error) {
                    console.error('Failed to create group:', error);
                    alert('Failed to create group');
                    return;
                }
            }
            
            if (!groupName) {
                alert('Please select or create a group');
                return;
            }
            
            try {
                // If moving, remove from current group first
                if (isMove && currentGroupName) {
                    await haAPI.removeFromGroup(currentGroupName, entityId);
                }
                
                // Add to new group
                // Note: This works for both monitored and unmonitored entities
                // - For unmonitored entities, it adds them directly to the group
                // - For monitored entities in other groups, it moves them
                await haAPI.addToGroup(groupName, entityId);
                
                // Close modal and clear move state
                if (modal) {
                    modal.style.display = 'none';
                    delete modal.dataset.currentGroup;
                    delete modal.dataset.isMove;
                    delete modal.dataset.isUnmonitoredAdd;
                }
                
                // Close any open editors to prevent stale data
                collapseAllEditors();
                
                // Reload groups
                await loadGroups();
                
                // Reload entity list (entity should disappear from active/disabled)
                await renderEntityList();
                
                // Show appropriate message
                if (isMove && currentGroupName) {
                    showToast(`Moved entity from ${currentGroupName} to ${groupName}`, 'success');
                } else if (isUnmonitoredAdd) {
                    showToast(`Added entity to ${groupName}`, 'success');
                } else {
                    showToast(`Added entity to ${groupName}`, 'success');
                }
            } catch (error) {
                console.error('Failed to add entity to group:', error);
                alert('Failed to add entity to group');
            }
        });
    }
    
    // Close modals when clicking outside
    const createGroupModal = getDocumentRoot().querySelector('#create-group-modal');
    if (createGroupModal) {
        createGroupModal.addEventListener('click', (e) => {
            if (e.target.id === 'create-group-modal') {
                createGroupModal.style.display = 'none';
            }
        });
    }
    
    const addToGroupModal = getDocumentRoot().querySelector('#add-to-group-modal');
    if (addToGroupModal) {
        addToGroupModal.addEventListener('click', (e) => {
            if (e.target.id === 'add-to-group-modal') {
                addToGroupModal.style.display = 'none';
            }
        });
    }

    // Convert temperature button
    const convertTempBtn = getDocumentRoot().querySelector('#convert-temperature-btn');
    if (convertTempBtn) {
        convertTempBtn.addEventListener('click', () => {
            const modal = getDocumentRoot().querySelector('#convert-temperature-modal');
            if (modal) {
                // Determine the likely current unit from stored settings
                const likelyCurrentUnit = storedTemperatureUnit || temperatureUnit || '°C';
                
                // Pre-select FROM unit (current)
                const fromCelsiusRadio = getDocumentRoot().querySelector('#convert-from-celsius');
                const fromFahrenheitRadio = getDocumentRoot().querySelector('#convert-from-fahrenheit');
                
                if (likelyCurrentUnit === '°C' && fromCelsiusRadio) {
                    fromCelsiusRadio.checked = true;
                } else if (likelyCurrentUnit === '°F' && fromFahrenheitRadio) {
                    fromFahrenheitRadio.checked = true;
                } else if (fromCelsiusRadio) {
                    fromCelsiusRadio.checked = true;
                }
                
                // Pre-select TO unit (opposite of current)
                const toCelsiusRadio = getDocumentRoot().querySelector('#convert-to-celsius');
                const toFahrenheitRadio = getDocumentRoot().querySelector('#convert-to-fahrenheit');
                
                if (likelyCurrentUnit === '°C' && toFahrenheitRadio) {
                    toFahrenheitRadio.checked = true;
                } else if (likelyCurrentUnit === '°F' && toCelsiusRadio) {
                    toCelsiusRadio.checked = true;
                } else if (toCelsiusRadio) {
                    toCelsiusRadio.checked = true;
                }
                
                modal.style.display = 'flex';
            }
        });
    }

    // Convert temperature modal - cancel
    const convertTempCancel = getDocumentRoot().querySelector('#convert-temperature-cancel');
    if (convertTempCancel) {
        convertTempCancel.addEventListener('click', () => {
            const modal = getDocumentRoot().querySelector('#convert-temperature-modal');
            if (modal) modal.style.display = 'none';
        });
    }

    // Convert temperature modal - confirm
    const convertTempConfirm = getDocumentRoot().querySelector('#convert-temperature-confirm');
    if (convertTempConfirm) {
        convertTempConfirm.addEventListener('click', async () => {
            const modal = getDocumentRoot().querySelector('#convert-temperature-modal');
            
            // Get FROM unit
            const fromCelsiusRadio = getDocumentRoot().querySelector('#convert-from-celsius');
            const fromFahrenheitRadio = getDocumentRoot().querySelector('#convert-from-fahrenheit');
            
            let fromUnit = null;
            if (fromCelsiusRadio && fromCelsiusRadio.checked) {
                fromUnit = '°C';
            } else if (fromFahrenheitRadio && fromFahrenheitRadio.checked) {
                fromUnit = '°F';
            }
            
            // Get TO unit
            const toCelsiusRadio = getDocumentRoot().querySelector('#convert-to-celsius');
            const toFahrenheitRadio = getDocumentRoot().querySelector('#convert-to-fahrenheit');
            
            let targetUnit = null;
            if (toCelsiusRadio && toCelsiusRadio.checked) {
                targetUnit = '°C';
            } else if (toFahrenheitRadio && toFahrenheitRadio.checked) {
                targetUnit = '°F';
            }
            
            if (!fromUnit) {
                showToast('Please select the current temperature unit (FROM)', 'warning');
                return;
            }
            
            if (!targetUnit) {
                showToast('Please select the target temperature unit (TO)', 'warning');
                return;
            }
            
            if (fromUnit === targetUnit) {
                showToast(`Cannot convert from ${fromUnit} to ${targetUnit} - they are the same unit`, 'warning');
                return;
            }
            
            try {
                // Show loading indicator
                if (convertTempConfirm) {
                    convertTempConfirm.disabled = true;
                    convertTempConfirm.textContent = 'Converting...';
                }
                
                // Get current settings
                const settings = await haAPI.getSettings();
                
                // Convert all schedules using user-selected units
                await convertAllSchedules(fromUnit, targetUnit);
                
                // Convert min/max settings
                if (settings.min_temp !== undefined) {
                    settings.min_temp = convertTemperature(settings.min_temp, fromUnit, targetUnit);
                }
                if (settings.max_temp !== undefined) {
                    settings.max_temp = convertTemperature(settings.max_temp, fromUnit, targetUnit);
                }
                
                // Convert default schedule
                if (settings.defaultSchedule) {
                    settings.defaultSchedule = convertScheduleNodes(settings.defaultSchedule, fromUnit, targetUnit);
                }
                
                // Update temperature unit
                settings.temperature_unit = targetUnit;
                temperatureUnit = targetUnit;
                storedTemperatureUnit = targetUnit;
                
                // Save settings
                await haAPI.saveSettings(settings);
                
                // Close modal before reload
                if (modal) modal.style.display = 'none';
                
                // Show success toast briefly before reload
                showToast(`Successfully converted all schedules to ${targetUnit}. Reloading...`, 'success', 2000);
                
                // Reload the page after a brief delay to show the toast
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } catch (error) {
                console.error('Failed to convert schedules:', error);
                showToast('Failed to convert schedules: ' + error.message, 'error');
            } finally {
                // Restore button state
                if (convertTempConfirm) {
                    convertTempConfirm.disabled = false;
                    convertTempConfirm.textContent = 'Convert Schedules';
                }
            }
        });
    }

    // Close convert temperature modal when clicking outside
    const convertTempModal = getDocumentRoot().querySelector('#convert-temperature-modal');
    if (convertTempModal) {
        convertTempModal.addEventListener('click', (e) => {
            if (e.target.id === 'convert-temperature-modal') {
                convertTempModal.style.display = 'none';
            }
        });
    }
    
    // Initialize settings panel
    setupSettingsPanel();
}

// Handle node settings panel
function handleNodeSettings(event) {
    const { nodeIndex, node } = event.detail;
    
    let entity;
    let allHvacModes = [];
    let allFanModes = [];
    let allSwingModes = [];
    let allPresetModes = [];
    
    // Check if we're editing a group or individual entity
    if (currentGroup) {
        // For groups, aggregate capabilities from all entities in the group
        const groupData = allGroups[currentGroup];
        if (!groupData) return;
        
        const groupEntities = (groupData.entities || [])
            .map(id => climateEntities.find(e => e.entity_id === id))
            .filter(e => e);
        
        // For virtual groups (no entities), use empty mode arrays
        if (groupEntities.length === 0) {
            // Virtual schedule - no modes available
            allHvacModes = [];
            allFanModes = [];
            allSwingModes = [];
            allPresetModes = [];
        } else {
            // Use first entity for basic attributes
            entity = groupEntities[0];
            
            // Aggregate all unique modes from all entities
            const hvacModesSet = new Set();
            const fanModesSet = new Set();
            const swingModesSet = new Set();
            const presetModesSet = new Set();
            
            groupEntities.forEach(e => {
                if (e.attributes.hvac_modes) {
                    e.attributes.hvac_modes.forEach(mode => hvacModesSet.add(mode));
                }
                if (e.attributes.fan_modes) {
                    e.attributes.fan_modes.forEach(mode => fanModesSet.add(mode));
                }
                if (e.attributes.swing_modes) {
                    e.attributes.swing_modes.forEach(mode => swingModesSet.add(mode));
                }
                if (e.attributes.preset_modes) {
                    e.attributes.preset_modes.forEach(mode => presetModesSet.add(mode));
                }
            });
            
            allHvacModes = Array.from(hvacModesSet);
            allFanModes = Array.from(fanModesSet);
            allSwingModes = Array.from(swingModesSet);
            allPresetModes = Array.from(presetModesSet);
        }
    } else {
        // For individual entities
        entity = climateEntities.find(e => e.entity_id === currentEntityId);
        if (!entity) return;
        
        allHvacModes = entity.attributes.hvac_modes || [];
        allFanModes = entity.attributes.fan_modes || [];
        allSwingModes = entity.attributes.swing_modes || [];
        allPresetModes = entity.attributes.preset_modes || [];
    }
    
    // Update panel content
    const timeInput = getDocumentRoot().querySelector('#node-time-input');
    const tempInput = getDocumentRoot().querySelector('#node-temp-input');
    const tempNoChange = getDocumentRoot().querySelector('#temp-no-change');
    const tempUpBtn = getDocumentRoot().querySelector('#temp-up');
    const tempDownBtn = getDocumentRoot().querySelector('#temp-down');
    
    if (timeInput) timeInput.value = node.time;
    
    // Handle temperature and no-change checkbox
    const isNoChange = node.noChange === true;
    if (tempNoChange) tempNoChange.checked = isNoChange;
    if (tempInput) {
        tempInput.value = (node.temp !== null && node.temp !== undefined) ? node.temp : '';
        tempInput.disabled = isNoChange;
        tempInput.step = inputTempStep.toString(); // Set step dynamically
    }
    if (tempUpBtn) {
        tempUpBtn.disabled = isNoChange;
        tempUpBtn.title = `+${inputTempStep}°`;
    }
    if (tempDownBtn) {
        tempDownBtn.disabled = isNoChange;
        tempDownBtn.title = `-${inputTempStep}°`;
    }
    
    // Populate HVAC mode dropdown
    const hvacModeSelect = getDocumentRoot().querySelector('#node-hvac-mode');
    const hvacModeItem = hvacModeSelect.closest('.setting-item');
    hvacModeSelect.innerHTML = '';
    
    if (allHvacModes.length > 0) {
        hvacModeItem.style.display = '';
        hvacModeSelect.disabled = false;
        
        // Add "No Change" option
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '-- No Change --';
        if (!node.hvac_mode) noneOption.selected = true;
        hvacModeSelect.appendChild(noneOption);
        
        allHvacModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (node.hvac_mode === mode) option.selected = true;
            hvacModeSelect.appendChild(option);
        });
    } else {
        hvacModeItem.style.display = 'none';
    }
    
    // Populate fan mode dropdown if available
    const fanModeSelect = getDocumentRoot().querySelector('#node-fan-mode');
    const fanModeItem = fanModeSelect.closest('.setting-item');
    fanModeSelect.innerHTML = '';
    
    if (allFanModes.length > 0) {
        fanModeItem.style.display = '';
        fanModeSelect.disabled = false;
        
        // Add "No Change" option
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '-- No Change --';
        if (!node.fan_mode) noneOption.selected = true;
        fanModeSelect.appendChild(noneOption);
        
        allFanModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (node.fan_mode === mode) option.selected = true;
            fanModeSelect.appendChild(option);
        });
    } else {
        fanModeItem.style.display = 'none';
    }
    
    // Populate swing mode dropdown if available
    const swingModeSelect = getDocumentRoot().querySelector('#node-swing-mode');
    const swingModeItem = swingModeSelect.closest('.setting-item');
    swingModeSelect.innerHTML = '';
    
    if (allSwingModes.length > 0) {
        swingModeItem.style.display = '';
        swingModeSelect.disabled = false;
        
        // Add "No Change" option
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '-- No Change --';
        if (!node.swing_mode) noneOption.selected = true;
        swingModeSelect.appendChild(noneOption);
        
        allSwingModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (node.swing_mode === mode) option.selected = true;
            swingModeSelect.appendChild(option);
        });
    } else {
        swingModeItem.style.display = 'none';
    }
    
    // Populate preset mode dropdown if available
    const presetModeSelect = getDocumentRoot().querySelector('#node-preset-mode');
    const presetModeItem = presetModeSelect.closest('.setting-item');
    presetModeSelect.innerHTML = '';
    
    if (allPresetModes.length > 0) {
        presetModeItem.style.display = '';
        presetModeSelect.disabled = false;
        
        // Add "No Change" option
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '-- No Change --';
        if (!node.preset_mode) noneOption.selected = true;
        presetModeSelect.appendChild(noneOption);
        
        allPresetModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (node.preset_mode === mode) option.selected = true;
            presetModeSelect.appendChild(option);
        });
    } else {
        presetModeItem.style.display = 'none';
    }
    
    // Update value inputs
    const valueAInput = getDocumentRoot().querySelector('#node-value-A');
    const valueBInput = getDocumentRoot().querySelector('#node-value-B');
    const valueCInput = getDocumentRoot().querySelector('#node-value-C');
    
    if (valueAInput) valueAInput.value = (node['A'] !== null && node['A'] !== undefined) ? node['A'] : '';
    if (valueBInput) valueBInput.value = (node['B'] !== null && node['B'] !== undefined) ? node['B'] : '';
    if (valueCInput) valueCInput.value = (node['C'] !== null && node['C'] !== undefined) ? node['C'] : '';
    
    // Show panel
    const panel = getDocumentRoot().querySelector('#node-settings-panel');
    panel.style.display = 'block';
    panel.dataset.nodeIndex = nodeIndex;
    
    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Sync all thermostats to scheduled temperatures
async function syncAllTemperatures() {
    try {
        const button = getDocumentRoot().querySelector('#sync-all-menu');
        button.disabled = true;
        button.textContent = '⟲ Syncing...';
        
        await haAPI.callService('climate_scheduler', 'sync_all', {});
        
        button.textContent = '✓ Synced!';
        setTimeout(() => {
            button.textContent = '⟲ Sync All Thermostats';
            button.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Failed to sync temperatures:', error);
        alert('Failed to sync temperatures: ' + error.message);
        const button = getDocumentRoot().querySelector('#sync-all-menu');
        if (button) {
            button.textContent = '⟲ Sync All Thermostats';
            button.disabled = false;
        }
    }
}

// Update scheduled temp every minute
setInterval(() => {
    updateScheduledTemp();
    updateAllGroupMemberScheduledTemps();
}, 60000);

// ===== Settings Panel =====

// Default schedule settings
let defaultScheduleSettings = [];

let defaultScheduleGraph = null;
// Global min/max settings (populated from loadSettings)
let minTempSetting = null;
let maxTempSetting = null;

// Convert all schedules from one unit to another
async function convertAllSchedules(fromUnit, toUnit) {
    if (fromUnit === toUnit) return;
    
    try {
        // Convert entity schedules
        for (const entityId of entitySchedules.keys()) {
            const result = await haAPI.getSchedule(entityId);
            const schedule = result?.response || result;
            
            if (schedule && schedule.schedules) {
                const convertedSchedules = {};
                for (const [day, nodes] of Object.entries(schedule.schedules)) {
                    convertedSchedules[day] = convertScheduleNodes(nodes, fromUnit, toUnit);
                }
                
                // Save converted schedules
                for (const [day, nodes] of Object.entries(convertedSchedules)) {
                    await haAPI.setSchedule(entityId, nodes, day, schedule.schedule_mode || 'all_days');
                }
            }
        }
        
        // Convert group schedules
        const result = await haAPI.getGroups();
        let groups = result?.response || result || {};
        if (groups.groups && typeof groups.groups === 'object') {
            groups = groups.groups;
        }
        
        for (const [groupName, groupData] of Object.entries(groups)) {
            if (groupData.schedules) {
                const convertedSchedules = {};
                for (const [day, nodes] of Object.entries(groupData.schedules)) {
                    convertedSchedules[day] = convertScheduleNodes(nodes, fromUnit, toUnit);
                }
                
                // Save converted group schedules
                for (const [day, nodes] of Object.entries(convertedSchedules)) {
                    await haAPI.setGroupSchedule(groupName, nodes, day, groupData.schedule_mode || 'all_days');
                }
            }
        }
    } catch (error) {
        console.error('Failed to convert schedules:', error);
    }
}

// Check if Workday integration is available
async function checkWorkdayIntegration(settings) {
    const checkbox = getDocumentRoot().querySelector('#use-workday-integration');
    const helpText = getDocumentRoot().querySelector('#workday-help-text');
    const label = getDocumentRoot().querySelector('#use-workday-label');
    const workdaySelector = getDocumentRoot().querySelector('#workday-selector');
    
    if (!checkbox || !helpText) {
        console.warn('Workday UI elements not found');
        return;
    }
    
    try {
        // Wait for haAPI to be connected
        let hassObj = haAPI?.hass;
        
        // If hass not ready yet, wait a bit and retry
        if (!hassObj || !hassObj.states) {
            console.debug('[Climate Scheduler] Waiting for hass connection...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            hassObj = haAPI?.hass;
        }
        
        // Debug logging
        console.debug('[Climate Scheduler] Checking for Workday integration');
        console.debug('[Climate Scheduler] haAPI available:', !!haAPI);
        console.debug('[Climate Scheduler] hass object available:', !!hassObj);
        console.debug('[Climate Scheduler] hass.states available:', !!hassObj?.states);
        console.debug('[Climate Scheduler] binary_sensor.workday_sensor:', hassObj?.states?.['binary_sensor.workday_sensor']);
        
        // List all binary_sensor.workday* entities for debugging
        if (hassObj?.states) {
            const workdayEntities = Object.keys(hassObj.states).filter(id => id.startsWith('binary_sensor.workday'));
            console.debug('[Climate Scheduler] Found workday entities:', workdayEntities);
        }
        
        const hasWorkday = hassObj?.states?.['binary_sensor.workday_sensor'] !== undefined;
        
        if (hasWorkday) {
            // Workday is available - enable the checkbox
            checkbox.disabled = false;
            helpText.textContent = 'When enabled, uses the Workday integration for accurate 5/2 scheduling (respects holidays and custom workdays). When disabled, uses the selected workdays below.';
            if (label) label.style.cursor = 'pointer';
            
            // Load saved setting
            if (settings && typeof settings.use_workday_integration !== 'undefined') {
                checkbox.checked = settings.use_workday_integration;
            }
            
            // Show/hide workday selector based on checkbox state
            updateWorkdaySelectorVisibility(checkbox.checked);
        } else {
            // Workday not available - disable and show message
            checkbox.disabled = true;
            checkbox.checked = false;
            helpText.innerHTML = 'Workday integration not detected. Configure workdays manually below. <a href="https://www.home-assistant.io/integrations/workday/" target="_blank" style="color: var(--primary);">Install Workday integration</a>';
            if (label) {
                label.style.cursor = 'not-allowed';
                label.style.opacity = '0.6';
            }
            
            // Always show workday selector when Workday integration is not available
            if (workdaySelector) workdaySelector.style.display = 'block';
        }
        
        // Load workdays setting
        loadWorkdaysSetting(settings);
        
    } catch (error) {
        console.error('Failed to check Workday integration:', error);
        helpText.textContent = 'Could not determine if Workday integration is installed.';
    }
}

// Update visibility of workday selector based on use_workday_integration setting
function updateWorkdaySelectorVisibility(useWorkdayIntegration) {
    const workdaySelector = getDocumentRoot().querySelector('#workday-selector');
    if (workdaySelector) {
        // Show selector when NOT using Workday integration
        workdaySelector.style.display = useWorkdayIntegration ? 'none' : 'block';
    }
}

// Load workdays setting from settings
function loadWorkdaysSetting(settings) {
    const defaultWorkdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const workdays = settings?.workdays || defaultWorkdays;
    
    const checkboxes = getDocumentRoot().querySelectorAll('.workday-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = workdays.includes(checkbox.value);
    });
}

// Get selected workdays from checkboxes
function getSelectedWorkdays() {
    const checkboxes = getDocumentRoot().querySelectorAll('.workday-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// Load settings from server
async function loadSettings() {
    try {
        const settings = await haAPI.getSettings();
        
        // Check if temperature unit changed and convert schedules if needed
        const savedUnit = settings?.temperature_unit;
        
        // Always set storedTemperatureUnit to track what's in storage
        storedTemperatureUnit = savedUnit || temperatureUnit;
        
        if (savedUnit && savedUnit !== temperatureUnit) {
            await convertAllSchedules(savedUnit, temperatureUnit);
            // Update stored unit
            settings.temperature_unit = temperatureUnit;
            storedTemperatureUnit = temperatureUnit;
            await haAPI.saveSettings(settings);
        } else if (!savedUnit) {
            // First time - check if default schedule needs conversion from Celsius to Fahrenheit
            if (temperatureUnit === '°F' && settings.defaultSchedule) {
                // Check if default schedule looks like it's in Celsius (temps < 40)
                const maxTemp = Math.max(...settings.defaultSchedule.map(n => n.temp));
                if (maxTemp < 40) {
                    settings.defaultSchedule = convertScheduleNodes(settings.defaultSchedule, '°C', '°F');
                    // Also convert min/max if they look like Celsius
                    if (settings.min_temp && settings.min_temp < 40) {
                        settings.min_temp = convertTemperature(settings.min_temp, '°C', '°F');
                    }
                    if (settings.max_temp && settings.max_temp < 40) {
                        settings.max_temp = convertTemperature(settings.max_temp, '°C', '°F');
                    }
                }
            }
            // Save current unit for future detection
            settings.temperature_unit = temperatureUnit;
            storedTemperatureUnit = temperatureUnit;
            await haAPI.saveSettings(settings);
        }
        
        if (settings && settings.defaultSchedule) {
            // Convert default schedule if needed
            if (storedTemperatureUnit && storedTemperatureUnit !== temperatureUnit) {
                defaultScheduleSettings = convertScheduleNodes(settings.defaultSchedule, storedTemperatureUnit, temperatureUnit);
            } else {
                defaultScheduleSettings = settings.defaultSchedule;
            }
        }
        if (settings && settings.tooltipMode) {
            tooltipMode = settings.tooltipMode;
            const tooltipSelect = getDocumentRoot().querySelector('#tooltip-mode');
            if (tooltipSelect) {
                tooltipSelect.value = tooltipMode;
            }
        }
        // Load derivative sensor setting
        if (settings && typeof settings.create_derivative_sensors !== 'undefined') {
            const checkbox = getDocumentRoot().querySelector('#create-derivative-sensors');
            if (checkbox) {
                checkbox.checked = settings.create_derivative_sensors;
            }
        }
        
        // Check for Workday integration and load setting
        await checkWorkdayIntegration(settings);
        
        // Load min/max temps if present (convert if unit changed)
        if (settings && typeof settings.min_temp !== 'undefined') {
            let minTemp = parseFloat(settings.min_temp);
            if (storedTemperatureUnit && storedTemperatureUnit !== temperatureUnit) {
                minTemp = convertTemperature(minTemp, storedTemperatureUnit, temperatureUnit);
            }
            minTempSetting = minTemp;
            const minInput = getDocumentRoot().querySelector('#min-temp');
            if (minInput) {
                minInput.value = minTemp;
                console.debug('Loaded min_temp:', minTemp, 'Input found:', !!minInput);
            } else {
                console.warn('min-temp input not found in DOM during loadSettings');
            }
        }
        if (settings && typeof settings.max_temp !== 'undefined') {
            let maxTemp = parseFloat(settings.max_temp);
            if (storedTemperatureUnit && storedTemperatureUnit !== temperatureUnit) {
                maxTemp = convertTemperature(maxTemp, storedTemperatureUnit, temperatureUnit);
            }
            maxTempSetting = maxTemp;
            const maxInput = getDocumentRoot().querySelector('#max-temp');
            if (maxInput) {
                maxInput.value = maxTemp;
                console.debug('Loaded max_temp:', maxTemp, 'Input found:', !!maxInput);
            } else {
                console.warn('max-temp input not found in DOM during loadSettings');
            }
        }
        // Update unit labels (if present)
        try {
            const minUnitEl = getDocumentRoot().querySelector('#min-unit');
            const maxUnitEl = getDocumentRoot().querySelector('#max-unit');
            if (minUnitEl) minUnitEl.textContent = temperatureUnit;
            if (maxUnitEl) maxUnitEl.textContent = temperatureUnit;
        } catch (err) {
            // ignore
        }
        // If graphs already exist, update their ranges
        try {
            if (defaultScheduleGraph && typeof defaultScheduleGraph.setMinMax === 'function' && minTempSetting !== null && maxTempSetting !== null) {
                defaultScheduleGraph.setMinMax(minTempSetting, maxTempSetting);
            }
            if (graph && typeof graph.setMinMax === 'function' && minTempSetting !== null && maxTempSetting !== null) {
                graph.setMinMax(minTempSetting, maxTempSetting);
            }
        } catch (err) {
            console.debug('Failed to apply min/max to graphs:', err);
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings to server
async function saveSettings() {
    try {
        const settings = {
            defaultSchedule: defaultScheduleSettings,
            tooltipMode: tooltipMode
        };
        // Read min/max inputs
        const minInput = getDocumentRoot().querySelector('#min-temp');
        const maxInput = getDocumentRoot().querySelector('#max-temp');
        if (minInput && minInput.value !== '') settings.min_temp = parseFloat(minInput.value);
        if (maxInput && maxInput.value !== '') settings.max_temp = parseFloat(maxInput.value);
        
        // Read derivative sensor checkbox
        const derivativeCheckbox = getDocumentRoot().querySelector('#create-derivative-sensors');
        if (derivativeCheckbox) {
            settings.create_derivative_sensors = derivativeCheckbox.checked;
        }
        
        // Read workday integration checkbox
        const workdayCheckbox = getDocumentRoot().querySelector('#use-workday-integration');
        if (workdayCheckbox) {
            settings.use_workday_integration = workdayCheckbox.checked;
        }
        
        // Read selected workdays
        const selectedWorkdays = getSelectedWorkdays();
        if (selectedWorkdays.length > 0) {
            settings.workdays = selectedWorkdays;
        }
        
        await haAPI.saveSettings(settings);
        // Update runtime globals and graphs
        if (typeof settings.min_temp !== 'undefined') {
            minTempSetting = parseFloat(settings.min_temp);
        }
        if (typeof settings.max_temp !== 'undefined') {
            maxTempSetting = parseFloat(settings.max_temp);
        }
        try {
            if (defaultScheduleGraph && typeof defaultScheduleGraph.setMinMax === 'function' && minTempSetting !== null && maxTempSetting !== null) {
                defaultScheduleGraph.setMinMax(minTempSetting, maxTempSetting);
            }
            if (graph && typeof graph.setMinMax === 'function' && minTempSetting !== null && maxTempSetting !== null) {
                graph.setMinMax(minTempSetting, maxTempSetting);
            }
        } catch (err) {
            console.debug('Failed to apply min/max to graphs after save:', err);
        }
        // Settings saved
        return true;
    } catch (error) {
        console.error('Failed to save settings:', error);
        return false;
    }
}

// Handle default schedule graph changes
function handleDefaultScheduleChange(event) {
    defaultScheduleSettings = event.detail.nodes;
    // Auto-save when default schedule is modified
    saveSettings();
}

// Setup settings panel event listeners
async function setupSettingsPanel() {
    await loadSettings();
    
    // Initialize the default schedule graph
    const svgElement = getDocumentRoot().querySelector('#default-schedule-graph');
    if (svgElement) {
        defaultScheduleGraph = new TemperatureGraph(svgElement, temperatureUnit, graphSnapStep, serverTimeZone);
        defaultScheduleGraph.setTooltipMode(tooltipMode);

        // Apply configured min/max if available
        if (minTempSetting !== null && maxTempSetting !== null && typeof defaultScheduleGraph.setMinMax === 'function') {
            defaultScheduleGraph.setMinMax(minTempSetting, maxTempSetting);
        }
        defaultScheduleGraph.setNodes(defaultScheduleSettings);
        
        // Attach event listener for changes
        svgElement.addEventListener('nodesChanged', handleDefaultScheduleChange);
        
        // Attach node settings listener
        svgElement.addEventListener('nodeSettings', handleDefaultNodeSettings);
        
        // Attach node settings update listener (for drag updates)
        svgElement.addEventListener('nodeSettingsUpdate', (event) => {
            const { nodeIndex, node } = event.detail;
            const panel = getDocumentRoot().querySelector('#default-node-settings-panel');
            
            // Only update if this node's panel is currently showing
            if (panel && panel.style.display !== 'none' && panel.dataset.nodeIndex == nodeIndex) {
                getDocumentRoot().querySelector('#default-node-time').textContent = node.time;
                getDocumentRoot().querySelector('#default-node-temp').textContent = `${node.temp}${temperatureUnit}`;
            }
        });
    }
    
    // Toggle collapse
    const toggle = getDocumentRoot().querySelector('#settings-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const panel = getDocumentRoot().querySelector('#settings-panel');
            panel.classList.toggle('collapsed');
        });
    }
    
    // Tooltip mode selector
    const tooltipModeSelect = getDocumentRoot().querySelector('#tooltip-mode');
    if (tooltipModeSelect) {
        tooltipModeSelect.addEventListener('change', (e) => {
            tooltipMode = e.target.value;
            
            // Update all graph instances
            if (graph) {
                graph.setTooltipMode(tooltipMode);
            }
            if (defaultScheduleGraph) {
                defaultScheduleGraph.setTooltipMode(tooltipMode);
            }
            
            // Auto-save the setting
            saveSettings();
        });
    }
    
    // Debug panel toggle
    const debugToggle = getDocumentRoot().querySelector('#debug-panel-toggle');
    const debugPanel = getDocumentRoot().querySelector('#debug-panel');
    if (debugToggle && debugPanel) {
        // Restore saved state
        debugToggle.checked = debugPanelEnabled;
        debugPanel.style.display = debugPanelEnabled ? 'block' : 'none';
        
        // Subscribe to logs if debug was previously enabled
        if (debugPanelEnabled) {
            debugLog('Debug panel restored from saved state');
            // Set log level to debug
            haAPI.setLogLevel('debug').then(() => {
                debugLog('Log level set to debug (check Home Assistant logs)', 'info');
            }).catch(error => {
                debugLog('Failed to set log level: ' + error.message, 'error');
            });
        }
        
        debugToggle.addEventListener('change', async (e) => {
            debugPanelEnabled = e.target.checked;
            localStorage.setItem('debugPanelEnabled', debugPanelEnabled);
            debugPanel.style.display = debugPanelEnabled ? 'block' : 'none';
            
            if (debugPanelEnabled) {
                debugLog('Debug panel enabled');
                // Set log level to debug
                try {
                    await haAPI.setLogLevel('debug');
                    debugLog('Log level set to debug (check Home Assistant logs)', 'info');
                    debugLog('Frontend operations will be logged here. Backend logs are in Home Assistant system log.', 'info');
                } catch (error) {
                    debugLog('Failed to set log level: ' + error.message, 'error');
                }
            } else {
                debugLog('Debug panel disabled');
                // Reset log level to info when disabling
                try {
                    await haAPI.setLogLevel('info');
                    debugLog('Log level reset to info', 'info');
                } catch (error) {
                    debugLog('Failed to reset log level: ' + error.message, 'error');
                }
            }
        });
    }
    
    // Clear debug button
    const clearDebugBtn = getDocumentRoot().querySelector('#clear-debug');
    if (clearDebugBtn) {
        clearDebugBtn.addEventListener('click', () => {
            const debugContent = getDocumentRoot().querySelector('#debug-content');
            if (debugContent) {
                debugContent.innerHTML = '';
                debugLog('Debug console cleared');
            }
        });
    }
    
    // Graph snap step setting
    const graphSnapStepSelect = getDocumentRoot().querySelector('#graph-snap-step');
    if (graphSnapStepSelect) {
        graphSnapStepSelect.value = graphSnapStep.toString();
        graphSnapStepSelect.addEventListener('change', (e) => {
            graphSnapStep = parseFloat(e.target.value);
            localStorage.setItem('graphSnapStep', graphSnapStep);
            showToast(`Graph snap step set to ${graphSnapStep}°`, 'success');
            
            // Update graph instance if it exists
            if (graph) {
                graph.graphSnapStep = graphSnapStep;
            }
        });
    }
    
    // Input temperature step setting
    const inputTempStepSelect = getDocumentRoot().querySelector('#input-temp-step');
    if (inputTempStepSelect) {
        inputTempStepSelect.value = inputTempStep.toString();
        inputTempStepSelect.addEventListener('change', (e) => {
            inputTempStep = parseFloat(e.target.value);
            localStorage.setItem('inputTempStep', inputTempStep);
            showToast(`Input field step set to ${inputTempStep}°`, 'success');
            
            // Update the temperature input field if it exists
            const tempInput = getDocumentRoot().querySelector('#node-temp-input');
            if (tempInput) {
                tempInput.step = inputTempStep.toString();
            }
            
            // Update button titles
            const tempUpBtn = getDocumentRoot().querySelector('#temp-up');
            const tempDownBtn = getDocumentRoot().querySelector('#temp-down');
            if (tempUpBtn) tempUpBtn.title = `+${inputTempStep}°`;
            if (tempDownBtn) tempDownBtn.title = `-${inputTempStep}°`;
        });
    }
    
    // Min/Max temperature inputs - auto-save on change
    const minTempInput = getDocumentRoot().querySelector('#min-temp');
    const maxTempInput = getDocumentRoot().querySelector('#max-temp');
    if (minTempInput) {
        minTempInput.addEventListener('change', async (e) => {
            // Simple client-side validation: ensure numeric
            if (e.target.value !== '') {
                const v = parseFloat(e.target.value);
                if (Number.isNaN(v)) {
                    alert('Minimum temperature must be a number');
                    return;
                }
            }
            await saveSettings();
        });
    }
    if (maxTempInput) {
        maxTempInput.addEventListener('change', async (e) => {
            if (e.target.value !== '') {
                const v = parseFloat(e.target.value);
                if (Number.isNaN(v)) {
                    alert('Maximum temperature must be a number');
                    return;
                }
            }
            await saveSettings();
        });
    }
    
    // Reset button
    const resetBtn = getDocumentRoot().querySelector('#reset-defaults');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (confirm('Reset to default schedule settings?')) {
                defaultScheduleSettings = [];
                
                if (defaultScheduleGraph) {
                    defaultScheduleGraph.setNodes(defaultScheduleSettings);
                }
                
                const success = await saveSettings();
                if (success) {
                    resetBtn.textContent = '✓ Reset!';
                    setTimeout(() => {
                        resetBtn.textContent = 'Reset to Defaults';
                    }, 2000);
                }
            }
        });
    }
    
    // Workday integration checkbox
    const workdayCheckbox = getDocumentRoot().querySelector('#use-workday-integration');
    if (workdayCheckbox) {
        workdayCheckbox.addEventListener('change', async () => {
            // Update visibility of workday selector
            updateWorkdaySelectorVisibility(workdayCheckbox.checked);
            await saveSettings();
        });
    }
    
    // Workday day checkboxes
    const workdayDayCheckboxes = getDocumentRoot().querySelectorAll('.workday-checkbox');
    workdayDayCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
            await saveSettings();
        });
    });
    
    // Clear default schedule button
    const clearDefaultScheduleBtn = getDocumentRoot().querySelector('#clear-default-schedule-btn');
    if (clearDefaultScheduleBtn) {
        clearDefaultScheduleBtn.addEventListener('click', async () => {
            if (confirm('Clear the default schedule? All nodes will be removed.')) {
                defaultScheduleSettings = [];
                
                if (defaultScheduleGraph) {
                    defaultScheduleGraph.setNodes(defaultScheduleSettings);
                }
                
                const success = await saveSettings();
                if (success) {
                    clearDefaultScheduleBtn.textContent = '✓ Cleared!';
                    setTimeout(() => {
                        clearDefaultScheduleBtn.textContent = 'Clear Schedule';
                    }, 2000);
                }
            }
        });
    }
    
    // Derivative sensor checkbox - auto-save on change
    const derivativeCheckbox = getDocumentRoot().querySelector('#create-derivative-sensors');
    if (derivativeCheckbox) {
        derivativeCheckbox.addEventListener('change', async () => {
            await saveSettings();
        });
    }
    
    // Cleanup derivative sensors button
    const cleanupBtn = getDocumentRoot().querySelector('#cleanup-derivative-sensors-btn');
    if (cleanupBtn) {
        cleanupBtn.addEventListener('click', async () => {
            try {
                // First check if auto-creation is disabled
                const settings = await haAPI.getSettings();
                const autoCreationEnabled = settings?.create_derivative_sensors !== false;
                
                let confirmDeleteAll = false;
                if (!autoCreationEnabled) {
                    // Ask for confirmation to delete all
                    const confirmed = confirm(
                        'Auto-creation of derivative sensors is disabled.\\n\\n' +
                        'This will DELETE ALL climate_scheduler derivative sensors.\\n\\n' +
                        'Are you sure you want to continue?'
                    );
                    if (!confirmed) return;
                    confirmDeleteAll = true;
                } else {
                    // Just cleanup orphaned sensors
                    const confirmed = confirm(
                        'This will remove derivative sensors for thermostats that no longer exist.\\n\\n' +
                        'Continue?'
                    );
                    if (!confirmed) return;
                }
                
                cleanupBtn.textContent = '🧹 Cleaning up...';
                cleanupBtn.disabled = true;
                
                const result = await haAPI.cleanupDerivativeSensors(confirmDeleteAll);
                
                if (result.requires_confirmation) {
                    showToast(result.message, 'warning', 6000);
                } else {
                    showToast(result.message, 'success', 4000);
                }
                
                if (result.errors && result.errors.length > 0) {
                    console.error('Cleanup errors:', result.errors);
                    showToast(`Deleted ${result.deleted_count} sensors with ${result.errors.length} errors`, 'warning', 5000);
                }
                
                cleanupBtn.textContent = '✓ Cleanup Complete!';
                setTimeout(() => {
                    cleanupBtn.textContent = '🧹 Cleanup Derivative Sensors';
                    cleanupBtn.disabled = false;
                }, 3000);
            } catch (error) {
                console.error('Failed to cleanup derivative sensors:', error);
                showToast('Failed to cleanup derivative sensors', 'error');
                cleanupBtn.textContent = '🧹 Cleanup Derivative Sensors';
                cleanupBtn.disabled = false;
            }
        });
    }

    const cleanupClimateBtn = getDocumentRoot().querySelector('#cleanup-orphaned-climate-btn');
    if (cleanupClimateBtn) {
        cleanupClimateBtn.addEventListener('click', async () => {
            try {
                // First do a dry run to see what would be deleted
                cleanupClimateBtn.textContent = '🔍 Scanning...';
                cleanupClimateBtn.disabled = true;
                
                const dryRunResult = await haAPI.cleanupOrphanedClimateEntities(false);
                
                if (!dryRunResult.orphaned_entities || dryRunResult.orphaned_entities.length === 0) {
                    showToast('No orphaned entities found', 'success');
                    cleanupClimateBtn.textContent = 'Cleanup Orphaned Entities';
                    cleanupClimateBtn.disabled = false;
                    return;
                }
                
                // Ask for confirmation with list of entities
                const entityList = dryRunResult.orphaned_entities.join('\n• ');
                const confirmed = confirm(
                    `Found ${dryRunResult.orphaned_entities.length} orphaned entities:\n\n` +
                    `• ${entityList}\n\n` +
                    'These entities no longer have matching groups or climate entities in storage.\n\n' +
                    'Delete these entities?'
                );
                
                if (!confirmed) {
                    cleanupClimateBtn.textContent = 'Cleanup Orphaned Entities';
                    cleanupClimateBtn.disabled = false;
                    return;
                }
                
                cleanupClimateBtn.textContent = '🗑️ Deleting...';
                
                const deleteResult = await haAPI.cleanupOrphanedClimateEntities(true);
                
                if (deleteResult.removed && deleteResult.removed.length > 0) {
                    showToast(`Removed ${deleteResult.removed.length} orphaned entities`, 'success', 4000);
                } else {
                    showToast('No entities were removed', 'warning');
                }
                
                cleanupClimateBtn.textContent = '✓ Cleanup Complete!';
                setTimeout(() => {
                    cleanupClimateBtn.textContent = 'Cleanup Orphaned Entities';
                    cleanupClimateBtn.disabled = false;
                }, 3000);
            } catch (error) {
                console.error('Failed to cleanup orphaned entities:', error);
                showToast('Failed to cleanup orphaned entities', 'error');
                cleanupClimateBtn.textContent = 'Cleanup Orphaned Entities';
                cleanupClimateBtn.disabled = false;
            }
        });
    }

}

// Handle node settings for default schedule
function handleDefaultNodeSettings(event) {
    const { nodeIndex, node } = event.detail;
    
    // Node clicked
    
    // Check if default node settings panel exists
    const panel = getDocumentRoot().querySelector('#default-node-settings-panel');
    if (!panel) {
        // Node settings panel not available
        return;
    }
    
    // Updating panel
    
    // Aggregate all possible modes from all climate entities
    const hvacModesSet = new Set();
    const fanModesSet = new Set();
    const swingModesSet = new Set();
    const presetModesSet = new Set();
    
    climateEntities.forEach(entity => {
        if (entity.attributes.hvac_modes) {
            entity.attributes.hvac_modes.forEach(mode => hvacModesSet.add(mode));
        }
        if (entity.attributes.fan_modes) {
            entity.attributes.fan_modes.forEach(mode => fanModesSet.add(mode));
        }
        if (entity.attributes.swing_modes) {
            entity.attributes.swing_modes.forEach(mode => swingModesSet.add(mode));
        }
        if (entity.attributes.preset_modes) {
            entity.attributes.preset_modes.forEach(mode => presetModesSet.add(mode));
        }
    });
    
    const allHvacModes = Array.from(hvacModesSet);
    const allFanModes = Array.from(fanModesSet);
    const allSwingModes = Array.from(swingModesSet);
    const allPresetModes = Array.from(presetModesSet);
    
    // Update panel content - get fresh references
    const nodeTimeEl = getDocumentRoot().querySelector('#default-node-time');
    const nodeTempEl = getDocumentRoot().querySelector('#default-node-temp');
    if (!nodeTimeEl || !nodeTempEl) return;
    
    nodeTimeEl.textContent = node.time;
    nodeTempEl.textContent = `${node.temp}${temperatureUnit}`;
    
    // Displays updated
    
    // Get fresh references to all elements
    const hvacModeSelect = getDocumentRoot().querySelector('#default-node-hvac-mode');
    const hvacModeItem = getDocumentRoot().querySelector('#default-hvac-mode-item');
    const fanModeSelect = getDocumentRoot().querySelector('#default-node-fan-mode');
    const fanModeItem = getDocumentRoot().querySelector('#default-fan-mode-item');
    const swingModeSelect = getDocumentRoot().querySelector('#default-node-swing-mode');
    const swingModeItem = getDocumentRoot().querySelector('#default-swing-mode-item');
    const presetModeSelect = getDocumentRoot().querySelector('#default-node-preset-mode');
    const presetModeItem = getDocumentRoot().querySelector('#default-preset-mode-item');
    
    // Populate HVAC mode dropdown
    if (hvacModeSelect && hvacModeItem) {
        if (allHvacModes.length > 0) {
            hvacModeSelect.innerHTML = '<option value="">-- No Change --</option>';
            allHvacModes.forEach(mode => {
                const option = document.createElement('option');
                option.value = mode;
                option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                if (node.hvac_mode === mode) option.selected = true;
                hvacModeSelect.appendChild(option);
            });
            hvacModeItem.style.display = '';
        } else {
            hvacModeItem.style.display = 'none';
        }
    }
    
    // Populate fan mode dropdown
    if (fanModeSelect && fanModeItem) {
        if (allFanModes.length > 0) {
            fanModeSelect.innerHTML = '<option value="">-- No Change --</option>';
            allFanModes.forEach(mode => {
                const option = document.createElement('option');
                option.value = mode;
                option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                if (node.fan_mode === mode) option.selected = true;
                fanModeSelect.appendChild(option);
            });
            fanModeItem.style.display = '';
        } else {
            fanModeItem.style.display = 'none';
        }
    }
    
    // Populate swing mode dropdown
    if (swingModeSelect && swingModeItem) {
        if (allSwingModes.length > 0) {
            swingModeSelect.innerHTML = '<option value="">-- No Change --</option>';
            allSwingModes.forEach(mode => {
                const option = document.createElement('option');
                option.value = mode;
                option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                if (node.swing_mode === mode) option.selected = true;
                swingModeSelect.appendChild(option);
            });
            swingModeItem.style.display = '';
        } else {
            swingModeItem.style.display = 'none';
        }
    }
    
    // Populate preset mode dropdown
    if (presetModeSelect && presetModeItem) {
        if (allPresetModes.length > 0) {
            presetModeSelect.innerHTML = '<option value="">-- No Change --</option>';
            allPresetModes.forEach(mode => {
                const option = document.createElement('option');
                option.value = mode;
                option.textContent = mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                if (node.preset_mode === mode) option.selected = true;
                presetModeSelect.appendChild(option);
            });
            presetModeItem.style.display = '';
        } else {
            presetModeItem.style.display = 'none';
        }
    }
    
    // Setup auto-save for default schedule
    const autoSaveDefaultNodeSettings = async () => {
        if (!panel) return;
        
        const nodeIdx = parseInt(panel.dataset.nodeIndex);
        if (isNaN(nodeIdx) || !defaultScheduleGraph) return;
        
        // Get the actual node from the graph
        const targetNode = defaultScheduleGraph.nodes[nodeIdx];
        if (!targetNode) return;
        
        // Get fresh references
        const hvacSelect = getDocumentRoot().querySelector('#default-node-hvac-mode');
        const hvacItem = getDocumentRoot().querySelector('#default-hvac-mode-item');
        const fanSelect = getDocumentRoot().querySelector('#default-node-fan-mode');
        const fanItem = getDocumentRoot().querySelector('#default-fan-mode-item');
        const swingSelect = getDocumentRoot().querySelector('#default-node-swing-mode');
        const swingItem = getDocumentRoot().querySelector('#default-swing-mode-item');
        const presetSelect = getDocumentRoot().querySelector('#default-node-preset-mode');
        const presetItem = getDocumentRoot().querySelector('#default-preset-mode-item');
        
        // Update or delete properties based on dropdown values
        if (hvacSelect && hvacItem && hvacItem.style.display !== 'none') {
            const hvacMode = hvacSelect.value;
            if (hvacMode) {
                targetNode.hvac_mode = hvacMode;
            } else {
                delete targetNode.hvac_mode;
            }
        }
        
        if (fanSelect && fanItem && fanItem.style.display !== 'none') {
            const fanMode = fanSelect.value;
            if (fanMode) {
                targetNode.fan_mode = fanMode;
            } else {
                delete targetNode.fan_mode;
            }
        }
        
        if (swingSelect && swingItem && swingItem.style.display !== 'none') {
            const swingMode = swingSelect.value;
            if (swingMode) {
                targetNode.swing_mode = swingMode;
            } else {
                delete targetNode.swing_mode;
            }
        }
        
        if (presetSelect && presetItem && presetItem.style.display !== 'none') {
            const presetMode = presetSelect.value;
            if (presetMode) {
                targetNode.preset_mode = presetMode;
            } else {
                delete targetNode.preset_mode;
            }
        }
        
        // Update the settings array
        defaultScheduleSettings = defaultScheduleGraph.getNodes();
        
        // Auto-save to server
        await saveSettings();
    };
    
    // Attach change listeners to the freshly populated dropdowns
    const finalHvacSelect = getDocumentRoot().querySelector('#default-node-hvac-mode');
    const finalFanSelect = getDocumentRoot().querySelector('#default-node-fan-mode');
    const finalSwingSelect = getDocumentRoot().querySelector('#default-node-swing-mode');
    const finalPresetSelect = getDocumentRoot().querySelector('#default-node-preset-mode');
    
    if (finalHvacSelect) {
        finalHvacSelect.addEventListener('change', autoSaveDefaultNodeSettings);
    }
    if (finalFanSelect) {
        finalFanSelect.addEventListener('change', autoSaveDefaultNodeSettings);
    }
    if (finalSwingSelect) {
        finalSwingSelect.addEventListener('change', autoSaveDefaultNodeSettings);
    }
    if (finalPresetSelect) {
        finalPresetSelect.addEventListener('change', autoSaveDefaultNodeSettings);
    }
    
    // Panel ready
    
    // Setup delete button
    const deleteBtn = getDocumentRoot().querySelector('#default-delete-node-btn');
    if (deleteBtn) {
        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        
        newDeleteBtn.addEventListener('click', () => {
            if (defaultScheduleGraph.nodes.length <= 1) {
                alert('Cannot delete the last node. A schedule must have at least one node.');
                return;
            }
            
            if (confirm('Delete this node?')) {
                defaultScheduleGraph.removeNodeByIndex(nodeIndex);
                defaultScheduleSettings = defaultScheduleGraph.getNodes();
                panel.style.display = 'none';
            }
        });
    }
    
    // Show panel
    panel.style.display = 'block';
    panel.dataset.nodeIndex = nodeIndex;
    
    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Load advance history for an entity
async function loadAdvanceHistory(entityId) {
    try {
        const status = await haAPI.getAdvanceStatus(entityId);
        if (status && status.history && graph) {
            graph.setAdvanceHistory(status.history);
        }
    } catch (error) {
        console.error('Failed to load advance history:', error);
    }
}

// Export initialization function for custom panel
window.initClimateSchedulerApp = function(hass) {
    // Create API instance first if needed
    if (!haAPI) {
        haAPI = new HomeAssistantAPI();
    }
    
    // Set hass object FIRST if provided (custom panel mode)
    if (hass) {
        haAPI.setHassObject(hass);
    }
    
    // Initialize app - connect() will use hass object if available
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
};

// Export function to update hass connection (when panel receives new hass object)
window.updateHassConnection = function(hass) {
    if (hass && haAPI) {
        haAPI.setHassObject(hass);
    }
};

// Auto-initialize for backward compatibility (iframe/standalone mode)
// Guard initialization so we only run in documents that contain the expected
// UI container (prevents errors when `index.html` is removed and app.js is
// loaded in a different context).
const _shouldAutoInit = () => {
    // If the panel custom element is present, let panel.js call init explicitly
    try {
        if (customElements && customElements.get && customElements.get('climate-scheduler-panel')) {
            return false;
        }
    } catch (e) {
        // ignore
    }

    // Check for an existing container or entity list; only auto-init if present
    if (document.querySelector('#entity-list') || document.querySelector('.container')) {
        return true;
    }
    return false;
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (_shouldAutoInit()) initApp();
    });
} else {
    if (_shouldAutoInit()) initApp();
}


