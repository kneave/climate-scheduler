/**
 * Main Application Logic
 * Connects the UI components with the Home Assistant API
 */

let haAPI;
let graph;
let currentEntityId = null;
let climateEntities = [];
let entitySchedules = new Map(); // Track which entities have schedules locally
let temperatureUnit = '°C'; // Default to Celsius, updated from HA config
let allGroups = {}; // Store all groups data
let currentGroup = null; // Currently selected group

// Initialize application
async function initApp() {
    try {
        // Detect mobile app environment
        const isMobileApp = /HomeAssistant|Home%20Assistant/.test(navigator.userAgent);
        if (isMobileApp) {
            console.log('Running in Home Assistant mobile app');
        }
        
        // Initialize Home Assistant API
        haAPI = new HomeAssistantAPI();
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
        const container = document.querySelector('.container');
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
        console.log('renderEntityList completed');
    } catch (error) {
        console.error('Failed to load climate entities:', error);
        alert('Failed to load climate entities');
    }
}

// Load all schedules from backend to populate entitySchedules Map
async function loadAllSchedules() {
    console.log('=== Loading all schedules from backend ===');
    try {
        // Load schedules for all entities
        for (const entity of climateEntities) {
            console.log(`Fetching schedule for ${entity.entity_id}...`);
            const result = await haAPI.getSchedule(entity.entity_id);
            console.log(`Got result for ${entity.entity_id}:`, result);
            
            // Extract schedule from response wrapper
            const schedule = result?.response || result;
            console.log(`Extracted schedule for ${entity.entity_id}:`, schedule);
            
            // Only add to entitySchedules if it has nodes AND is enabled
            if (schedule && schedule.nodes && schedule.nodes.length > 0 && schedule.enabled) {
                // Entity has an enabled schedule - add to Map
                entitySchedules.set(entity.entity_id, schedule.nodes);
                console.log(`Added schedule for ${entity.entity_id}:`, schedule.nodes);
            } else {
                console.log(`No valid enabled schedule for ${entity.entity_id}`);
            }
        }
        
        // Re-render entity list with loaded schedules
        await renderEntityList();
        
        console.log(`Loaded ${entitySchedules.size} schedules from backend`);
    } catch (error) {
        console.error('Failed to load schedules:', error);
    }
}

// Load all groups from backend
async function loadGroups() {
    console.log('Loading groups from backend...');
    try {
        const result = await haAPI.getGroups();
        console.log('Raw result from getGroups:', result);
        
        // Extract groups from response - may be wrapped in response.groups
        let groups = result?.response || result || {};
        
        // If there's a 'groups' key, use that instead
        if (groups.groups && typeof groups.groups === 'object') {
            groups = groups.groups;
        }
        
        console.log('Parsed groups object:', groups);
        allGroups = groups;
        console.log('allGroups after assignment:', allGroups);
        console.log('Group names:', Object.keys(allGroups));
        
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
    const groupsList = document.getElementById('groups-list');
    const groupsCount = document.getElementById('groups-count');
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
async function editGroupSchedule(groupName) {
    const groupData = allGroups[groupName];
    if (!groupData) return;
    
    // Collapse all other editors first
    collapseAllEditors();
    
    // Set current group and clear entity selection
    currentGroup = groupName;
    currentEntityId = null;
    
    // Find the group container
    const groupContainer = document.querySelector(`.group-container[data-group-name="${groupName}"]`);
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
        
        // Connect undo button
        const undoBtn = editor.querySelector('#undo-btn');
        if (undoBtn) {
            graph.setUndoButton(undoBtn);
        }
        
        // Attach graph event listeners
        svgElement.addEventListener('nodesChanged', handleGraphChange);
        svgElement.addEventListener('nodeSettings', handleNodeSettings);
    }
    
    // Load schedule nodes into editor
    if (groupData.nodes && groupData.nodes.length > 0) {
        currentSchedule = groupData.nodes.map(n => ({...n}));
        graph.setNodes(currentSchedule);
    } else {
        // Start with empty schedule
        currentSchedule = [];
        graph.setNodes([{ time: '00:00', temp: 18 }]);
    }
    
    // Load history data for all entities in the group
    await loadGroupHistoryData(groupData.entities);
    console.log('Group history loaded for entities:', groupData.entities);
    
    // Group schedules don't have enabled/disabled state - hide the toggle
    const scheduleEnabled = editor.querySelector('#schedule-enabled');
    if (scheduleEnabled) {
        scheduleEnabled.checked = true;
        scheduleEnabled.closest('.toggle-switch').style.display = 'none';
    }
    
    updateScheduledTemp();
    
    // Reattach event listeners
    attachEditorEventListeners(editor);
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
    const existingTable = document.querySelector('.group-members-table');
    if (existingTable) {
        existingTable.remove();
    }
    
    const table = createGroupMembersTable(entityIds);
    if (!table) return;
    
    // Insert table before graph container
    const graphContainer = document.querySelector('.graph-container');
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
        
        console.log(`Removed ${entityId} from group ${groupName}`);
    } catch (error) {
        console.error('Failed to remove entity from group:', error);
        alert('Failed to remove entity from group');
    }
}

// Show add to group modal
function showAddToGroupModal(entityId) {
    const modal = document.getElementById('add-to-group-modal');
    const select = document.getElementById('add-to-group-select');
    
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

// Render entity list
async function renderEntityList() {
    try {
        const entityList = document.getElementById('entity-list');
        const ignoredEntityContainer = document.getElementById('ignored-entities-container');
        const activeCount = document.getElementById('active-count');
        const ignoredCount = document.getElementById('ignored-count');
        
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
        const filterInput = document.getElementById('ignored-filter');
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
        const activeSection = document.querySelector('.active-section');
        const ignoredSection = document.querySelector('.ignored-section');
        
        if (!activeSection) {
            alert('ERROR: active-section element not found!');
            return;
        }
        
        activeSection.style.display = 'block';
        ignoredSection.style.display = 'block';
        
        // Show message if no active entities
        if (activeEntitiesCount === 0) {
            entityList.innerHTML = '<p style="color: #b0b0b0; padding: 20px; text-align: center;">No active thermostats. Check boxes below to enable.</p>';
        }
    
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
    temp.textContent = currentTemp !== undefined 
        ? `${targetTemp.toFixed(1)}${temperatureUnit} (${currentTemp.toFixed(1)}${temperatureUnit})` 
        : 'N/A';
    
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
                <button id="undo-btn" class="btn-secondary-outline" title="Undo last change (Ctrl+Z)" disabled>Undo</button>
                <button id="ignore-entity-btn" class="btn-secondary-outline" title="Disable this thermostat">Ignore</button>
                <button id="clear-schedule-btn" class="btn-danger-outline" title="Clear entire schedule">Clear Schedule</button>
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

        <div class="graph-container">
            <div class="graph-wrapper">
                <svg id="temperature-graph" viewBox="0 0 800 400">
                    <!-- Dynamically generated -->
                </svg>
                
                <!-- Node Settings Panel (inline below graph) -->
                <div id="node-settings-panel" class="node-settings-panel" style="display: none;">
                    <div class="settings-header">
                        <h3>Node Settings</h3>
                        <button id="close-settings" class="btn-close-settings">✕</button>
                    </div>
                    <div class="settings-grid">
                        <div class="setting-item">
                            <label>Time:</label>
                            <span id="node-time" class="setting-value">--:--</span>
                        </div>
                        <div class="setting-item">
                            <label>Temperature:</label>
                            <span id="node-temp" class="setting-value">--°C</span>
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
                <p>📍 <strong>Tap</strong> on the graph to add a temperature point</p>
                <p>👆 <strong>Drag</strong> points to adjust time/temperature</p>
                <p>⚙️ <strong>Tap</strong> a point to edit settings</p>
            </div>
        </div>
    `;
    return editor;
}

// Collapse all editors
function collapseAllEditors() {
    const allEditors = document.querySelectorAll('.schedule-editor-inline');
    allEditors.forEach(editor => editor.remove());
    
    // Remove all close buttons
    const allCloseButtons = document.querySelectorAll('.close-entity-btn');
    allCloseButtons.forEach(btn => btn.remove());
    
    const allCards = document.querySelectorAll('.entity-card');
    allCards.forEach(card => card.classList.remove('selected', 'expanded'));
    
    const allGroupContainers = document.querySelectorAll('.group-container');
    allGroupContainers.forEach(container => container.classList.remove('expanded'));
}

// Select an entity to edit
async function selectEntity(entityId) {
    // Collapse all other editors first
    collapseAllEditors();
    
    currentEntityId = entityId;
    currentGroup = null; // Clear group selection when selecting entity
    
    // Find the entity card
    const entityCard = document.querySelector(`.entity-card[data-entity-id="${entityId}"]`);
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
        
        // Connect undo button
        const undoBtn = editor.querySelector('#undo-btn');
        if (undoBtn) {
            graph.setUndoButton(undoBtn);
        }
        
        // Attach graph event listeners
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
    
    // Clear schedule button
    const clearBtn = editorElement.querySelector('#clear-schedule-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            if (!currentEntityId) return;
            
            const entity = climateEntities.find(e => e.entity_id === currentEntityId);
            const entityName = entity ? entity.attributes.friendly_name : currentEntityId;
            
            if (confirm(`Clear schedule for ${entityName}?`)) {
                clearScheduleForEntity(currentEntityId);
            }
        };
    }
    
    // Schedule enabled toggle
    const enabledToggle = editorElement.querySelector('#schedule-enabled');
    if (enabledToggle) {
        enabledToggle.onchange = () => saveSchedule();
    }
    
    // Node settings panel close
    const closeSettings = editorElement.querySelector('#close-settings');
    if (closeSettings) {
        closeSettings.onclick = () => {
            const panel = editorElement.querySelector('#node-settings-panel');
            if (panel) panel.style.display = 'none';
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
}

// Clear schedule for an entity
async function clearScheduleForEntity(entityId) {
    try {
        // Clear schedule from HA
        await haAPI.clearSchedule(entityId);
        
        // Remove from local state
        entitySchedules.delete(entityId);
        
        // Set default empty schedule
        if (graph) {
            graph.setNodes([{ time: '00:00', temp: 18 }]);
        }
        
        // Close editor and refresh list
        collapseAllEditors();
        currentEntityId = null;
        await renderEntityList();
    } catch (error) {
        console.error('Failed to clear schedule:', error);
        alert('Failed to clear schedule. Please try again.');
    }
}

// Load schedule for entity
async function loadEntitySchedule(entityId) {
    try {
        // Check local state first
        let schedule;
        if (entitySchedules.has(entityId)) {
            schedule = { nodes: entitySchedules.get(entityId) };
        } else {
            const result = await haAPI.getSchedule(entityId);
            // Extract schedule from response wrapper
            schedule = result?.response || result;
        }
        
        if (schedule && schedule.nodes) {
            graph.setNodes(schedule.nodes);
            document.getElementById('schedule-enabled').checked = schedule.enabled !== false;
        } else {
            // Load default schedule - 18°C all day
            graph.setNodes([
                { time: '00:00', temp: 18 }
            ]);
            document.getElementById('schedule-enabled').checked = true;
        }
        
        updateScheduledTemp();
    } catch (error) {
        console.error('Failed to load schedule:', error);
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
    
    console.log('Loading history for entities:', entityIds);
    
    try {
        // Get start of today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Get current time
        const now = new Date();
        
        console.log('Fetching history from', today, 'to', now);
        
        const allHistoryData = [];
        const defaultColors = ['#2196f3', '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ffeb3b', '#795548'];
        
        // Load history for each entity
        for (let i = 0; i < entityIds.length; i++) {
            const entityId = entityIds[i];
            const entity = climateEntities.find(e => e.entity_id === entityId);
            
            try {
                const historyResult = await haAPI.getHistory(entityId, today, now);
                console.log(`History result for ${entityId}:`, historyResult);
                
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
                    
                    console.log(`Processed ${historyData.length} history points for ${entityId}`);
                    
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
        
        console.log('Setting history data with', allHistoryData.length, 'entities');
        graph.setHistoryData(allHistoryData);
    } catch (error) {
        console.error('Failed to load group history data:', error);
        graph.setHistoryData([]);
    }
}

// Save schedule (auto-save, no alerts)
async function saveSchedule() {
    // Check if we're editing a group schedule
    if (currentGroup) {
        try {
            const nodes = graph.getNodes();
            
            // Save to group schedule
            await haAPI.setGroupSchedule(currentGroup, nodes);
        } catch (error) {
            console.error('Failed to auto-save group schedule:', error);
        }
        return;
    }
    
    // Otherwise save individual entity schedule
    if (!currentEntityId) return;
    
    try {
        const nodes = graph.getNodes();
        const enabled = document.getElementById('schedule-enabled').checked;
        
        // Update local state immediately with the current entity's schedule
        entitySchedules.set(currentEntityId, JSON.parse(JSON.stringify(nodes)));
        
        // Save schedule to HA in background
        await haAPI.setSchedule(currentEntityId, nodes);
        
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
    // If event has detail.force, use that
    if (event && event.detail && event.detail.force !== undefined) {
        force = event.detail.force;
    }
    
    updateScheduledTemp();
    await saveSchedule();
    
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
                        console.log(`Updated ${entityId} to ${scheduledTemp}°C`);
                    } catch (error) {
                        console.error(`Failed to update ${entityId}:`, error);
                    }
                }
                
                // Apply HVAC mode if specified and entity supports it
                if (activeNode.hvac_mode && entity.attributes.hvac_modes && 
                    entity.attributes.hvac_modes.includes(activeNode.hvac_mode)) {
                    const currentHvacMode = entity.state || entity.attributes.hvac_mode;
                    if (force || currentHvacMode !== activeNode.hvac_mode) {
                        console.log(`Group ${currentGroup}: Setting ${entityId} HVAC mode to ${activeNode.hvac_mode}`);
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
                        console.log(`Group ${currentGroup}: Setting ${entityId} fan mode to ${activeNode.fan_mode}`);
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
                        console.log(`Group ${currentGroup}: Setting ${entityId} swing mode to ${activeNode.swing_mode}`);
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
                        console.log(`Group ${currentGroup}: Setting ${entityId} preset mode to ${activeNode.preset_mode}`);
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
    const scheduledTempEl = document.getElementById('scheduled-temp');
    
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
    
    const currentTempEl = document.getElementById('current-temp');
    const targetTempEl = document.getElementById('target-temp');
    
    // Elements may not exist if entity card is collapsed
    if (!currentTempEl || !targetTempEl) return;
    
    const currentTemp = entity.attributes.current_temperature;
    const targetTemp = entity.attributes.temperature;
    
    currentTempEl.textContent = 
        currentTemp !== undefined ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    targetTempEl.textContent = 
        targetTemp !== undefined ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
    
    // Update HVAC mode if available
    const hvacModeEl = document.getElementById('current-hvac-mode');
    const hvacModeItem = document.getElementById('current-hvac-mode-item');
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
    const fanModeEl = document.getElementById('current-fan-mode');
    const fanModeItem = document.getElementById('current-fan-mode-item');
    if (fanModeEl && fanModeItem) {
        if (entity.attributes.fan_mode) {
            fanModeEl.textContent = entity.attributes.fan_mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            fanModeItem.style.display = '';
        } else {
            fanModeItem.style.display = 'none';
        }
    }
    
    // Update swing mode if available
    const swingModeEl = document.getElementById('current-swing-mode');
    const swingModeItem = document.getElementById('current-swing-mode-item');
    if (swingModeEl && swingModeItem) {
        if (entity.attributes.swing_mode) {
            swingModeEl.textContent = entity.attributes.swing_mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            swingModeItem.style.display = '';
        } else {
            swingModeItem.style.display = 'none';
        }
    }
    
    // Update preset mode if available
    const presetModeEl = document.getElementById('current-preset-mode');
    const presetModeItem = document.getElementById('current-preset-mode-item');
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

// Update a single entity card without re-rendering the entire list
function updateEntityCard(entityId, entityState) {
    // Find the card in either the active or ignored entities list
    const card = document.querySelector(`.entity-card[data-entity-id="${entityId}"]`);
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
    const row = document.querySelector(`.group-members-row[data-entity-id="${entityId}"]`);
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
    
    const rows = document.querySelectorAll('.group-members-row');
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
            
            // If no existing schedule, persist the default to HA
            if (!existingSchedule) {
                haAPI.setSchedule(entityId, scheduleToUse).catch(err => {
                    console.error('Failed to persist schedule to HA:', err);
                });
            }
            
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
                document.getElementById('schedule-editor').style.display = 'none';
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
    // Menu button and dropdown
    const menuButton = document.getElementById('menu-button');
    const dropdownMenu = document.getElementById('dropdown-menu');
    
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
    const refreshEntitiesMenu = document.getElementById('refresh-entities-menu');
    if (refreshEntitiesMenu) {
        refreshEntitiesMenu.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.style.display = 'none';
            loadClimateEntities();
        });
    }
    
    const syncAllMenu = document.getElementById('sync-all-menu');
    if (syncAllMenu) {
        syncAllMenu.addEventListener('click', () => {
            if (dropdownMenu) dropdownMenu.style.display = 'none';
            syncAllTemperatures();
        });
    }
    
    // Toggle ignored entities section
    const toggleIgnored = document.getElementById('toggle-ignored');
    const ignoredList = document.getElementById('ignored-entity-list');
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
    const ignoredFilter = document.getElementById('ignored-filter');
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
    const createGroupBtn = document.getElementById('create-group-btn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            const modal = document.getElementById('create-group-modal');
            if (modal) {
                modal.style.display = 'flex';
            }
            const nameInput = document.getElementById('new-group-name');
            if (nameInput) {
                nameInput.value = '';
            }
        });
    }
    
    // Create group modal - cancel
    const createGroupCancel = document.getElementById('create-group-cancel');
    if (createGroupCancel) {
        createGroupCancel.addEventListener('click', () => {
            const modal = document.getElementById('create-group-modal');
            if (modal) modal.style.display = 'none';
        });
    }
    
    // Create group modal - confirm
    const createGroupConfirm = document.getElementById('create-group-confirm');
    if (createGroupConfirm) {
        createGroupConfirm.addEventListener('click', async () => {
            const groupName = document.getElementById('new-group-name').value.trim();
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
                const modal = document.getElementById('create-group-modal');
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
    const addToGroupCancel = document.getElementById('add-to-group-cancel');
    if (addToGroupCancel) {
        addToGroupCancel.addEventListener('click', () => {
            const modal = document.getElementById('add-to-group-modal');
            if (modal) modal.style.display = 'none';
        });
    }
    
    // Add to group modal - confirm
    const addToGroupConfirm = document.getElementById('add-to-group-confirm');
    if (addToGroupConfirm) {
        addToGroupConfirm.addEventListener('click', async () => {
            const modal = document.getElementById('add-to-group-modal');
            const entityId = modal ? modal.dataset.entityId : null;
            const selectElement = document.getElementById('add-to-group-select');
            const groupName = selectElement ? selectElement.value : null;
        
            if (!groupName) {
                alert('Please select a group');
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
    const createGroupModal = document.getElementById('create-group-modal');
    if (createGroupModal) {
        createGroupModal.addEventListener('click', (e) => {
            if (e.target.id === 'create-group-modal') {
                createGroupModal.style.display = 'none';
            }
        });
    }
    
    const addToGroupModal = document.getElementById('add-to-group-modal');
    if (addToGroupModal) {
        addToGroupModal.addEventListener('click', (e) => {
            if (e.target.id === 'add-to-group-modal') {
                addToGroupModal.style.display = 'none';
            }
        });
    }
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
    document.getElementById('node-time').textContent = node.time;
    document.getElementById('node-temp').textContent = `${node.temp}${temperatureUnit}`;
    
    // Populate HVAC mode dropdown
    const hvacModeSelect = document.getElementById('node-hvac-mode');
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
    const fanModeSelect = document.getElementById('node-fan-mode');
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
    const swingModeSelect = document.getElementById('node-swing-mode');
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
    const presetModeSelect = document.getElementById('node-preset-mode');
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
    const panel = document.getElementById('node-settings-panel');
    panel.style.display = 'block';
    panel.dataset.nodeIndex = nodeIndex;
    
    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Sync all thermostats to scheduled temperatures
async function syncAllTemperatures() {
    try {
        const button = document.getElementById('sync-all');
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
        const button = document.getElementById('sync-all');
        button.textContent = '⟲ Sync All';
        button.disabled = false;
    }
}

// Update scheduled temp every minute
setInterval(() => {
    updateScheduledTemp();
    updateAllGroupMemberScheduledTemps();
}, 60000);

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
