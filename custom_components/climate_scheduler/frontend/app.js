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

// Initialize application
async function initApp() {
    try {
        // Initialize Home Assistant API
        haAPI = new HomeAssistantAPI();
        await haAPI.connect();
        console.log('Connected to Home Assistant');
        
        // Get Home Assistant configuration for temperature unit
        const config = await haAPI.getConfig();
        if (config && config.unit_system && config.unit_system.temperature) {
            temperatureUnit = config.unit_system.temperature === '°F' ? '°F' : '°C';
            console.log(`Temperature unit: ${temperatureUnit}`);
        }
        
        // Initialize temperature graph
        const svgElement = document.getElementById('temperature-graph');
        graph = new TemperatureGraph(svgElement, temperatureUnit);
        
        // Listen for graph changes
        svgElement.addEventListener('nodesChanged', handleGraphChange);
        svgElement.addEventListener('nodeSettings', handleNodeSettings);
        
        // Load climate entities
        console.log('ABOUT TO CALL loadClimateEntities');
        await loadClimateEntities();
        console.log('AFTER loadClimateEntities');
        
        // Load all schedules from backend
        await loadAllSchedules();
        
        // Subscribe to state changes
        await haAPI.subscribeToStateChanges();
        haAPI.onStateUpdate(handleStateUpdate);
        
        // Set up UI event listeners
        setupEventListeners();
        
        console.log('Application initialized');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        alert('Failed to connect to Home Assistant. Please refresh the page.');
    }
}

// Load all climate entities
async function loadClimateEntities() {
    console.log('=== loadClimateEntities CALLED ===');
    try {
        climateEntities = await haAPI.getClimateEntities();
        console.log('Got climate entities:', climateEntities.length);
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
            
            if (schedule && schedule.nodes && schedule.nodes.length > 0) {
                // Entity has a schedule - add to Map
                entitySchedules.set(entity.entity_id, schedule.nodes);
                console.log(`Added schedule for ${entity.entity_id}:`, schedule.nodes);
            } else {
                console.log(`No valid schedule for ${entity.entity_id}`);
            }
        }
        
        // Re-render entity list with loaded schedules
        await renderEntityList();
        
        console.log(`Loaded ${entitySchedules.size} schedules from backend`);
    } catch (error) {
        console.error('Failed to load schedules:', error);
    }
}

// Render entity list
async function renderEntityList() {
    console.log('=== renderEntityList CALLED ===');
    
    try {
        const entityList = document.getElementById('entity-list');
        const disabledEntityContainer = document.getElementById('disabled-entities-container');
        const activeCount = document.getElementById('active-count');
        const disabledCount = document.getElementById('disabled-count');
        
        entityList.innerHTML = '';
        disabledEntityContainer.innerHTML = '';
        
        if (climateEntities.length === 0) {
            entityList.innerHTML = '<p style="color: #b0b0b0; padding: 20px; text-align: center;">No climate entities found</p>';
            return;
        }
        
        // Use local state to check which entities are included
        const includedEntities = new Set(entitySchedules.keys());
        console.log('entitySchedules Map size:', entitySchedules.size);
        console.log('entitySchedules Map keys:', Array.from(entitySchedules.keys()));
        console.log('includedEntities Set:', Array.from(includedEntities));
    
        let activeEntitiesCount = 0;
        let disabledEntitiesCount = 0;
        
        // Get filter value
        const filterInput = document.getElementById('disabled-filter');
        const filterText = filterInput ? filterInput.value.toLowerCase() : '';
        
        climateEntities.forEach(entity => {
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
                // Apply filter to disabled entities
                const entityName = (entity.attributes.friendly_name || entity.entity_id).toLowerCase();
                if (!filterText || entityName.includes(filterText)) {
                    disabledEntityContainer.appendChild(card);
                }
                disabledEntitiesCount++;
                
                // Update selection state if this is the current entity
                if (currentEntityId === entity.entity_id) {
                    card.classList.add('selected');
                }
            }
        });
        
        // Update counts
        activeCount.textContent = activeEntitiesCount;
        disabledCount.textContent = disabledEntitiesCount;
        
        // Show/hide sections based on content
        const activeSection = document.querySelector('.active-section');
        const disabledSection = document.querySelector('.disabled-section');
        
        console.log('renderEntityList: activeCount =', activeEntitiesCount, 'disabledCount =', disabledEntitiesCount);
        console.log('activeSection element:', activeSection);
        
        if (!activeSection) {
            alert('ERROR: active-section element not found!');
            return;
        }
        
        activeSection.style.display = 'block';
        disabledSection.style.display = 'block';
        
        console.log('Set activeSection.style.display to block');
        
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
    
    // Checkbox for inclusion
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'entity-checkbox';
    checkbox.checked = isIncluded;
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card selection when clicking checkbox
    });
    checkbox.addEventListener('change', async (e) => {
        e.stopPropagation(); // Prevent any bubbling
        const willBeIncluded = e.target.checked;
        
        // Temporarily disable checkbox to prevent double-clicks
        checkbox.disabled = true;
        
        await toggleEntityInclusion(entity.entity_id, willBeIncluded);
        
        // Re-enable after operation completes
        checkbox.disabled = false;
    });
    
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'entity-checkbox-wrapper';
    checkboxWrapper.appendChild(checkbox);
    
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
    
    card.appendChild(checkboxWrapper);
    card.appendChild(content);
    
    content.addEventListener('click', () => {
        // Allow selection for any entity (clicking to edit)
        selectEntity(entity.entity_id);
    });
    
    return card;
}

// Select an entity to edit
async function selectEntity(entityId) {
    currentEntityId = entityId;
    
    // Update UI
    const entityCards = document.querySelectorAll('.entity-card');
    entityCards.forEach(card => {
        if (card.dataset.entityId === entityId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Show schedule editor
    const editor = document.getElementById('schedule-editor');
    editor.style.display = 'block';
    
    // Update entity name
    const entity = climateEntities.find(e => e.entity_id === entityId);
    const entityName = document.getElementById('current-entity-name');
    entityName.textContent = entity ? entity.attributes.friendly_name : entityId;
    
    // Load schedule
    await loadEntitySchedule(entityId);
    
    // Load history data
    await loadHistoryData(entityId);
    
    // Update entity status
    updateEntityStatus(entity);
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
        
        if (!historyResult || historyResult.length === 0) {
            console.log('No history data available');
            graph.setHistoryData([]);
            return;
        }
        
        // Process history data - extract current_temperature
        const historyData = [];
        const stateHistory = historyResult[0] || [];
        
        for (const state of stateHistory) {
            const temp = parseFloat(state.attributes.current_temperature);
            if (!isNaN(temp)) {
                const stateTime = new Date(state.last_updated);
                const hours = stateTime.getHours().toString().padStart(2, '0');
                const minutes = stateTime.getMinutes().toString().padStart(2, '0');
                const timeStr = `${hours}:${minutes}`;
                
                historyData.push({
                    time: timeStr,
                    temp: temp
                });
            }
        }
        
        console.log(`Loaded ${historyData.length} history points`);
        graph.setHistoryData(historyData);
    } catch (error) {
        console.error('Failed to load history data:', error);
        graph.setHistoryData([]);
    }
}

// Save schedule (auto-save, no alerts)
async function saveSchedule() {
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
        
        console.log('Schedule auto-saved for', currentEntityId);
    } catch (error) {
        console.error('Failed to auto-save schedule:', error);
    }
}

// Handle graph changes - auto-save and sync if needed
async function handleGraphChange(event) {
    updateScheduledTemp();
    await saveSchedule();
    
    // Check if we need to update the thermostat immediately
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
    
    // Get current entity
    const entity = climateEntities.find(e => e.entity_id === currentEntityId);
    if (!entity) return;
    
    const currentTarget = entity.attributes.temperature;
    
    // If scheduled temp is different from current target, update immediately
    if (Math.abs(scheduledTemp - currentTarget) > 0.1) {
        console.log(`Scheduled temp (${scheduledTemp}°C) differs from target (${currentTarget}°C), updating immediately`);
        try {
            await haAPI.callService('climate', 'set_temperature', {
                entity_id: currentEntityId,
                temperature: scheduledTemp
            });
            console.log(`Updated ${currentEntityId} to ${scheduledTemp}°C`);
        } catch (error) {
            console.error('Failed to update thermostat:', error);
        }
    }
    
    // Apply HVAC mode if specified
    if (activeNode.hvac_mode && entity.attributes.hvac_mode !== activeNode.hvac_mode) {
        console.log(`Setting HVAC mode to ${activeNode.hvac_mode}`);
        try {
            await haAPI.callService('climate', 'set_hvac_mode', {
                entity_id: currentEntityId,
                hvac_mode: activeNode.hvac_mode
            });
        } catch (error) {
            console.error('Failed to set HVAC mode:', error);
        }
    }
    
    // Apply fan mode if specified
    if (activeNode.fan_mode && entity.attributes.fan_mode !== activeNode.fan_mode) {
        console.log(`Setting fan mode to ${activeNode.fan_mode}`);
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
    if (activeNode.swing_mode && entity.attributes.swing_mode !== activeNode.swing_mode) {
        console.log(`Setting swing mode to ${activeNode.swing_mode}`);
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
    if (activeNode.preset_mode && entity.attributes.preset_mode !== activeNode.preset_mode) {
        console.log(`Setting preset mode to ${activeNode.preset_mode}`);
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
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const nodes = graph.getNodes();
    
    if (nodes.length > 0) {
        const temp = interpolateTemperature(nodes, currentTime);
        document.getElementById('scheduled-temp').textContent = `${temp.toFixed(1)}${temperatureUnit}`;
    } else {
        document.getElementById('scheduled-temp').textContent = '--';
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
    
    const currentTemp = entity.attributes.current_temperature;
    const targetTemp = entity.attributes.temperature;
    
    document.getElementById('current-temp').textContent = 
        currentTemp !== undefined ? `${currentTemp.toFixed(1)}${temperatureUnit}` : '--';
    document.getElementById('target-temp').textContent = 
        targetTemp !== undefined ? `${targetTemp.toFixed(1)}${temperatureUnit}` : '--';
}

// Handle state updates from Home Assistant
function handleStateUpdate(data) {
    console.log('=== handleStateUpdate ===', data.entity_id);
    const entityId = data.entity_id;
    const newState = data.new_state;
    
    if (!entityId || !newState || !entityId.startsWith('climate.')) return;
    
    // Update entity in list
    const entityIndex = climateEntities.findIndex(e => e.entity_id === entityId);
    if (entityIndex !== -1) {
        climateEntities[entityIndex] = newState;
        console.log('Calling renderEntityList from handleStateUpdate');
        renderEntityList();
    }
    
    // Update current entity status if selected
    if (entityId === currentEntityId) {
        updateEntityStatus(newState);
    }
}

// Toggle entity inclusion in scheduler
async function toggleEntityInclusion(entityId, include) {
    console.log('=== toggleEntityInclusion ===', entityId, include);
    try {
        if (include) {
            // Check if entity already has a schedule in backend
            let existingSchedule = null;
            try {
                const result = await haAPI.getSchedule(entityId);
                const schedule = result?.response || result;
                if (schedule && schedule.nodes && schedule.nodes.length > 0) {
                    existingSchedule = schedule.nodes;
                    console.log('Found existing schedule for', entityId);
                }
            } catch (err) {
                console.log('No existing schedule found:', err);
            }
            
            // Use existing schedule or create default
            const scheduleToUse = existingSchedule || [{ time: "00:00", temp: 18 }];
            console.log('Setting schedule for', entityId);
            
            // Add to local state immediately with a unique copy for each entity
            entitySchedules.set(entityId, JSON.parse(JSON.stringify(scheduleToUse)));
            console.log('Added to entitySchedules Map. Size now:', entitySchedules.size);
            console.log('Map now contains:', Array.from(entitySchedules.keys()));
            
            // If no existing schedule, persist the default to HA
            if (!existingSchedule) {
                haAPI.setSchedule(entityId, scheduleToUse).catch(err => {
                    console.error('Failed to persist schedule to HA:', err);
                });
            }
            
            // Re-render to move to active list
            await renderEntityList();
            console.log('toggleEntityInclusion complete');
        } else {
            // When disabling, just disable it but keep the schedule data
            entitySchedules.delete(entityId);
            console.log('Removed from entitySchedules Map');
            
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
    
    // Menu items
    document.getElementById('refresh-entities-menu').addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        loadClimateEntities();
    });
    
    document.getElementById('sync-all-menu').addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        syncAllTemperatures();
    });
    
    document.getElementById('schedule-enabled').addEventListener('change', () => {
        // Auto-save when enabled state changes
        saveSchedule();
    });
    
    // Toggle disabled entities section
    document.getElementById('toggle-disabled').addEventListener('click', () => {
        const disabledList = document.getElementById('disabled-entity-list');
        const toggleIcon = document.querySelector('.toggle-icon');
        
        if (disabledList.style.display === 'none') {
            disabledList.style.display = 'flex';
            toggleIcon.classList.add('expanded');
        } else {
            disabledList.style.display = 'none';
            toggleIcon.classList.remove('expanded');
        }
    });
    
    // Filter disabled entities
    document.getElementById('disabled-filter').addEventListener('input', () => {
        renderEntityList();
    });
    
    // Clear schedule button and confirmation modal
    document.getElementById('clear-schedule-btn').addEventListener('click', () => {
        if (!currentEntityId) return;
        
        const entity = climateEntities.find(e => e.entity_id === currentEntityId);
        const entityName = entity ? entity.attributes.friendly_name : currentEntityId;
        
        document.getElementById('confirm-entity-name').textContent = entityName;
        document.getElementById('confirm-modal').style.display = 'flex';
    });
    
    document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.getElementById('confirm-modal').style.display = 'none';
    });
    
    document.getElementById('confirm-clear').addEventListener('click', async () => {
        document.getElementById('confirm-modal').style.display = 'none';
        
        if (!currentEntityId) return;
        
        try {
            // Clear schedule from HA
            await haAPI.clearSchedule(currentEntityId);
            
            // Remove from local state
            entitySchedules.delete(currentEntityId);
            
            // Set default empty schedule
            graph.setNodes([{ time: '00:00', temp: 18 }]);
            
            // Close editor and refresh list
            currentEntityId = null;
            document.getElementById('schedule-editor').style.display = 'none';
            await renderEntityList();
            
            console.log('Schedule cleared successfully');
        } catch (error) {
            console.error('Failed to clear schedule:', error);
            alert('Failed to clear schedule. Please try again.');
        }
    });
    
    // Close modal when clicking outside
    document.getElementById('confirm-modal').addEventListener('click', (e) => {
        if (e.target.id === 'confirm-modal') {
            document.getElementById('confirm-modal').style.display = 'none';
        }
    });
    
    // Settings panel close handler
    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('node-settings-panel').style.display = 'none';
    });
    
    // Delete node from settings panel
    document.getElementById('delete-node').addEventListener('click', () => {
        const panel = document.getElementById('node-settings-panel');
        const nodeIndex = parseInt(panel.dataset.nodeIndex);
        if (!isNaN(nodeIndex) && graph) {
            graph.removeNodeByIndex(nodeIndex);
            panel.style.display = 'none';
        }
    });
    
    // Save node settings
    document.getElementById('save-node-settings').addEventListener('click', () => {
        const panel = document.getElementById('node-settings-panel');
        const nodeIndex = parseInt(panel.dataset.nodeIndex);
        if (isNaN(nodeIndex) || !graph) return;
        
        const nodes = graph.getNodes();
        const node = nodes[nodeIndex];
        if (!node) return;
        
        // Update node with new settings (only if available)
        const hvacModeSelect = document.getElementById('node-hvac-mode');
        const fanModeSelect = document.getElementById('node-fan-mode');
        
        if (hvacModeSelect.closest('.setting-item').style.display !== 'none') {
            const hvacMode = hvacModeSelect.value;
            if (hvacMode) node.hvac_mode = hvacMode;
        }
        
        if (fanModeSelect.closest('.setting-item').style.display !== 'none') {
            const fanMode = fanModeSelect.value;
            if (fanMode) node.fan_mode = fanMode;
        }
        
        const swingModeSelect = document.getElementById('node-swing-mode');
        if (swingModeSelect.closest('.setting-item').style.display !== 'none') {
            const swingMode = swingModeSelect.value;
            if (swingMode) node.swing_mode = swingMode;
        }
        
        const presetModeSelect = document.getElementById('node-preset-mode');
        if (presetModeSelect.closest('.setting-item').style.display !== 'none') {
            const presetMode = presetModeSelect.value;
            if (presetMode) node.preset_mode = presetMode;
        }
        
        // Update graph
        graph.setNodes(nodes);
        
        // Close panel
        panel.style.display = 'none';
        
        // This will trigger save and immediate update if needed
        graph.notifyChange();
    });
}

// Handle node settings panel
function handleNodeSettings(event) {
    const { nodeIndex, node } = event.detail;
    const entity = climateEntities.find(e => e.entity_id === currentEntityId);
    if (!entity) return;
    
    // Update panel content
    document.getElementById('node-time').textContent = node.time;
    document.getElementById('node-temp').textContent = `${node.temp}${temperatureUnit}`;
    
    // Populate HVAC mode dropdown
    const hvacModeSelect = document.getElementById('node-hvac-mode');
    const hvacModeItem = hvacModeSelect.closest('.setting-item');
    hvacModeSelect.innerHTML = '';
    
    const hvacModes = entity.attributes.hvac_modes;
    if (hvacModes && hvacModes.length > 0) {
        hvacModeItem.style.display = '';
        hvacModeSelect.disabled = false;
        hvacModes.forEach(mode => {
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
    
    const fanModes = entity.attributes.fan_modes;
    if (fanModes && fanModes.length > 0) {
        fanModeItem.style.display = '';
        fanModeSelect.disabled = false;
        fanModes.forEach(mode => {
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
    
    const swingModes = entity.attributes.swing_modes;
    if (swingModes && swingModes.length > 0) {
        swingModeItem.style.display = '';
        swingModeSelect.disabled = false;
        swingModes.forEach(mode => {
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
    
    const presetModes = entity.attributes.preset_modes;
    if (presetModes && presetModes.length > 0) {
        presetModeItem.style.display = '';
        presetModeSelect.disabled = false;
        presetModes.forEach(mode => {
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
setInterval(updateScheduledTemp, 60000);

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
