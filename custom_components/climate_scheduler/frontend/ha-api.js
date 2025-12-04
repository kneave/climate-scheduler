/**
 * Home Assistant API Integration
 * Handles communication with Home Assistant via WebSocket API
 * Supports both custom panel mode (using hass object) and iframe mode (WebSocket)
 */

class HomeAssistantAPI {
    constructor() {
        this.connection = null;
        this.messageId = 1;
        this.pendingRequests = new Map();
        this.stateUpdateCallbacks = [];
        this.hass = null; // For custom panel mode
        this.usingHassObject = false; // Track which mode we're in
    }
    
    /**
     * Set hass object (custom panel mode)
     */
    setHassObject(hass) {
        this.hass = hass;
        this.usingHassObject = true;
    }
    
    async connect() {
        // If we already have a hass object, we're in custom panel mode
        if (this.hass && this.usingHassObject) {
            console.log('Using existing hass connection from custom panel');
            return Promise.resolve();
        }
        
        try {
            // Get auth token - works in both browser and mobile app
            const authToken = await this.getAuthToken();
            
            // Connect to Home Assistant WebSocket API
            // Use relative path for mobile app compatibility
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/api/websocket`;
            
            this.connection = new WebSocket(wsUrl);
            
            return new Promise((resolve, reject) => {
                this.connection.onopen = () => {
                    console.log('WebSocket connected');
                };
                
                this.connection.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message, authToken, resolve, reject);
                };
                
                this.connection.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    reject(error);
                };
                
                this.connection.onclose = () => {
                    console.log('WebSocket disconnected');
                };
            });
        } catch (error) {
            console.error('Failed to connect:', error);
            throw error;
        }
    }
    
    handleMessage(message, authToken, resolveConnection, rejectConnection) {
        if (message.type === 'auth_required') {
            // Send authentication
            this.send({
                type: 'auth',
                access_token: authToken
            });
        } else if (message.type === 'auth_ok') {
            console.log('Authenticated successfully');
            resolveConnection();
        } else if (message.type === 'auth_invalid') {
            console.error('Authentication failed');
            rejectConnection(new Error('Authentication failed'));
        } else if (message.type === 'result') {
            // Handle response to our request
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                if (message.success) {
                    pending.resolve(message.result);
                } else {
                    pending.reject(message.error);
                }
                this.pendingRequests.delete(message.id);
            }
        } else if (message.type === 'event') {
            // Handle state change events
            if (message.event && message.event.event_type === 'state_changed') {
                this.notifyStateUpdate(message.event.data);
            }
        }
    }
    
    async getAuthToken() {
        // Method 1: Check if running in Home Assistant panel context (works in mobile app)
        if (window.hassConnection) {
            try {
                const auth = await window.hassConnection;
                if (auth && auth.auth && auth.auth.data && auth.auth.data.access_token) {
                    return auth.auth.data.access_token;
                }
            } catch (e) {
                console.warn('Could not get token from hassConnection:', e);
            }
        }
        
        // Method 2: Try to get from parent window context
        if (window.parent && window.parent.hassConnection && window.parent !== window) {
            try {
                const auth = await window.parent.hassConnection;
                if (auth && auth.auth && auth.auth.data && auth.auth.data.access_token) {
                    return auth.auth.data.access_token;
                }
            } catch (e) {
                console.warn('Could not get token from parent.hassConnection:', e);
            }
        }
        
        // Method 3: Fallback to localStorage (browser only)
        try {
            const token = localStorage.getItem('hassTokens');
            if (token) {
                const tokens = JSON.parse(token);
                if (tokens.access_token) {
                    return tokens.access_token;
                }
            }
        } catch (e) {
            console.warn('Could not get token from localStorage:', e);
        }
        
        throw new Error('No authentication token found. Please ensure the panel is loaded within Home Assistant.');
    }
    
    send(message) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(message));
        } else {
            throw new Error('WebSocket not connected');
        }
    }
    
    async sendRequest(message) {
        // If using hass object (custom panel mode), use hass.callWS
        if (this.hass && this.usingHassObject) {
            try {
                return await this.hass.callWS(message);
            } catch (error) {
                console.error('Error calling hass.callWS:', error);
                throw error;
            }
        }
        
        // Fallback to WebSocket mode
        const id = this.messageId++;
        const request = { id, ...message };
        
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.send(request);
            
            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }
    
    async getStates() {
        // Custom panel mode
        if (this.hass && this.usingHassObject) {
            return Object.values(this.hass.states);
        }
        // WebSocket mode
        return await this.sendRequest({ type: 'get_states' });
    }
    
    async getConfig() {
        // Custom panel mode
        if (this.hass && this.usingHassObject) {
            return this.hass.config;
        }
        // WebSocket mode
        return await this.sendRequest({ type: 'get_config' });
    }
    
    async getClimateEntities() {
        const states = await this.getStates();
        return states.filter(state => state.entity_id.startsWith('climate.'));
    }
    
    async callService(domain, service, serviceData, returnResponse = false) {
        // Custom panel mode
        if (this.hass && this.usingHassObject) {
            // Use callWS for return_response to avoid triggering haptic feedback
            if (returnResponse) {
                const result = await this.hass.callWS({
                    type: 'call_service',
                    domain,
                    service,
                    service_data: serviceData,
                    return_response: true
                });
                return result?.response;
            } else {
                // Use callService for non-return-response calls
                return await this.hass.callService(domain, service, serviceData);
            }
        }
        
        // WebSocket mode
        const requestData = {
            type: 'call_service',
            domain,
            service,
            service_data: serviceData
        };
        
        if (returnResponse) {
            requestData.return_response = true;
        }
        
        return await this.sendRequest(requestData);
    }
    
    async setLogLevel(level = 'debug') {
        return await this.callService('logger', 'set_level', {
            'custom_components.climate_scheduler': level
        });
    }
    
    async getSchedule(entityId, day = null) {
        try {
            const serviceData = {
                entity_id: entityId
            };
            
            if (day) {
                serviceData.day = day;
            }
            
            // Call our custom service to get schedule with return_response
            const result = await this.callService('climate_scheduler', 'get_schedule', 
                serviceData, true);  // Pass true to enable return_response
            return result;
        } catch (error) {
            console.error('Failed to get schedule:', error);
            return null;
        }
    }
    
    async setSchedule(entityId, nodes, day = null, scheduleMode = null) {
        const serviceData = {
            entity_id: entityId,
            nodes: nodes
        };
        
        if (day) {
            serviceData.day = day;
        }
        if (scheduleMode) {
            serviceData.schedule_mode = scheduleMode;
        }
        
        return await this.callService('climate_scheduler', 'set_schedule', serviceData);
    }
    
    async enableSchedule(entityId) {
        return await this.callService('climate_scheduler', 'enable_schedule', {
            entity_id: entityId
        });
    }
    
    async disableSchedule(entityId) {
        return await this.callService('climate_scheduler', 'disable_schedule', {
            entity_id: entityId
        });
    }
    
    async clearSchedule(entityId) {
        return await this.callService('climate_scheduler', 'clear_schedule', {
            entity_id: entityId
        });
    }
    
    // Group management methods
    async createGroup(groupName) {
        return await this.callService('climate_scheduler', 'create_group', {
            group_name: groupName
        });
    }
    
    async deleteGroup(groupName) {
        return await this.callService('climate_scheduler', 'delete_group', {
            group_name: groupName
        });
    }
    
    async addToGroup(groupName, entityId) {
        return await this.callService('climate_scheduler', 'add_to_group', {
            group_name: groupName,
            entity_id: entityId
        });
    }
    
    async removeFromGroup(groupName, entityId) {
        return await this.callService('climate_scheduler', 'remove_from_group', {
            group_name: groupName,
            entity_id: entityId
        });
    }
    
    async getGroups() {
        try {
            const result = await this.callService('climate_scheduler', 'get_groups', {}, true);
            return result;
        } catch (error) {
            console.error('Failed to get groups:', error);
            return { groups: {} };
        }
    }
    
    async setGroupSchedule(groupName, nodes, day = null, scheduleMode = null) {
        const serviceData = {
            group_name: groupName,
            nodes: nodes
        };
        
        if (day) {
            serviceData.day = day;
        }
        if (scheduleMode) {
            serviceData.schedule_mode = scheduleMode;
        }
        
        try {
            const result = await this.callService('climate_scheduler', 'set_group_schedule', serviceData);
            return result;
        } catch (error) {
            console.error('setGroupSchedule failed:', error);
            throw error;
        }
    }
    
    async enableGroup(groupName) {
        return await this.callService('climate_scheduler', 'enable_group', {
            group_name: groupName
        });
    }
    
    async disableGroup(groupName) {
        return await this.callService('climate_scheduler', 'disable_group', {
            group_name: groupName
        });
    }
    
    async getHistory(entityId, startTime, endTime) {
        try {
            // Format times as ISO strings
            const start = startTime.toISOString();
            const end = endTime ? endTime.toISOString() : new Date().toISOString();
            
            // Use recorder history API
            const result = await this.sendRequest({
                type: 'history/history_during_period',
                start_time: start,
                end_time: end,
                entity_ids: [entityId],
                minimal_response: false,
                no_attributes: false
            });
            
            return result;
        } catch (error) {
            console.error('Failed to get history:', error);
            return null;
        }
    }
    
    async subscribeToStateChanges() {
        // Custom panel mode - hass object handles state updates automatically
        if (this.hass && this.usingHassObject) {
            // Set up listener for hass state changes
            // The panel will call updateHassConnection when hass changes
            console.log('Using hass object state updates');
            return Promise.resolve();
        }
        
        // WebSocket mode
        return await this.sendRequest({
            type: 'subscribe_events',
            event_type: 'state_changed'
        });
    }
    
    async getSettings() {
        try {
            const result = await this.callService('climate_scheduler', 'get_settings', {}, true);
            return result?.response || result || {};
        } catch (error) {
            console.error('Failed to get settings:', error);
            return {};
        }
    }
    
    async saveSettings(settings) {
        try {
            await this.callService('climate_scheduler', 'save_settings', { settings: JSON.stringify(settings) });
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            throw error;
        }
    }
    
    onStateUpdate(callback) {
        this.stateUpdateCallbacks.push(callback);
    }
    
    notifyStateUpdate(data) {
        this.stateUpdateCallbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error('Error in state update callback:', error);
            }
        });
    }
}
