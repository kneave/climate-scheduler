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
let currentEntityId = null;
let climateEntities = [];
let entitySchedules = new Map(); // Track which entities have schedules locally
let temperatureUnit = '°C'; // Default to Celsius, updated from HA config
let storedTemperatureUnit = null; // Unit that schedules were saved in

// Temperature conversion functions
function celsiusToFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
}

function fahrenheitToCelsius(fahrenheit) {
    return (fahrenheit - 32) * 5/9;
}

function convertTemperature(temp, fromUnit, toUnit) {
    if (fromUnit === toUnit) return temp;
    if (fromUnit === '°C' && toUnit === '°F') return celsiusToFahrenheit(temp);
    if (fromUnit === '°F' && toUnit === '°C') return fahrenheitToCelsius(temp);
    return temp;
}

function convertScheduleNodes(nodes, fromUnit, toUnit) {
    if (!nodes || nodes.length === 0 || fromUnit === toUnit) return nodes;
    return nodes.map(node => ({
        ...node,
        temp: Math.round(convertTemperature(node.temp, fromUnit, toUnit) * 2) / 2 // Round to 0.5
    }));
}
let allGroups = {}; // Store all groups data
let currentGroup = null; // Currently selected group
let tooltipMode = 'history'; // 'history' or 'cursor'
let debugPanelEnabled = localStorage.getItem('debugPanelEnabled') === 'true'; // Debug panel visibility
let currentDay = null; // Currently selected day for editing (e.g., 'mon', 'weekday')
let currentScheduleMode = 'all_days'; // Current schedule mode: 'all_days', '5/2', 'individual'
let isLoadingSchedule = false; // Flag to prevent auto-save during schedule loading

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
        
        // Get Home Assistant configuration for temperature unit
        const config = await haAPI.getConfig();
        if (config && config.unit_system && config.unit_system.temperature) {
            temperatureUnit = config.unit_system.temperature === '°F' ? '°F' : '°C';
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
            
            // Only add to entitySchedules if it has nodes AND is enabled
            if (schedule && schedule.nodes && schedule.nodes.length > 0 && schedule.enabled) {
                // Entity has an enabled schedule - add to Map
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
    
    const groupNames = Object.keys(allGroups);
    
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

// Create a group container element
function createGroupContainer(groupName, groupData) {
    const container = document.createElement('div');
    container.className = 'group-container';
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
    
    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = groupName;
    
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `${groupData.entities?.length || 0} entities`;
    
    leftSide.appendChild(toggleIcon);
    leftSide.appendChild(title);
    leftSide.appendChild(count);
    
    // Create action buttons
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    
    // Add enabled toggle
    const toggleContainer = document.createElement('label');
    toggleContainer.className = 'toggle-switch';
    toggleContainer.style.marginRight = '12px';
    toggleContainer.onclick = (e) => e.stopPropagation();
    
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = groupData.enabled !== false;
    toggleInput.onchange = async (e) => {
        e.stopPropagation();
        await toggleGroupEnabled(groupName, toggleInput.checked);
    };
    
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'slider';
    
    toggleContainer.appendChild(toggleInput);
    toggleContainer.appendChild(toggleSlider);
    
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit Schedule';
    editBtn.onclick = (e) => {
        e.stopPropagation();
        // Toggle edit - if already editing this group, collapse; otherwise expand
        if (currentGroup === groupName && container.classList.contains('expanded')) {
            collapseAllEditors();
            currentGroup = null;
        } else {
            editGroupSchedule(groupName);
        }
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Group';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        confirmDeleteGroup(groupName);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    
    header.appendChild(leftSide);
    header.appendChild(actions);
    
    // Create entities container
    const entitiesContainer = document.createElement('div');
    entitiesContainer.className = 'group-entities';
    
    if (groupData.entities && groupData.entities.length > 0) {
        groupData.entities.forEach(entityId => {
            const entityCard = createGroupEntityCard(entityId, groupName);
            if (entityCard) {
                entitiesContainer.appendChild(entityCard);
            }
        });
    } else {
        entitiesContainer.innerHTML = '<p style="color: var(--secondary-text-color); padding: 8px;">No entities in this group</p>';
    }
    
    // Toggle collapse/expand and edit schedule on header click
    header.onclick = (e) => {
        // Don't trigger if clicking on action buttons
        if (e.target.closest('.group-actions')) return;
        
        // Check if we're currently editing this group
        const isCurrentlyExpanded = currentGroup === groupName && container.classList.contains('expanded');
        
        if (isCurrentlyExpanded) {
            // Collapse the editor
            collapseAllEditors();
            currentGroup = null;
        } else {
            // Expand the editor
            editGroupSchedule(groupName);
        }
        
        // Also toggle the entities list visibility
        container.classList.toggle('collapsed');
        toggleIcon.style.transform = container.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    };
    
    container.appendChild(header);
    container.appendChild(entitiesContainer);
    
    return container;
}function createGroupEntityCard(entityId, groupName) {
    const entity = climateEntities.find(e => e.entity_id === entityId);
    if (!entity) return null;
    
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.dataset.entityId = entityId;
    
    const name = document.createElement('span');
    name.textContent = entity.attributes?.friendly_name || entityId;
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.style.marginLeft = 'auto';
    removeBtn.onclick = () => removeEntityFromGroup(groupName, entityId);
    
    card.appendChild(name);
    card.appendChild(removeBtn);
    
    return card;
}

// Edit group schedule - load group schedule into editor
async function editGroupSchedule(groupName, day = null) {
    const groupData = allGroups[groupName];
    if (!groupData) return;
    
    // Set loading flag to prevent auto-saves during editor setup
    isLoadingSchedule = true;
        //
    
    // Collapse all other editors first
    collapseAllEditors();
    
    // Set current group and clear entity selection
    currentGroup = groupName;
    currentEntityId = null;
    
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
    
    // Show group members table at the top of the editor
    const editorHeader = editor.querySelector('.editor-header-inline');
    if (editorHeader) {
        const groupTable = createGroupMembersTable(groupData.entities);
        if (groupTable) {
            editorHeader.before(groupTable);
        }
    }
    
    // Recreate graph with the new SVG element
    const svgElement = editor.querySelector('#temperature-graph');
    if (svgElement) {
        graph = new TemperatureGraph(svgElement, temperatureUnit);
        graph.setTooltipMode(tooltipMode);
        // Apply configured min/max if available
        if (minTempSetting !== null && maxTempSetting !== null && typeof graph.setMinMax === 'function') {
            graph.setMinMax(minTempSetting, maxTempSetting);
        }
        
        // Connect undo button
        const undoBtn = editor.querySelector('#undo-btn');
        if (undoBtn) {
            graph.setUndoButton(undoBtn);
        }
        
        // Attach graph event listeners (permanent listeners)
        svgElement.addEventListener('nodeSettings', handleNodeSettings);
    }
    
    // Load nodes for the selected day
    console.log('editGroupSchedule - Loading nodes for day:', currentDay, 'Available schedules:', Object.keys(groupData.schedules || {}));
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
    
    currentSchedule = nodes.length > 0 ? nodes.map(n => ({...n})) : [];
    
    // Find the SVG element
    const svg = editor.querySelector('#temperature-graph');
    
    // Set initial nodes
    graph.setNodes(currentSchedule.length > 0 ? currentSchedule : [{ time: '00:00', temp: 18 }]);
    
    // Always attach the permanent nodesChanged listener for auto-save
    if (svg) {
        svg.removeEventListener('nodesChanged', handleGraphChange); // Remove any previous
        svg.addEventListener('nodesChanged', handleGraphChange);
    }
    
    // Update schedule mode UI
    updateScheduleModeUI();
    
    // Load history data for all entities in the group
    await loadGroupHistoryData(groupData.entities);
    
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

// Create group members table element
function createGroupMembersTable(entityIds) {
    if (!entityIds || entityIds.length === 0) return null;
    
    // Create table
    const table = document.createElement('div');
    table.className = 'group-members-table';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'group-members-header';
    header.innerHTML = '<span>Name</span><span>Current</span><span>Target</span><span>Scheduled</span>';
    table.appendChild(header);
    
    // Get current time for scheduled temp calculation
    const now = new Date();
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
        currentCell.textContent = currentTemp !== undefined ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
        
        const targetCell = document.createElement('span');
        const targetTemp = entity.attributes?.temperature;
        targetCell.textContent = targetTemp !== undefined ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
        
        const scheduledCell = document.createElement('span');
        if (groupSchedule.length > 0) {
            const scheduledTemp = interpolateTemperature(groupSchedule, currentTime);
            scheduledCell.textContent = `${scheduledTemp.toFixed(1)}${temperatureUnit}`;
        } else {
            scheduledCell.textContent = '--';
        }
        
        row.appendChild(nameCell);
        row.appendChild(currentCell);
        row.appendChild(targetCell);
        row.appendChild(scheduledCell);
        table.appendChild(row);
    });
    
    return table;
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

// Remove entity from group
async function removeEntityFromGroup(groupName, entityId) {
    if (!confirm(`Remove entity from group "${groupName}"?`)) return;
    
    try {
        await haAPI.removeFromGroup(groupName, entityId);
        
        // Reload groups
        await loadGroups();
        
        // Reload entity list (entity should reappear in active/disabled)
        await renderEntityList();
        
        // Entity removed from group
    } catch (error) {
        console.error('Failed to remove entity from group:', error);
        alert('Failed to remove entity from group');
    }
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
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = groupName;
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

// Render entity list
async function renderEntityList() {
    try {
        // Query from panel element if available, fallback to document
        const root = getDocumentRoot();
        const entityList = root.querySelector('#entity-list');
        const ignoredEntityContainer = root.querySelector('#ignored-entities-container');
        const activeCount = root.querySelector('#active-count');
        const ignoredCount = root.querySelector('#ignored-count');
        
        entityList.innerHTML = '';
        ignoredEntityContainer.innerHTML = '';
        
        if (climateEntities.length === 0) {
            entityList.innerHTML = '<p style="color: #b0b0b0; padding: 20px; text-align: center;">No climate entities found</p>';
            return;
        }
        
        // Get set of entities that are in groups (should be hidden from this list)
        const entitiesInGroups = new Set();
        Object.values(allGroups).forEach(group => {
            if (group.entities) {
                group.entities.forEach(entityId => entitiesInGroups.add(entityId));
            }
        });
        
        // Use local state to check which entities are included
        const includedEntities = new Set(entitySchedules.keys());
    
        let activeEntitiesCount = 0;
        let ignoredEntitiesCount = 0;
        
        // Get filter value
        const filterInput = getDocumentRoot().querySelector('#ignored-filter');
        const filterText = filterInput ? filterInput.value.toLowerCase() : '';
        
        climateEntities.forEach(entity => {
            // Skip entities that are in groups
            if (entitiesInGroups.has(entity.entity_id)) {
                return;
            }
            
            const isIncluded = includedEntities.has(entity.entity_id);
            const card = createEntityCard(entity, isIncluded);
            
            if (isIncluded) {
                entityList.appendChild(card);
                activeEntitiesCount++;
                
                // Update selection state if this is the current entity
                if (currentEntityId === entity.entity_id) {
                    card.classList.add('selected');
                }
            } else {
                // Apply filter to ignored entities
                const entityName = (entity.attributes.friendly_name || entity.entity_id).toLowerCase();
                if (!filterText || entityName.includes(filterText)) {
                    ignoredEntityContainer.appendChild(card);
                }
                ignoredEntitiesCount++;
                
                // Update selection state if this is the current entity
                if (currentEntityId === entity.entity_id) {
                    card.classList.add('selected');
                }
            }
        });
        
        // Update counts
        activeCount.textContent = activeEntitiesCount;
        ignoredCount.textContent = ignoredEntitiesCount;
        
        // Show/hide sections based on content
        const activeSection = getDocumentRoot().querySelector('.active-section');
        const ignoredSection = getDocumentRoot().querySelector('.ignored-section');
        
        if (!activeSection) {
            alert('ERROR: active-section element not found!');
            return;
        }
        
        // Hide Active section if there are no ungrouped active entities
        if (activeEntitiesCount === 0) {
            activeSection.style.display = 'none';
        } else {
            activeSection.style.display = 'block';
        }
        
        // Ignored section remains available for enabling entities when present
        if (ignoredSection) {
            ignoredSection.style.display = 'block';
        }
        
        // No message needed if active section is hidden
    
    } catch (error) {
        console.error('ERROR in renderEntityList:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

// Create entity card element
function createEntityCard(entity, isIncluded = false) {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.dataset.entityId = entity.entity_id;
    
    if (currentEntityId === entity.entity_id) {
        card.classList.add('selected');
    }
    
    if (!isIncluded) {
        card.classList.add('excluded');
    }
    
    // For disabled entities, show + button instead of checkbox
    if (!isIncluded) {
        const addBtn = document.createElement('button');
        addBtn.className = 'entity-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Enable thermostat';
        addBtn.style.cssText = 'padding: 4px 10px; font-size: 18px; font-weight: bold;';
        addBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            addBtn.disabled = true;
            await toggleEntityInclusion(entity.entity_id, true);
            addBtn.disabled = false;
        });
        
        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'entity-checkbox-wrapper';
        btnWrapper.appendChild(addBtn);
        card.appendChild(btnWrapper);
    }
    
    const content = document.createElement('div');
    content.className = 'entity-content';
    
    const name = document.createElement('div');
    name.className = 'entity-name';
    name.textContent = entity.attributes.friendly_name || entity.entity_id;
    
    const temp = document.createElement('div');
    temp.className = 'entity-temp';
    const currentTemp = entity.attributes.current_temperature;
    const targetTemp = entity.attributes.temperature;
    
    if (currentTemp !== undefined && currentTemp !== null) {
        const targetDisplay = (targetTemp !== undefined && targetTemp !== null) 
            ? `${targetTemp.toFixed(1)}${temperatureUnit}` 
            : 'N/A';
        temp.textContent = `${targetDisplay} (${currentTemp.toFixed(1)}${temperatureUnit})`;
    } else if (targetTemp !== undefined && targetTemp !== null) {
        temp.textContent = `${targetTemp.toFixed(1)}${temperatureUnit}`;
    } else {
        temp.textContent = 'N/A';
    }
    
    content.appendChild(name);
    content.appendChild(temp);
    
    card.appendChild(content);
    
    // For active entities, add "Add to group" button
    if (isIncluded) {
        const addToGroupBtn = document.createElement('button');
        addToGroupBtn.className = 'add-to-group-btn';
        addToGroupBtn.textContent = '+';
        addToGroupBtn.title = 'Add to group';
        addToGroupBtn.style.cssText = 'margin-left: 8px; padding: 4px 8px; font-size: 16px;';
        addToGroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showAddToGroupModal(entity.entity_id);
        });
        card.appendChild(addToGroupBtn);
    }
    
    content.addEventListener('click', () => {
        // Toggle expansion - if already selected, collapse; otherwise expand
        if (currentEntityId === entity.entity_id) {
            // Collapse
            collapseAllEditors();
            currentEntityId = null;
        } else {
            // Expand with editor
            selectEntity(entity.entity_id);
        }
    });
    
    return card;
}

// Create the schedule editor element
function createScheduleEditor() {
    const editor = document.createElement('div');
    editor.className = 'schedule-editor-inline';
    editor.innerHTML = `
        <div class="editor-header-inline">
            <div class="editor-controls">
                <button id="undo-btn" class="btn-secondary-outline schedule-btn" title="Undo last change (Ctrl+Z)" disabled>Undo</button>
                <button id="copy-schedule-btn" class="btn-secondary-outline schedule-btn" title="Copy current schedule">Copy Schedule</button>
                <button id="paste-schedule-btn" class="btn-secondary-outline schedule-btn" title="Paste copied schedule" disabled>Paste Schedule</button>
                <button id="ignore-entity-btn" class="btn-secondary-outline schedule-btn" title="Disable this thermostat">Ignore</button>
                <button id="clear-schedule-btn" class="btn-danger-outline schedule-btn" title="Clear entire schedule">Clear Schedule</button>
                <button id="save-schedule-btn" class="btn-primary schedule-btn" title="Save schedule">Save</button>
                <label class="toggle-switch">
                    <input type="checkbox" id="schedule-enabled">
                    <span class="slider"></span>
                    <span class="toggle-label">Enabled</span>
                </label>
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

        <!-- Schedule Mode and Day Selector -->
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
                                <button class="spinner-btn" id="temp-down" title="-0.5°">▼</button>
                                <input type="number" id="node-temp-input" class="temp-input" step="0.5" />
                                <button class="spinner-btn" id="temp-up" title="+0.5°">▲</button>
                            </div>
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
                    </div>
                    <div class="settings-actions">
                        <button id="delete-node" class="btn-danger">Delete Node</button>
                    </div>
                </div>
            </div>
            <div class="graph-instructions">
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
    allCards.forEach(card => card.classList.remove('selected', 'expanded'));
    
    const allGroupContainers = getDocumentRoot().querySelectorAll('.group-container');
    allGroupContainers.forEach(container => container.classList.remove('expanded'));
}

// Select an entity to edit
async function selectEntity(entityId) {
    // Collapse all other editors first
    collapseAllEditors();
    
    currentEntityId = entityId;
    currentGroup = null; // Clear group selection when selecting entity
    
    // Find the entity card
    const entityCard = getDocumentRoot().querySelector(`.entity-card[data-entity-id="${entityId}"]`);
    if (!entityCard) return;
    
    // Mark as selected and expanded
    entityCard.classList.add('selected', 'expanded');
    
    // Add close button to the first row (same level as checkbox)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-entity-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close editor';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        collapseAllEditors();
    };
    
    // Insert close button before the editor (it will be in the flex row with checkbox and content)
    const entityContent = entityCard.querySelector('.entity-content');
    if (entityContent) {
        entityContent.parentNode.insertBefore(closeBtn, entityContent.nextSibling);
    }
    
    // Create and insert editor inside the card (append to the end)
    const editor = createScheduleEditor();
    entityCard.appendChild(editor);
    
    // Show entity status section (for single entities)
    const entityStatus = editor.querySelector('.entity-status');
    if (entityStatus) {
        entityStatus.style.display = 'flex';
    }
    
    // Get the entity
    const entity = climateEntities.find(e => e.entity_id === entityId);
    
    // Recreate graph with the new SVG element
    const svgElement = editor.querySelector('#temperature-graph');
    if (svgElement) {
        graph = new TemperatureGraph(svgElement, temperatureUnit);
        graph.setTooltipMode(tooltipMode);
        // Apply configured min/max if available
        if (minTempSetting !== null && maxTempSetting !== null && typeof graph.setMinMax === 'function') {
            graph.setMinMax(minTempSetting, maxTempSetting);
        }
        
        // Connect undo button
        const undoBtn = editor.querySelector('#undo-btn');
        if (undoBtn) {
            graph.setUndoButton(undoBtn);
        }
        
        // Always attach the permanent nodesChanged listener for auto-save
        svgElement.removeEventListener('nodesChanged', handleGraphChange); // Remove any previous
        svgElement.addEventListener('nodesChanged', handleGraphChange);
        svgElement.addEventListener('nodeSettings', handleNodeSettings);
    }
    
    // Load schedule
    await loadEntitySchedule(entityId);
    
    // Load history data
    await loadHistoryData(entityId);
    
    // Update entity status
    updateEntityStatus(entity);
    
    // Reattach event listeners for the new editor elements
    attachEditorEventListeners(editor);
    
    // Update paste button state
    updatePasteButtonState();
}

// Attach event listeners to editor elements (for dynamically created editors)
function attachEditorEventListeners(editorElement) {
    
    // Ignore button
    const ignoreBtn = editorElement.querySelector('#ignore-entity-btn');
    if (ignoreBtn) {
        ignoreBtn.onclick = async () => {
            if (!currentEntityId) return;
            
            await toggleEntityInclusion(currentEntityId, false);
            collapseAllEditors();
            currentEntityId = null;
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
    
    // Clear schedule button
    const clearBtn = editorElement.querySelector('#clear-schedule-btn');
    if (clearBtn) {
        clearBtn.onclick = async () => {
            if (currentEntityId) {
                const entity = climateEntities.find(e => e.entity_id === currentEntityId);
                const entityName = entity ? entity.attributes.friendly_name : currentEntityId;
                
                if (confirm(`Clear schedule for ${entityName}?`)) {
                    await clearScheduleForEntity(currentEntityId);
                }
            } else if (currentGroup) {
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
                const newIndex = currentIndex > 0 ? currentIndex - 1 : graph.nodes.length - 1;
                graph.showNodeSettings(newIndex);
            }
        };
    }
    
    if (nextNodeBtn) {
        nextNodeBtn.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const currentIndex = parseInt(panel.dataset.nodeIndex);
            if (!isNaN(currentIndex) && graph && graph.nodes.length > 0) {
                const newIndex = currentIndex < graph.nodes.length - 1 ? currentIndex + 1 : 0;
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
        if (tempInput && tempInput.value) {
            const temp = parseFloat(tempInput.value);
            if (!isNaN(temp)) {
                node.temp = temp;
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
            
            // Increment based on temperature unit (0.5°C or 1°F)
            const increment = temperatureUnit === '°F' ? 1 : 0.5;
            node.temp = Math.round((node.temp + increment) * 10) / 10;
            
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
            
            // Decrement based on temperature unit (0.5°C or 1°F)
            const increment = temperatureUnit === '°F' ? 1 : 0.5;
            node.temp = Math.round((node.temp - increment) * 10) / 10;
            
            tempInput.value = node.temp;
            graph.render();
            saveSchedule();
        };
    };
    
    // Delete node button
    const deleteNode = editorElement.querySelector('#delete-node');
    if (deleteNode) {
        deleteNode.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            const nodeIndex = parseInt(panel.dataset.nodeIndex);
            if (!isNaN(nodeIndex) && graph) {
                graph.removeNodeByIndex(nodeIndex);
                panel.style.display = 'none';
            }
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
        
        // This will trigger save and force immediate update
        graph.notifyChange(true);
    };
    
    // Attach change listeners to all dropdowns
    if (hvacModeSelect) hvacModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (fanModeSelect) fanModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (swingModeSelect) swingModeSelect.addEventListener('change', autoSaveNodeSettings);
    if (presetModeSelect) presetModeSelect.addEventListener('change', autoSaveNodeSettings);
    
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
}

// Clipboard for schedule copy/paste
let scheduleClipboard = null;

// Update paste button state based on clipboard
function updatePasteButtonState() {
    const pasteBtn = getDocumentRoot().querySelector('#paste-schedule-btn');
    if (pasteBtn) {
        pasteBtn.disabled = !scheduleClipboard || scheduleClipboard.length === 0;
    }
}

// Copy current schedule to clipboard
function copySchedule() {
    const nodes = graph.getNodes();
    if (nodes && nodes.length > 0) {
        // Deep copy the nodes
        scheduleClipboard = nodes.map(n => ({...n}));
        
        // Enable paste button
        const pasteBtn = getDocumentRoot().querySelector('#paste-schedule-btn');
        if (pasteBtn) {
            pasteBtn.disabled = false;
        }
        
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
        
        // Save default schedule to HA
        await haAPI.setSchedule(entityId, defaultSchedule);
        
        // Update local state
        entitySchedules.set(entityId, defaultSchedule);
        
        // Update graph with default schedule
        if (graph) {
            graph.setNodes(defaultSchedule);
        }
        
        // Update current schedule reference
        currentSchedule = defaultSchedule;
        
        await saveSchedule();
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

// Load schedule for entity
async function loadEntitySchedule(entityId, day = null) {
    try {
        console.log('loadEntitySchedule called - entityId:', entityId, 'day parameter:', day, 'currentDay:', currentDay);
        const result = await haAPI.getSchedule(entityId);
        const schedule = result?.response || result;
        
        //
        
        if (schedule) {
            // Update schedule mode from backend (but don't override if already set correctly)
            if (!currentScheduleMode || currentScheduleMode !== schedule.schedule_mode) {
                currentScheduleMode = schedule.schedule_mode || 'all_days';
        //
            }
            
            // Determine which day's schedule to load
            let dayToLoad = day;
            if (!dayToLoad) {
                // If no day specified and currentDay is already set, use it
                if (currentDay && currentDay !== 'all_days') {
                    dayToLoad = currentDay;
        //
                } else {
                    // Default to current day based on mode
                    const now = new Date();
                    const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
                    
                    if (currentScheduleMode === 'all_days') {
                        dayToLoad = 'all_days';
                    } else if (currentScheduleMode === '5/2') {
                        dayToLoad = (weekday === 'sat' || weekday === 'sun') ? 'weekend' : 'weekday';
                    } else {
                        dayToLoad = weekday;
                    }
        //
                }
            }
            
            currentDay = dayToLoad;
        //
            
            // Get nodes for the selected day
            let nodes = [];
            if (schedule.schedules && schedule.schedules[dayToLoad]) {
                nodes = schedule.schedules[dayToLoad];
        //
            } else if (schedule.nodes) {
                // Backward compatibility - old format
                nodes = schedule.nodes;
        //
            } else if (schedule.schedules && schedule.schedules['all_days']) {
                // If this day doesn't exist, use all_days as template
                nodes = schedule.schedules['all_days'];
        //
            } else {
        //
            }
            
            // Update UI
            updateScheduleModeUI();
        //
            graph.setNodes(nodes.length > 0 ? nodes : [{ time: '00:00', temp: 18 }]);
            getDocumentRoot().querySelector('#schedule-enabled').checked = schedule.enabled !== false;
        } else {
            // New schedule - set defaults
            currentScheduleMode = 'all_days';
            currentDay = 'all_days';
            updateScheduleModeUI();
            graph.setNodes([{ time: '00:00', temp: 18 }]);
            getDocumentRoot().querySelector('#schedule-enabled').checked = true;
        }
        
        updateScheduledTemp();
        updatePasteButtonState();
    } catch (error) {
        console.error('Failed to load schedule:', error);
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
    
    // Update graph title to show current day
    updateGraphTitle();
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
    if (!currentEntityId && !currentGroup) return;
    
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
    } else if (currentEntityId) {
        const nodes = graph.getNodes();
        await haAPI.setSchedule(currentEntityId, nodes, currentDay, currentScheduleMode);
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
        graph.setNodes(currentSchedule.length > 0 ? currentSchedule : [{ time: '00:00', temp: 18 }]);
        
        // Clear loading flag after a delay
        setTimeout(() => {
            isLoadingSchedule = false;
        //
        }, 100);
        
        // Update scheduled temp display
        updateScheduledTemp();
    } else {
        await loadEntitySchedule(currentEntityId);
    }
}

// Switch to a different day
async function switchDay(day) {
    if (!currentEntityId && !currentGroup) return;
    
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
        graph.setNodes(currentSchedule.length > 0 ? currentSchedule : [{ time: '00:00', temp: 18 }]);
        
        // Clear loading flag after a delay
        setTimeout(() => {
            isLoadingSchedule = false;
        //
        }, 100);
        
        // Update scheduled temp display
        updateScheduledTemp();
    } else {
        await loadEntitySchedule(currentEntityId, day);
    }
}

// Load history data for current day
async function loadHistoryData(entityId) {
    try {
        // Get start of today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
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
        // Get start of today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
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
    // Don't save if we're in the middle of loading a schedule
    if (isLoadingSchedule) {
        console.log('saveSchedule - skipping save, currently loading schedule');
        return;
    }
    
    console.log('saveSchedule - currentDay:', currentDay, 'currentScheduleMode:', currentScheduleMode);
    
    // Check if we're editing a group schedule
    if (currentGroup) {
        try {
            const nodes = graph.getNodes();
            const enabled = getDocumentRoot().querySelector('#schedule-enabled').checked;
            
            console.log('Saving group schedule - group:', currentGroup, 'nodes:', nodes.length, 'day:', currentDay, 'mode:', currentScheduleMode);
            
            // Save to group schedule with day and mode
            await haAPI.setGroupSchedule(currentGroup, nodes, currentDay, currentScheduleMode);
            
            // Update enabled state
            if (enabled) {
                await haAPI.enableGroup(currentGroup);
            } else {
                await haAPI.disableGroup(currentGroup);
            }
            
            // Update local state
            if (allGroups[currentGroup]) {
                allGroups[currentGroup].enabled = enabled;
            }
        } catch (error) {
            console.error('Failed to auto-save group schedule:', error);
        }
        return;
    }
    
    // Otherwise save individual entity schedule
    if (!currentEntityId) return;
    
    try {
        const nodes = graph.getNodes();
        const enabled = getDocumentRoot().querySelector('#schedule-enabled').checked;
        
        // Update local state immediately with the current entity's schedule
        entitySchedules.set(currentEntityId, JSON.parse(JSON.stringify(nodes)));
        
        // Save schedule to HA in background with day and mode
        await haAPI.setSchedule(currentEntityId, nodes, currentDay, currentScheduleMode);
        
        // Update enabled state
        if (enabled) {
            await haAPI.enableSchedule(currentEntityId);
        } else {
            await haAPI.disableSchedule(currentEntityId);
        }
    } catch (error) {
        console.error('Failed to auto-save schedule:', error);
    }
}

// Handle graph changes - auto-save and sync if needed
async function handleGraphChange(event, force = false) {
    // Handle graph change
    
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
        scheduledTempEl.textContent = `${temp.toFixed(1)}${temperatureUnit}`;
    } else {
        scheduledTempEl.textContent = '--';
    }
}

// Interpolate temperature (step function - hold until next node)
function interpolateTemperature(nodes, timeStr) {
    if (nodes.length === 0) return 18;
    
    const sorted = [...nodes].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    const currentMinutes = timeToMinutes(timeStr);
    
    // Find the most recent node before or at current time
    let activeNode = null;
    
    for (let i = 0; i < sorted.length; i++) {
        const nodeMinutes = timeToMinutes(sorted[i].time);
        if (nodeMinutes <= currentMinutes) {
            activeNode = sorted[i];
        } else {
            break;
        }
    }
    
    // If no node found before current time, use last node (wrap around from previous day)
    if (!activeNode) {
        activeNode = sorted[sorted.length - 1];
    }
    
    return activeNode.temp;
}

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

// Update entity status display
function updateEntityStatus(entity) {
    if (!entity) return;
    
    const currentTempEl = getDocumentRoot().querySelector('#current-temp');
    const targetTempEl = getDocumentRoot().querySelector('#target-temp');
    
    // Elements may not exist if entity card is collapsed
    if (!currentTempEl || !targetTempEl) return;
    
    const currentTemp = entity.attributes.current_temperature;
    const targetTemp = entity.attributes.temperature;
    
    currentTempEl.textContent = 
        (currentTemp !== undefined && currentTemp !== null) ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    targetTempEl.textContent = 
        (targetTemp !== undefined && targetTemp !== null) ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
    
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
    if (currentTempEl && entityState.attributes.current_temperature !== undefined) {
        currentTempEl.textContent = `${entityState.attributes.current_temperature.toFixed(1)}${temperatureUnit}`;
    }
    
    // Update target temperature
    const targetTempEl = card.querySelector('.target-temp');
    if (targetTempEl && entityState.attributes.temperature !== undefined) {
        targetTempEl.textContent = `${entityState.attributes.temperature.toFixed(1)}${temperatureUnit}`;
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
        currentCell.textContent = currentTemp !== undefined ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    }
    
    if (targetCell) {
        const targetTemp = entityState.attributes?.temperature;
        targetCell.textContent = targetTemp !== undefined ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
    }
    
    // Update scheduled temp if we're viewing a group
    if (scheduledCell && currentGroup && graph) {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const nodes = graph.getNodes();
        
        if (nodes.length > 0) {
            const scheduledTemp = interpolateTemperature(nodes, currentTime);
            scheduledCell.textContent = `${scheduledTemp.toFixed(1)}${temperatureUnit}`;
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
                scheduledCell.textContent = `${scheduledTemp.toFixed(1)}${temperatureUnit}`;
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
            const scheduleToUse = existingSchedule || [{ time: "00:00", temp: 18 }];
            
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
                setTimeout(() => window.location.reload(), 2000);
            } catch (error) {
                console.error('Failed to reload integration:', error);
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
            if (modal) modal.style.display = 'none';
        });
    }
    
    // Add to group modal - confirm
    const addToGroupConfirm = getDocumentRoot().querySelector('#add-to-group-confirm');
    if (addToGroupConfirm) {
        addToGroupConfirm.addEventListener('click', async () => {
            const modal = getDocumentRoot().querySelector('#add-to-group-modal');
            const entityId = modal ? modal.dataset.entityId : null;
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
                await haAPI.addToGroup(groupName, entityId);
                
                // Close modal
                if (modal) modal.style.display = 'none';
                
                // Reload groups
                await loadGroups();
                
                // Reload entity list (entity should disappear from active/disabled)
                await renderEntityList();
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
                
                console.log(`Converting from ${fromUnit} to ${targetUnit}`);
                console.log('Settings before conversion:', JSON.stringify(settings, null, 2));
                
                // Convert all schedules using user-selected units
                await convertAllSchedules(fromUnit, targetUnit);
                
                // Convert min/max settings
                if (settings.min_temp !== undefined) {
                    const oldMin = settings.min_temp;
                    settings.min_temp = convertTemperature(settings.min_temp, fromUnit, targetUnit);
                    console.log(`Converted min_temp: ${oldMin}${fromUnit} → ${settings.min_temp}${targetUnit}`);
                }
                if (settings.max_temp !== undefined) {
                    const oldMax = settings.max_temp;
                    settings.max_temp = convertTemperature(settings.max_temp, fromUnit, targetUnit);
                    console.log(`Converted max_temp: ${oldMax}${fromUnit} → ${settings.max_temp}${targetUnit}`);
                }
                
                // Convert default schedule
                if (settings.defaultSchedule) {
                    console.log('Default schedule before conversion:', settings.defaultSchedule);
                    settings.defaultSchedule = convertScheduleNodes(settings.defaultSchedule, fromUnit, targetUnit);
                    console.log('Default schedule after conversion:', settings.defaultSchedule);
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
        if (!groupData || !groupData.entities) return;
        
        const groupEntities = groupData.entities
            .map(id => climateEntities.find(e => e.entity_id === id))
            .filter(e => e);
        
        if (groupEntities.length === 0) return;
        
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
    
    if (timeInput) timeInput.value = node.time;
    if (tempInput) tempInput.value = node.temp;
    
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
        const button = getDocumentRoot().querySelector('#sync-all');
        button.disabled = true;
        button.textContent = '⟲ Syncing...';
        
        await haAPI.callService('climate_scheduler', 'sync_all', {});
        
        button.textContent = '✓ Synced!';
        setTimeout(() => {
            button.textContent = '⟲ Sync All';
            button.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Failed to sync temperatures:', error);
        alert('Failed to sync temperatures: ' + error.message);
        const button = getDocumentRoot().querySelector('#sync-all');
        button.textContent = '⟲ Sync All';
        button.disabled = false;
    }
}

// Update scheduled temp every minute
setInterval(() => {
    updateScheduledTemp();
    updateAllGroupMemberScheduledTemps();
}, 60000);

// ===== Settings Panel =====

// Default schedule settings
let defaultScheduleSettings = [
    { time: '00:00', temp: 18.0 },
    { time: '07:00', temp: 21.0 },
    { time: '23:00', temp: 18.0 }
];

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
        
        console.log('All schedules converted successfully');
    } catch (error) {
        console.error('Failed to convert schedules:', error);
    }
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
            console.log(`Temperature unit changed from ${savedUnit} to ${temperatureUnit}, converting schedules...`);
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
                    console.log('First time load on Fahrenheit system - converting default schedule from Celsius');
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
        defaultScheduleGraph = new TemperatureGraph(svgElement, temperatureUnit);
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
                defaultScheduleSettings = [
                    { time: '00:00', temp: 18.0 },
                    { time: '07:00', temp: 21.0 },
                    { time: '23:00', temp: 18.0 }
                ];
                
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


