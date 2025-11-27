/**
 * Home Assistant API Integration
 * Handles communication with Home Assistant via WebSocket API
 */

class HomeAssistantAPI {
    constructor() {
        this.connection = null;
        this.messageId = 1;
        this.pendingRequests = new Map();
        this.stateUpdateCallbacks = [];
    }
    
    async connect() {
        try {
            // Get auth token from parent window (HA provides this)
            const authToken = await this.getAuthToken();
            
            // Connect to Home Assistant WebSocket API
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/websocket`;
            
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
        // Try to get token from parent window if embedded in HA
        if (window.parent && window.parent !== window) {
            try {
                // Post message to parent requesting token
                return new Promise((resolve) => {
                    const messageHandler = (event) => {
                        if (event.data && event.data.type === 'auth_token') {
                            window.removeEventListener('message', messageHandler);
                            resolve(event.data.token);
                        }
                    };
                    window.addEventListener('message', messageHandler);
                    window.parent.postMessage({ type: 'request_auth_token' }, '*');
                    
                    // Fallback: try to get from localStorage after 1 second
                    setTimeout(() => {
                        const token = localStorage.getItem('hassTokens');
                        if (token) {
                            const tokens = JSON.parse(token);
                            resolve(tokens.access_token);
                        }
                    }, 1000);
                });
            } catch (e) {
                console.warn('Could not get token from parent:', e);
            }
        }
        
        // Fallback: get from localStorage
        const token = localStorage.getItem('hassTokens');
        if (token) {
            const tokens = JSON.parse(token);
            return tokens.access_token;
        }
        
        throw new Error('No authentication token found');
    }
    
    send(message) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(message));
        } else {
            throw new Error('WebSocket not connected');
        }
    }
    
    async sendRequest(message) {
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
        return await this.sendRequest({ type: 'get_states' });
    }
    
    async getConfig() {
        return await this.sendRequest({ type: 'get_config' });
    }
    
    async getClimateEntities() {
        const states = await this.getStates();
        return states.filter(state => state.entity_id.startsWith('climate.'));
    }
    
    async callService(domain, service, serviceData, returnResponse = false) {
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
    
    async getSchedule(entityId) {
        try {
            // Call our custom service to get schedule with return_response
            const result = await this.callService('climate_scheduler', 'get_schedule', {
                entity_id: entityId
            }, true);  // Pass true to enable return_response
            return result;
        } catch (error) {
            console.error('Failed to get schedule:', error);
            return null;
        }
    }
    
    async setSchedule(entityId, nodes) {
        return await this.callService('climate_scheduler', 'set_schedule', {
            entity_id: entityId,
            nodes: nodes
        });
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
    
    async setGroupSchedule(groupName, nodes) {
        return await this.callService('climate_scheduler', 'set_group_schedule', {
            group_name: groupName,
            nodes: nodes
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
        return await this.sendRequest({
            type: 'subscribe_events',
            event_type: 'state_changed'
        });
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
