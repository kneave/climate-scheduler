/**
 * Climate Scheduler Custom Panel
 * Modern Home Assistant custom panel implementation (replaces legacy iframe approach)
 */
// Version checking - detect if browser cache is stale
(async function () {
    try {
        const scriptUrl = document.currentScript?.src || new URL(import.meta.url).href;
        const loadedVersion = new URL(scriptUrl).searchParams.get('v');
        // Fetch the current server version
        const response = await fetch('/climate_scheduler/static/.version');
        if (response.ok) {
            const serverVersion = (await response.text()).trim().split(',')[0];
            // Compare versions - check the aren't None and if they don't match, user has stale cache
            if ((loadedVersion && serverVersion) && loadedVersion !== serverVersion) {
                console.warn('[Climate Scheduler] Version mismatch detected. Loaded:', loadedVersion, 'Server:', serverVersion);
                // Store in sessionStorage to avoid showing repeatedly
                const notificationKey = 'climate_scheduler_refresh_shown';
                const shownVersion = sessionStorage.getItem(notificationKey);
                if (shownVersion !== serverVersion) {
                    // Show persistent notification
                    const event = new CustomEvent('hass-notification', {
                        bubbles: true,
                        cancelable: false,
                        composed: true,
                        detail: {
                            message: 'Climate Scheduler has been updated. Please refresh your browser (Ctrl+F5 or Cmd+Shift+R) to load the new version.',
                            duration: 0 // Persistent notification
                        }
                    });
                    document.body.dispatchEvent(event);
                    // Mark as shown for this session
                    sessionStorage.setItem(notificationKey, serverVersion);
                    console.info('[Climate Scheduler] Refresh notification displayed');
                }
            }
        }
    }
    catch (e) {
        console.warn('[Climate Scheduler] Version check failed:', e);
    }
})();
// Load other JavaScript files
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
    });
};
// Track if scripts are loaded
let scriptsLoaded = false;
const getVersion = () => {
    const scriptUrl = import.meta.url;
    const version = new URL(scriptUrl).searchParams.get('v');
    if (!version)
        return null;
    // If version has comma (dev: "tag,timestamp"), use timestamp for cache busting
    if (version.includes(',')) {
        const parts = version.split(',');
        return parts[1]; // timestamp
    }
    // Otherwise use version as-is (HACS tag or production tag)
    return version;
};
// Load dependencies in order
const loadScripts = () => {
    if (scriptsLoaded)
        return Promise.resolve();
    // Determine base path from where panel.js was loaded
    const scriptUrl = import.meta.url;
    const url = new URL(scriptUrl);
    // Remove panel.js and query params to get base path
    const basePath = url.origin + url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    const version = getVersion();
    return Promise.all([
        loadScript(`${basePath}/utils.js?v=${version}`),
        loadScript(`${basePath}/ha-api.js?v=${version}`)
    ]).then(() => {
        return loadScript(`${basePath}/app.js?v=${version}`);
    }).then(() => {
        scriptsLoaded = true;
    }).catch(error => {
        console.error('Failed to load Climate Scheduler scripts:', error);
        throw error;
    });
};
class ClimateSchedulerPanel extends HTMLElement {
    constructor() {
        super();
        this._hass = null;
        this.narrow = false;
        this.panel = null;
    }
    // Declare properties that Home Assistant looks for
    static get properties() {
        return {
            hass: { type: Object },
            narrow: { type: Boolean },
            route: { type: Object },
            panel: { type: Object }
        };
    }
    async connectedCallback() {
        this.render();
        // Store reference to this panel element globally so app.js can query within it
        window.climateSchedulerPanelRoot = this;
        // Wait for scripts to load before initializing
        try {
            await loadScripts();
            // Small delay to ensure DOM is fully rendered
            await new Promise(resolve => setTimeout(resolve, 100));
            // Update version info in footer
            const versionElement = this.querySelector('#version-info');
            if (versionElement) {
                try {
                    const scriptUrl = import.meta.url;
                    const versionParam = new URL(scriptUrl).searchParams.get('v');
                    let version = '';
                    if (versionParam) {
                        if (versionParam.includes(',')) {
                            // Has timestamp - dev deployment: "tag,timestamp"
                            const parts = versionParam.split(',');
                            const tag = (parts[0] || 'unknown').replace(/^v/, '');
                            version = `v${tag} (dev)`;
                        }
                        else {
                            // No timestamp - production: just tag
                            const tag = versionParam.replace(/^v/, '');
                            version = `v${tag}`;
                        }
                    }
                    else {
                        version = '(manual)';
                    }
                    versionElement.textContent = `Climate Scheduler ${version}`;
                }
                catch (e) {
                    console.warn('Failed to determine version:', e);
                    versionElement.textContent = 'Climate Scheduler';
                }
            }
            // Initialize the app when panel is loaded and scripts are ready
            if (window.initClimateSchedulerApp) {
                window.initClimateSchedulerApp(this.hass);
            }
        }
        catch (error) {
            console.error('Failed to initialize Climate Scheduler:', error);
        }
    }
    set hass(value) {
        this._hass = value;
        // Apply theme based on Home Assistant theme mode
        if (value && value.themes) {
            const isDark = value.themes.darkMode;
            if (isDark) {
                // Dark mode is default, remove attribute
                document.documentElement.removeAttribute('data-theme');
                this.removeAttribute('data-theme');
            }
            else {
                // Light mode needs explicit attribute
                document.documentElement.setAttribute('data-theme', 'light');
                this.setAttribute('data-theme', 'light');
            }
        }
        // Pass hass object to app if it's already initialized
        if (window.updateHassConnection && value) {
            window.updateHassConnection(value);
        }
    }
    get hass() {
        return this._hass;
    }
    render() {
        if (!this.querySelector('.container')) {
            // Load CSS using same base path detection as scripts
            const scriptUrl = import.meta.url;
            const url = new URL(scriptUrl);
            const basePath = url.origin + url.pathname.substring(0, url.pathname.lastIndexOf('/'));
            const version = getVersion();
            const styleLink = document.createElement('link');
            styleLink.rel = 'stylesheet';
            styleLink.href = `${basePath}/styles.css?v=${version}`;
            this.appendChild(styleLink);
            // Create container div for content
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="container">
                    <section class="entity-selector">
                        <div class="groups-section">
                            <h3 class="section-title">Monitored (<span id="groups-count">0</span>)</h3>
                            <div id="groups-list" class="groups-list">
                                <!-- Dynamically populated with groups -->
                            </div>
                        </div>

                        <div class="profiles-section">
                            <div class="group-container collapsed" id="global-profile-container">
                                <div class="group-header" id="toggle-global-profiles">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="group-toggle-icon" style="transform: rotate(-90deg);">▼</span>
                                        <span class="group-title">Profiles</span>
                                    </div>
                                </div>
                                <div id="global-profile-list" style="display: none; padding: 12px 16px;">
                                    <div class="profile-controls">
                                        <select id="profile-dropdown" class="profile-dropdown">
                                            <option value="" disabled selected>Select a profile to edit...</option>
                                        </select>
                                        <button id="new-profile-btn" class="btn-profile" title="Create new profile">＋</button>
                                        <button id="rename-profile-btn" class="btn-profile" title="Rename profile">✎</button>
                                        <button id="delete-profile-btn" class="btn-profile" title="Delete profile">🗑</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="ignored-section">
                            <div class="group-container collapsed" id="ignored-container">
                                <div class="group-header" id="toggle-ignored">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="group-toggle-icon" style="transform: rotate(-90deg);">▼</span>
                                        <span class="group-title">Unmonitored</span>
                                    </div>
                                </div>
                                <div id="ignored-entity-list" class="entity-list ignored-list" style="display: none;">
                                    <div class="filter-box">
                                        <input type="text" id="ignored-filter" placeholder="Filter by name..." />
                                    </div>
                                    <div id="ignored-entities-container">
                                        <span id="ignored-count" style="display: none;">0</span>
                                        <!-- Dynamically populated -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Modals -->
                    <div id="confirm-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3>Clear Schedule?</h3>
                            </div>
                            <div class="modal-body">
                                <p>Are you sure you want to clear the entire schedule for <strong id="confirm-entity-name"></strong>?</p>
                                <p>This action cannot be undone.</p>
                            </div>
                            <div class="modal-actions">
                                <button id="confirm-cancel" class="btn-secondary">Cancel</button>
                                <button id="confirm-clear" class="btn-danger">Clear Schedule</button>
                            </div>
                        </div>
                    </div>

                    <div id="create-group-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3>Create New Group</h3>
                            </div>
                            <div class="modal-body">
                                <label for="new-group-name">Group Name:</label>
                                <input type="text" id="new-group-name" placeholder="e.g., Bedrooms" style="width: 100%; padding: 8px; margin-top: 8px;" />
                            </div>
                            <div class="modal-actions">
                                <button id="create-group-cancel" class="btn-secondary">Cancel</button>
                                <button id="create-group-confirm" class="btn-primary">Create Group</button>
                            </div>
                        </div>
                    </div>

                    <div id="add-to-group-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3>Add to Group</h3>
                            </div>
                            <div class="modal-body">
                                <p>Add <strong id="add-entity-name"></strong> to group:</p>
                                <select id="add-to-group-select" style="width: 100%; padding: 8px; margin-top: 8px; margin-bottom: 8px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                                    <!-- Populated dynamically -->
                                </select>
                                <p style="text-align: center; color: var(--text-secondary); margin: 8px 0;">or</p>
                                <input type="text" id="new-group-name-inline" placeholder="Create new group..." style="width: 100%; padding: 8px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;" />
                            </div>
                            <div class="modal-actions">
                                <button id="add-to-group-cancel" class="btn-secondary">Cancel</button>
                                <button id="add-to-group-confirm" class="btn-primary">Add to Group</button>
                            </div>
                        </div>
                    </div>

                    <div id="convert-temperature-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3>Convert All Schedules</h3>
                            </div>
                            <div class="modal-body">
                                <p style="margin-bottom: 16px;">This will convert all saved schedules (entities and groups) as well as the default schedule and min/max settings.</p>
                                
                                <div style="margin-bottom: 16px;">
                                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Current unit (convert FROM):</label>
                                    <div style="display: flex; gap: 16px;">
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="radio" name="convert-from-unit" value="°C" id="convert-from-celsius" style="cursor: pointer;">
                                            <span>Celsius (°C)</span>
                                        </label>
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="radio" name="convert-from-unit" value="°F" id="convert-from-fahrenheit" style="cursor: pointer;">
                                            <span>Fahrenheit (°F)</span>
                                        </label>
                                    </div>
                                </div>
                                
                                <div style="margin-bottom: 16px;">
                                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Target unit (convert TO):</label>
                                    <div style="display: flex; gap: 16px;">
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="radio" name="convert-to-unit" value="°C" id="convert-to-celsius" style="cursor: pointer;">
                                            <span>Celsius (°C)</span>
                                        </label>
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                            <input type="radio" name="convert-to-unit" value="°F" id="convert-to-fahrenheit" style="cursor: pointer;">
                                            <span>Fahrenheit (°F)</span>
                                        </label>
                                    </div>
                                </div>
                                
                                <p style="color: var(--warning, #ff9800); font-size: 0.9rem;"><strong>Warning:</strong> This action cannot be undone. Make sure you select the correct source and target units.</p>
                            </div>
                            <div class="modal-actions">
                                <button id="convert-temperature-cancel" class="btn-secondary">Cancel</button>
                                <button id="convert-temperature-confirm" class="btn-primary">Convert Schedules</button>
                            </div>
                        </div>
                    </div>

                    <div id="edit-group-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3>Edit Group</h3>
                            </div>
                            <div class="modal-body">
                                <label for="edit-group-name">Group Name:</label>
                                <input type="text" id="edit-group-name" placeholder="Group name" style="width: 100%; padding: 8px; margin-top: 8px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;" />
                            </div>
                            <div class="modal-actions">
                                <button id="edit-group-delete" class="btn-danger">Delete Group</button>
                                <div style="flex: 1;"></div>
                                <button id="edit-group-cancel" class="btn-secondary">Cancel</button>
                                <button id="edit-group-save" class="btn-primary">Save</button>
                            </div>
                        </div>
                    </div>

                    <!-- Instructions Section (Collapsible) -->
                    <div class="instructions-container">
                        <div id="global-instructions-toggle" class="instructions-toggle">
                            <span class="toggle-icon">▶</span>
                            <span class="toggle-text">Instructions</span>
                        </div>
                        <div id="global-graph-instructions" class="graph-instructions collapsed" style="display: none;">
                            <p>📍 <strong>Double-click or double-tap</strong> the line to add a new node</p>
                            <p>👆 <strong>Drag nodes</strong> vertically to change temperature or horizontally to move their time</p>
                            <p>⬌ <strong>Drag the horizontal segment</strong> between two nodes to shift that period while preserving its duration</p>
                            <p>📋 <strong>Copy / Paste</strong> buttons duplicate a schedule across days or entities</p>
                            <p>⚙️ <strong>Tap a node</strong> to open its settings panel for HVAC/fan/swing/preset values</p>
                        </div>
                    </div>

                    <!-- Settings Panel -->
                    <div id="settings-panel" class="settings-panel collapsed">
                        <div class="settings-header" id="settings-toggle">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="collapse-indicator" style="transform: rotate(-90deg);">▼</span>
                                <h3>Settings</h3>
                            </div>
                        </div>
                        <div class="settings-content">
                            <div class="settings-flex" style="display: flex; gap: 24px; align-items: flex-start;">
                                <div class="settings-main" style="flex: 1; min-width: 0;">
                                    <div class="settings-section">
                                        <h4>Group Management</h4>
                                        <button id="create-group-btn" class="btn-secondary" style="width: 100%;">
                                            + Create New Group
                                        </button>
                                    </div>
                                    
                                    <div class="settings-section">
                                        <h4>Default Schedule</h4>
                                        <p class="settings-description">Set the default temperature schedule used when clearing or creating new schedules</p>
                                        
                                        <div class="graph-container">
                                            <keyframe-timeline id="default-schedule-graph" class="temperature-graph" showHeader="false"></keyframe-timeline>
                                        </div>
                                        
                                        <div style="margin-top: 8px;">
                                            <button id="clear-default-schedule-btn" class="btn-danger-outline">Clear Schedule</button>
                                        </div>
                                        
                                        <div id="default-node-settings-panel" class="node-settings-panel" style="display: none;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                <h4>Node Settings</h4>
                                                <button id="default-delete-node-btn" class="btn-danger-outline" style="padding: 4px 12px; font-size: 0.9rem;">Delete Node</button>
                                            </div>
                                            <div class="node-info">
                                                <span>Time: <strong id="default-node-time">--:--</strong></span>
                                                <span>Temperature: <strong id="default-node-temp">--°C</strong></span>
                                            </div>
                                            
                                            <div class="setting-item" id="default-hvac-mode-item">
                                                <label for="default-node-hvac-mode">HVAC Mode:</label>
                                                <select id="default-node-hvac-mode"><option value="">-- No Change --</option></select>
                                            </div>
                                            
                                            <div class="setting-item" id="default-fan-mode-item">
                                                <label for="default-node-fan-mode">Fan Mode:</label>
                                                <select id="default-node-fan-mode"><option value="">-- No Change --</option></select>
                                            </div>
                                            
                                            <div class="setting-item" id="default-swing-mode-item">
                                                <label for="default-node-swing-mode">Swing Mode:</label>
                                                <select id="default-node-swing-mode"><option value="">-- No Change --</option></select>
                                            </div>
                                            
                                            <div class="setting-item" id="default-preset-mode-item">
                                                <label for="default-node-preset-mode">Preset Mode:</label>
                                                <select id="default-node-preset-mode"><option value="">-- No Change --</option></select>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="settings-section">
                                        <h4>Graph Options</h4>
                                        <div class="setting-row" style="display:flex; gap:18px; align-items:flex-start; flex-wrap: wrap;">
                                            <div class="setting-item" style="flex:1; min-width:280px;">
                                                <label for="tooltip-mode">Tooltip Display:</label>
                                                <select id="tooltip-mode">
                                                    <option value="history">Show Historical Temperature</option>
                                                    <option value="cursor">Show Cursor Position</option>
                                                </select>
                                                <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">Choose what information to display when hovering over the graph</p>
                                            </div>
                                            <div style="display:flex; gap:12px; align-items:center;">
                                                <div style="display:flex; flex-direction:column; gap:6px;">
                                                    <label for="min-temp" style="font-weight:600;">Min Temp (<span id="min-unit">°C</span>)</label>
                                                    <input id="min-temp" type="number" step="0.1" placeholder="e.g. 5.0" style="width:120px; padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;" />
                                                </div>
                                                <div style="display:flex; flex-direction:column; gap:6px;">
                                                    <label for="max-temp" style="font-weight:600;">Max Temp (<span id="max-unit">°C</span>)</label>
                                                    <input id="max-temp" type="number" step="0.1" placeholder="e.g. 30.0" style="width:120px; padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;" />
                                                </div>
                                            </div>
                                        </div>
                                        <div class="setting-item" style="margin-top: 12px;">
                                            <label>
                                                <input type="checkbox" id="debug-panel-toggle" style="margin-right: 8px;"> Show Debug Panel
                                            </label>
                                        </div>
                                    </div>
                                    
                                    <div class="settings-section">
                                        <h4>Temperature Precision</h4>
                                        <div class="setting-row" style="display:flex; gap:18px; align-items:flex-start; flex-wrap: wrap;">
                                            <div class="setting-item" style="flex:1; min-width:280px;">
                                                <label for="graph-snap-step">Graph Snap Step:</label>
                                                <select id="graph-snap-step" style="padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;">
                                                    <option value="0.1">0.1°</option>
                                                    <option value="0.5">0.5°</option>
                                                    <option value="1">1.0°</option>
                                                </select>
                                                <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">Temperature rounding when dragging nodes on the graph</p>
                                            </div>
                                            <div class="setting-item" style="flex:1; min-width:280px;">
                                                <label for="input-temp-step">Input Field Step:</label>
                                                <select id="input-temp-step" style="padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;">
                                                    <option value="0.1">0.1°</option>
                                                    <option value="0.5">0.5°</option>
                                                    <option value="1">1.0°</option>
                                                </select>
                                                <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">Step size for temperature input fields and up/down buttons</p>
                                            </div>
                                            <div class="setting-item" style="flex:1; min-width:280px;">
                                                <label for="humidity-step">Humidity Slider Step:</label>
                                                <select id="humidity-step" style="padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;">
                                                    <option value="1">1%</option>
                                                    <option value="2">2%</option>
                                                    <option value="5">5%</option>
                                                </select>
                                                <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">Step size for humidity slider in node settings dialog</p>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="settings-section">
                                        <h4>Derivative Sensors</h4>
                                        <p class="settings-description">Automatically create sensors to track heating/cooling rates for performance analysis</p>
                                        <div class="setting-item" style="max-width: 100%;">
                                            <label>
                                                <input type="checkbox" id="create-derivative-sensors" style="margin-right: 8px;"> Auto-create derivative sensors
                                            </label>
                                            <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">When enabled, creates sensor.climate_scheduler_[name]_rate for each thermostat to track temperature change rate (°C/h)</p>
                                        </div>
                                    </div>
                                    
                                    <div class="settings-section">
                                        <h4>Workday Integration</h4>
                                        <p class="settings-description">Configure which days are workdays for 5/2 mode scheduling</p>
                                        <div class="setting-item" style="max-width: 100%;">
                                            <label id="use-workday-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                                <input type="checkbox" id="use-workday-integration" style="margin-right: 8px;" disabled> 
                                                <span>Use Workday integration for 5/2 scheduling</span>
                                            </label>
                                            <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;" id="workday-help-text">Checking if Workday integration is installed...</p>
                                        </div>
                                        
                                        <div id="workday-selector" style="margin-top: 16px; display: none;">
                                            <label style="display: block; margin-bottom: 8px; font-weight: 600;">Select Workdays:</label>
                                            <p class="settings-description" style="margin-bottom: 8px; font-size: 0.85rem;">Choose which days are considered workdays when Workday integration is disabled</p>
                                            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="mon" style="cursor: pointer;">
                                                    <span>Monday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="tue" style="cursor: pointer;">
                                                    <span>Tuesday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="wed" style="cursor: pointer;">
                                                    <span>Wednesday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="thu" style="cursor: pointer;">
                                                    <span>Thursday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="fri" style="cursor: pointer;">
                                                    <span>Friday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="sat" style="cursor: pointer;">
                                                    <span>Saturday</span>
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface-light); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">
                                                    <input type="checkbox" class="workday-checkbox" value="sun" style="cursor: pointer;">
                                                    <span>Sunday</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- right column removed: min/max now inline in Graph Options -->
                            </div>

                            <div class="settings-actions" style="margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap;">
                                <button id="refresh-entities-menu" class="btn-secondary">Refresh Entities</button>
                                <button id="sync-all-menu" class="btn-secondary">Sync All Thermostats</button>
                                <button id="reload-integration-menu" class="btn-secondary">Reload Integration</button>
                                <button id="convert-temperature-btn" class="btn-secondary">Convert All Schedules...</button>
                                <button id="run-diagnostics-btn" class="btn-secondary">Run Diagnostics</button>
                                <button id="cleanup-derivative-sensors-btn" class="btn-secondary">Cleanup Derivative Sensors</button>
                                <button id="cleanup-orphaned-climate-btn" class="btn-secondary">Cleanup Orphaned Entities</button>
                                <button id="cleanup-storage-btn" class="btn-secondary">Cleanup Unmonitored Storage</button>
                                <button id="reset-defaults" class="btn-secondary">Reset to Defaults</button>
                            </div>
                        </div>
                    </div>

                    <!-- Debug Panel -->
                    <div id="debug-panel" class="debug-panel" style="display: none;">
                        <div class="debug-header">
                            <h3>Debug Console</h3>
                            <button id="clear-debug" class="btn-secondary" style="padding: 4px 8px; font-size: 0.85rem;">Clear</button>
                        </div>
                        <div id="debug-content" class="debug-content">
                            <!-- Debug messages will appear here -->
                        </div>
                    </div>

                    <footer>
                        <img alt="Integration Usage" src="https://img.shields.io/badge/dynamic/json?color=41BDF5&logo=home-assistant&label=integration%20usage&suffix=%20installs&cacheSeconds=15600&url=https://analytics.home-assistant.io/custom_integrations.json&query=$.climate_scheduler.total" />
                            <p><span id="version-info">Climate Scheduler</span>, created by <a href="https://neave.engineering" target="_blank" rel="noopener noreferrer" style="color: var(--primary)">Keegan Neave</a></p>
                            <p><a href="https://www.buymeacoffee.com/kneave" target="_blank" rel="noopener noreferrer" style="color: var(--primary);">☕ Buy me a coffee</a></p>
                        </div>
                    </footer>
                </div>
            `;
            this.appendChild(container);
        }
    }
}
customElements.define('climate-scheduler-panel', ClimateSchedulerPanel);
//# sourceMappingURL=panel.js.map
