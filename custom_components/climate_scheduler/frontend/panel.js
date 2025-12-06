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

// Load dependencies in order
const loadScripts = () => {
    if (scriptsLoaded) return Promise.resolve();
    
    return Promise.all([
        loadScript('/api/climate_scheduler/graph.js'),
        loadScript('/api/climate_scheduler/ha-api.js')
    ]).then(() => {
        return loadScript('/api/climate_scheduler/app.js');
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
        this.hass = null;
        this.narrow = false;
        this.panel = null;
        
        // Create shadow DOM for style isolation
        this.attachShadow({ mode: 'open' });
    }

    async connectedCallback() {
        this.render();
        
        // Store reference to this panel element globally so app.js can query within it
        window.climateSchedulerPanelRoot = this.shadowRoot;
        
        // Wait for scripts to load before initializing
        try {
            await loadScripts();
            
            // Small delay to ensure DOM is fully rendered
            await new Promise(resolve => setTimeout(resolve, 100));
            
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
        // Pass hass object to app if it's already initialized
        if (window.updateHassConnection && value) {
            window.updateHassConnection(value);
        }
    }

    get hass() {
        return this._hass;
    }

    render() {
        if (!this.shadowRoot.innerHTML) {
            // Get version from panel.js script tag
            const scripts = document.querySelectorAll('script[src*="panel.js"]');
            let version = Date.now();
            for (const script of scripts) {
                const match = script.src.match(/[?&]v=([^&]+)/);
                if (match) {
                    version = match[1];
                    break;
                }
            }
            
            // Load CSS directly into shadow DOM
            const styleLink = document.createElement('link');
            styleLink.rel = 'stylesheet';
            styleLink.href = `/api/climate_scheduler/styles.css?v=${version}`;
            this.shadowRoot.appendChild(styleLink);
            
            // Create container div for content
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="container">
                    <section class="entity-selector">
                        <div class="selector-header">
                            <h2>Climate Entities</h2>
                            <button id="menu-button" class="btn-icon" title="Menu">⋮</button>
                        </div>
                        
                        <div id="dropdown-menu" class="dropdown-menu" style="display: none;">
                            <button id="refresh-entities-menu" class="menu-item">
                                <span class="menu-icon">↻</span>
                                <span>Refresh Entities</span>
                            </button>
                            <button id="sync-all-menu" class="menu-item">
                                <span class="menu-icon">⟲</span>
                                <span>Sync All Thermostats</span>
                            </button>
                            <button id="reload-integration-menu" class="menu-item">
                                <span class="menu-icon">🔄</span>
                                <span>Reload Integration (Dev)</span>
                            </button>
                        </div>
                        
                        <div class="active-section">
                            <h3 class="section-title">Active (<span id="active-count">0</span>)</h3>
                            <div id="entity-list" class="entity-list">
                                <!-- Dynamically populated -->
                            </div>
                        </div>
                        
                        <div class="groups-section">
                            <h3 class="section-title">Groups (<span id="groups-count">0</span>)</h3>
                            <div id="groups-list" class="groups-list">
                                <!-- Dynamically populated -->
                            </div>
                            <button id="create-group-btn" class="btn-primary" style="margin-top: 10px; width: 100%;">
                                + Create New Group
                            </button>
                        </div>
                    </section>

                    <section class="entity-selector ignored-entities-section">
                        <div class="ignored-section">
                            <button id="toggle-ignored" class="ignored-toggle">
                                <span class="toggle-icon">▶</span>
                                <span class="toggle-text">Ignored (<span id="ignored-count">0</span>)</span>
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

                    <!-- Settings Panel -->
                    <div id="settings-panel" class="settings-panel collapsed">
                        <div class="settings-header" id="settings-toggle">
                            <h3>⚙️ Settings</h3>
                            <span class="collapse-indicator">▼</span>
                        </div>
                        <div class="settings-content">
                            <div class="settings-section">
                                <h4>Default Schedule</h4>
                                <p class="settings-description">Set the default temperature schedule used when clearing or creating new schedules</p>
                                
                                <div class="graph-container">
                                    <svg id="default-schedule-graph" class="temperature-graph"></svg>
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
                                <div class="setting-item">
                                    <label for="tooltip-mode">Tooltip Display:</label>
                                    <select id="tooltip-mode">
                                        <option value="history">Show Historical Temperature</option>
                                        <option value="cursor">Show Cursor Position</option>
                                    </select>
                                    <p class="settings-description" style="margin-top: 5px; font-size: 0.85rem;">Choose what information to display when hovering over the graph</p>
                                </div>
                                <div class="setting-item" style="margin-top: 15px;">
                                    <label>
                                        <input type="checkbox" id="debug-panel-toggle" style="margin-right: 8px;"> Show Debug Panel
                                    </label>
                                </div>
                            </div>
                            
                            <div class="settings-actions">
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
            
            this.shadowRoot.appendChild(container);
        }
    }
}

customElements.define('climate-scheduler-panel', ClimateSchedulerPanel);
