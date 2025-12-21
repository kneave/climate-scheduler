/**
 * Climate Scheduler Custom Panel
 * Modern Home Assistant custom panel implementation (replaces legacy iframe approach)
 */

// Load other JavaScript files
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

// Track if scripts are loaded
let scriptsLoaded = false;

const getVersion = () => {
    const scriptUrl = import.meta.url;
    const version = new URL(scriptUrl).searchParams.get('v');
    if (!version) return null;
    
    // If version has comma (dev: "tag,timestamp"), use timestamp for cache busting
    if (version.includes(',')) {
        const parts = version.split(',');
        return parts[1]; // timestamp
    }
    // Otherwise use version as-is (HACS tag or production tag)
    return version;
}

// Load dependencies in order
const loadScripts = () => {
    if (scriptsLoaded) return Promise.resolve();
    
    // Use absolute URL to avoid path resolution issues when loaded in different contexts
    const protocol = window.location.protocol;
    const host = window.location.host;
    const basePath = `${protocol}//${host}/local/community/climate-scheduler-card`;
    const version = getVersion();
    
    console.log('Loading Climate Scheduler scripts from:', basePath);
    
    return Promise.all([
        loadScript(`${basePath}/graph.js?v=${version}`),
        loadScript(`${basePath}/ha-api.js?v=${version}`)
    ]).then(() => {
        return loadScript(`${basePath}/app.js?v=${version}`);
    }).then(() => {
        scriptsLoaded = true;
        console.log('Climate Scheduler scripts loaded successfully');
    }).catch(error => {
        console.error('Failed to load Climate Scheduler scripts:', error);
        throw error;
    });
};

class ClimateSchedulerPanel extends HTMLElement {
    constructor() {
        super();
        this.hass = null;
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
                    
                    let cardVersion = '';
                    
                    if (versionParam) {
                        if (versionParam.includes(',')) {
                            // Has timestamp - dev deployment: "tag,timestamp"
                            const parts = versionParam.split(',');
                            const tag = (parts[0] || 'unknown').replace(/^v/, '');
                            cardVersion = `v${tag} (dev)`;
                        } else {
                            // No timestamp - HACS or production: just tag
                            const tag = versionParam.replace(/^v/, '');
                            cardVersion = `v${tag}`;
                        }
                    } else {
                        cardVersion = '(manual)';
                    }
                    
                    versionElement.textContent = `Climate Scheduler Card ${cardVersion}`;
                } catch (e) {
                    console.warn('Failed to determine version:', e);
                    versionElement.textContent = 'Climate Scheduler Card';
                }
            }

            // Initialize the app when panel is loaded and scripts are ready
            if (window.initClimateSchedulerApp) {
                window.initClimateSchedulerApp(this.hass);
            }
        } catch (error) {
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
            } else {
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
        if (!this.innerHTML) {
            // Load CSS into light DOM using absolute URL
            const protocol = window.location.protocol;
            const host = window.location.host;
            const version = getVersion();
            const styleLink = document.createElement('link');
            styleLink.rel = 'stylesheet';
            styleLink.href = `${protocol}//${host}/local/community/climate-scheduler-card/styles.css?v=${version}`;
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
                            <button id="create-group-btn" class="btn-primary" style="margin-top: 10px; width: 100%;">
                                + Create New Group
                            </button>
                        </div>
                        
                        <div class="ignored-section">
                            <button id="toggle-ignored" class="ignored-toggle">
                                <span class="toggle-icon">▶</span>
                                <span class="toggle-text">Unmonitored (<span id="ignored-count">0</span>)</span>
                            </button>
                            <div id="ignored-entity-list" class="entity-list ignored-list" style="display: none;">
                                <div class="filter-box">
                                    <input type="text" id="ignored-filter" placeholder="Filter by name..." />
                                </div>
                                <div id="ignored-entities-container">
                                    <!-- Dynamically populated -->
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

                    <!-- Settings Panel -->
                    <div id="settings-panel" class="settings-panel collapsed">
                        <div class="settings-header" id="settings-toggle">
                            <h3>⚙️ Settings</h3>
                            <span class="collapse-indicator">▼</span>
                        </div>
                        <div class="settings-content">
                            <div class="settings-flex" style="display: flex; gap: 24px; align-items: flex-start;">
                                <div class="settings-main" style="flex: 1; min-width: 0;">
                                    <div class="settings-section">
                                        <h4>Default Schedule</h4>
                                        <p class="settings-description">Set the default temperature schedule used when clearing or creating new schedules</p>
                                        
                                        <div class="graph-container">
                                            <svg id="default-schedule-graph" class="temperature-graph"></svg>
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
                                        <div class="setting-row" style="display:flex; gap:18px; align-items:flex-start;">
                                            <div class="setting-item" style="flex:1; min-width:220px;">
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
                                                    <input id="min-temp" type="number" step="0.5" placeholder="e.g. 5.0" style="width:120px; padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;" />
                                                </div>
                                                <div style="display:flex; flex-direction:column; gap:6px;">
                                                    <label for="max-temp" style="font-weight:600;">Max Temp (<span id="max-unit">°C</span>)</label>
                                                    <input id="max-temp" type="number" step="0.5" placeholder="e.g. 30.0" style="width:120px; padding:6px; background: var(--surface-light); color: var(--text-primary); border: 1px solid var(--border); border-radius:6px;" />
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
                                        <h4>Derivative Sensors</h4>
                                        <p class="settings-description">Automatically create sensors to track heating/cooling rates for performance analysis</p>
                                        <div class="setting-item">
                                            <label>
                                                <input type="checkbox" id="create-derivative-sensors" style="margin-right: 8px;"> Auto-create derivative sensors
                                            </label>
                                            <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">When enabled, creates sensor.climate_scheduler_[name]_rate for each thermostat to track temperature change rate (°C/h)</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- right column removed: min/max now inline in Graph Options -->
                            </div>

                            <div class="settings-actions" style="margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap;">
                                <button id="refresh-entities-menu" class="btn-secondary">↻ Refresh Entities</button>
                                <button id="sync-all-menu" class="btn-secondary">⟲ Sync All Thermostats</button>
                                <button id="reload-integration-menu" class="btn-secondary">🔄 Reload Integration (Dev)</button>
                                <button id="convert-temperature-btn" class="btn-secondary">Convert All Schedules...</button>
                                <button id="cleanup-derivative-sensors-btn" class="btn-secondary">🧹 Cleanup Derivative Sensors</button>
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
                        <p id="version-info">Climate Scheduler</p>
                            <div class="panel-footer" style="margin-top: 16px; text-align: center;">
                                <img alt="Integration Usage" src="https://img.shields.io/badge/dynamic/json?color=41BDF5&logo=home-assistant&label=integration%20usage&suffix=%20installs&cacheSeconds=15600&url=https://analytics.home-assistant.io/custom_integrations.json&query=$.climate_scheduler.total" />
                            </div>
                    </footer>
                </div>
            `;
            
            this.appendChild(container);
        }
    }
}

customElements.define('climate-scheduler-panel', ClimateSchedulerPanel);
