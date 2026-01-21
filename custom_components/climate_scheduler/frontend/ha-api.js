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
        return states.filter(state => 
            state.entity_id.startsWith('climate.') && 
            !state.entity_id.startsWith('climate.climate_scheduler_')
        );
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
                schedule_id: entityId
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
            schedule_id: entityId,
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
            schedule_id: entityId
        });
    }
    
    async disableSchedule(entityId) {
        return await this.callService('climate_scheduler', 'disable_schedule', {
            schedule_id: entityId
        });
    }
    
    async advanceSchedule(entityId) {
        return await this.callService('climate_scheduler', 'advance_schedule', {
            schedule_id: entityId
        });
    }
    
    async advanceGroup(groupName) {
        return await this.callService('climate_scheduler', 'advance_group', {
            schedule_id: groupName
        });
    }
    
    async cancelAdvance(entityId) {
        return await this.callService('climate_scheduler', 'cancel_advance', {
            schedule_id: entityId
        });
    }
    
    async getAdvanceStatus(entityId) {
        try {
            const result = await this.callService('climate_scheduler', 'get_advance_status', {
                schedule_id: entityId
            }, true);
            // Normalize across modes:
            // - hass.callWS path returns `result.response`
            // - websocket path may return `{response: ...}`
            return result?.response ?? result;
        } catch (error) {
            console.error('Failed to get advance status:', error);
            return { is_active: false, history: [] };
        }
    }
    
    async clearAdvanceHistory(entityId) {
        return await this.callService('climate_scheduler', 'clear_advance_history', {
            schedule_id: entityId
        });
    }
    
    async testFireEvent(groupName, node, day) {
        return await this.callService('climate_scheduler', 'test_fire_event', {
            schedule_id: groupName,
            node: JSON.stringify(node),
            day: day
        });
    }

    
    async getOverrideStatus(entityId) {
        try {
            const result = await this.callService('climate_scheduler', 'get_override_status', {
                schedule_id: entityId
            }, true);
            return result;
        } catch (error) {
            console.error('Failed to get override status:', error);
            return { has_override: false };
        }
    }
    
    async clearSchedule(entityId) {
        return await this.callService('climate_scheduler', 'clear_schedule', {
            schedule_id: entityId
        });
    }
    
    async setIgnored(entityId, ignored) {
        return await this.callService('climate_scheduler', 'set_ignored', {
            schedule_id: entityId,
            ignored: ignored
        });
    }
    
    // Group management methods
    async createGroup(groupName) {
        return await this.callService('climate_scheduler', 'create_group', {
            schedule_id: groupName
        });
    }
    
    async deleteGroup(groupName) {
        return await this.callService('climate_scheduler', 'delete_group', {
            schedule_id: groupName
        });
    }
    
    async renameGroup(oldName, newName) {
        return await this.callService('climate_scheduler', 'rename_group', {
            old_name: oldName,
            new_name: newName
        });
    }
    
    async addToGroup(groupName, entityId) {
        return await this.callService('climate_scheduler', 'add_to_group', {
            schedule_id: groupName,
            entity_id: entityId
        });
    }
    
    async removeFromGroup(groupName, entityId) {
        return await this.callService('climate_scheduler', 'remove_from_group', {
            schedule_id: groupName,
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
        const callStartTime = performance.now();
        console.debug('[HA-API] setGroupSchedule called', {
            timestamp: new Date().toISOString(),
            groupName,
            nodeCount: nodes?.length,
            day,
            scheduleMode,
            usingHassObject: this.usingHassObject
        });
        
        // Guard: ensure a valid groupName is provided before calling HA service.
        if (!groupName) {
            const msg = 'setGroupSchedule called without a valid groupName';
            console.error('[HA-API]', msg, groupName, nodes, day, scheduleMode);
            // Throw so callers can handle the error rather than sending null to HA
            throw new Error(msg);
        }

        const serviceData = {
            schedule_id: groupName,
            nodes: nodes
        };
        
        if (day) {
            serviceData.day = day;
        }
        if (scheduleMode) {
            serviceData.schedule_mode = scheduleMode;
        }
        
        console.debug('[HA-API] Calling climate_scheduler.set_group_schedule', {
            serviceData: { ...serviceData, nodes: `[${nodes?.length} nodes]` },
            connectionMode: this.usingHassObject ? 'hass-object' : 'websocket'
        });
        
        try {
            const result = await this.callService('climate_scheduler', 'set_group_schedule', serviceData);
            console.debug('[HA-API] set_group_schedule succeeded', {
                duration: (performance.now() - callStartTime).toFixed(2) + 'ms',
                result
            });
            return result;
        } catch (error) {
            console.error('[HA-API] setGroupSchedule failed:', {
                error,
                errorCode: error?.code,
                errorMessage: error?.message,
                translationKey: error?.translation_key,
                translationPlaceholders: error?.translation_placeholders,
                groupName,
                duration: (performance.now() - callStartTime).toFixed(2) + 'ms',
                connectionMode: this.usingHassObject ? 'hass-object' : 'websocket'
            });
            throw error;
        }
    }
    
    async enableGroup(groupName) {
        return await this.callService('climate_scheduler', 'enable_group', {
            schedule_id: groupName
        });
    }
    
    async disableGroup(groupName) {
        return await this.callService('climate_scheduler', 'disable_group', {
            schedule_id: groupName
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

            // Normalize across execution modes:
            // - In custom panel mode, callService(..., true) returns the service response directly.
            // - In raw websocket mode, callService may return { response: <service_response> }.
            const payload = result?.response ?? result ?? {};

            // Service response includes version metadata, but app.js expects the raw settings dict.
            // If the response shape is { settings: {...}, version: {...} }, return settings.
            if (
                payload &&
                typeof payload === 'object' &&
                payload.version &&
                payload.settings &&
                typeof payload.settings === 'object'
            ) {
                return payload.settings;
            }

            return payload;
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
    
    async cleanupDerivativeSensors(confirmDeleteAll = false) {
        try {
            const result = await this.callService('climate_scheduler', 'cleanup_derivative_sensors', {
                confirm_delete_all: confirmDeleteAll
            }, true);
            return result?.response || result || {};
        } catch (error) {
            console.error('Failed to cleanup derivative sensors:', error);
            throw error;
        }
    }
    
    async cleanupOrphanedClimateEntities(deleteEntities = false) {
        try {
            const result = await this.callService('climate_scheduler', 'cleanup_orphaned_climate_entities', {
                delete: deleteEntities
            }, true);
            return result?.response || result || {};
        } catch (error) {
            console.error('Failed to cleanup orphaned climate entities:', error);
            throw error;
        }
    }
    
    // Profile management methods
    async createProfile(scheduleId, profileName) {
        return await this.callService('climate_scheduler', 'create_profile', {
            schedule_id: scheduleId,
            profile_name: profileName
        });
    }
    
    async deleteProfile(scheduleId, profileName) {
        return await this.callService('climate_scheduler', 'delete_profile', {
            schedule_id: scheduleId,
            profile_name: profileName
        });
    }
    
    async renameProfile(scheduleId, oldName, newName) {
        return await this.callService('climate_scheduler', 'rename_profile', {
            schedule_id: scheduleId,
            old_name: oldName,
            new_name: newName
        });
    }
    
    async setActiveProfile(scheduleId, profileName) {
        return await this.callService('climate_scheduler', 'set_active_profile', {
            schedule_id: scheduleId,
            profile_name: profileName
        });
    }
    
    async getProfiles(scheduleId) {
        try {
            const result = await this.callService('climate_scheduler', 'get_profiles', {
                schedule_id: scheduleId
            }, true);
            return result;
        } catch (error) {
            console.error('Failed to get profiles:', error);
            return { profiles: {}, active_profile: null };
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
