/**
 * Shared Utility Functions
 * Common utilities used across the Climate Scheduler frontend
 */

// ============================================================================
// TIMEZONE UTILITIES
// ============================================================================

/**
 * Get a Date-like object in the server's timezone
 * @param {Date} date - The UTC date to convert
 * @param {string} serverTimeZone - The server's timezone (e.g., 'America/New_York')
 * @returns {Object} Date-like object with methods that return values in server timezone
 */
function getServerDate(date, serverTimeZone) {
    if (!serverTimeZone) return date; // Fallback to local time if no timezone set
    
    // Use Intl.DateTimeFormat to get date components in server timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: serverTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const partsObj = {};
    parts.forEach(part => {
        partsObj[part.type] = part.value;
    });
    
    return {
        getFullYear: () => parseInt(partsObj.year),
        getMonth: () => parseInt(partsObj.month) - 1, // JS months are 0-indexed
        getDate: () => parseInt(partsObj.day),
        getHours: () => parseInt(partsObj.hour),
        getMinutes: () => parseInt(partsObj.minute),
        getSeconds: () => parseInt(partsObj.second),
        getTime: () => date.getTime(),
        _originalDate: date
    };
}

/**
 * Get current server time as Date-like object
 * @param {string} serverTimeZone - The server's timezone
 * @returns {Object} Date-like object with current time in server timezone
 */
function getServerNow(serverTimeZone) {
    return getServerDate(new Date(), serverTimeZone);
}

/**
 * Convert UTC timestamp to server timezone Date-like object
 * @param {Date} utcDate - The UTC date to convert
 * @param {string} serverTimeZone - The server's timezone
 * @returns {Object} Date-like object in server timezone
 */
function utcToServerDate(utcDate, serverTimeZone) {
    return getServerDate(utcDate, serverTimeZone);
}

// ============================================================================
// TEMPERATURE CONVERSION UTILITIES
// ============================================================================

/**
 * Convert Celsius to Fahrenheit
 * @param {number} celsius - Temperature in Celsius
 * @returns {number} Temperature in Fahrenheit
 */
function celsiusToFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
}

/**
 * Convert Fahrenheit to Celsius
 * @param {number} fahrenheit - Temperature in Fahrenheit
 * @returns {number} Temperature in Celsius
 */
function fahrenheitToCelsius(fahrenheit) {
    return (fahrenheit - 32) * 5/9;
}

/**
 * Convert temperature between units
 * @param {number} temp - Temperature value
 * @param {string} fromUnit - Source unit ('°C' or '°F')
 * @param {string} toUnit - Target unit ('°C' or '°F')
 * @returns {number} Converted temperature
 */
function convertTemperature(temp, fromUnit, toUnit) {
    if (fromUnit === toUnit) return temp;
    if (fromUnit === '°C' && toUnit === '°F') return celsiusToFahrenheit(temp);
    if (fromUnit === '°F' && toUnit === '°C') return fahrenheitToCelsius(temp);
    return temp;
}

// ============================================================================
// TIME UTILITIES
// ============================================================================

/**
 * Convert time string to minutes since midnight
 * @param {string} timeStr - Time in 'HH:MM' format
 * @returns {number} Minutes since midnight
 */
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to time string
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in 'HH:MM' format
 */
function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Format hours and minutes as 'HH:MM' time string
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @returns {string} Time in 'HH:MM' format
 */
function formatTimeString(hours, minutes) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Adjust time by adding/subtracting minutes with 24-hour wraparound
 * @param {string} timeStr - Time in 'HH:MM' format
 * @param {number} minutesToAdd - Minutes to add (negative to subtract)
 * @returns {string} New time in 'HH:MM' format
 */
function adjustTime(timeStr, minutesToAdd) {
    let totalMinutes = timeToMinutes(timeStr) + minutesToAdd;
    
    // Handle wraparound
    while (totalMinutes < 0) totalMinutes += 1440;
    while (totalMinutes >= 1440) totalMinutes -= 1440;
    
    return minutesToTime(totalMinutes);
}

/**
 * Interpolate temperature at a given time (step function - hold until next node)
 * @param {Array} nodes - Array of schedule nodes with {time, temp} properties
 * @param {string} timeStr - Time in 'HH:MM' format
 * @returns {number} Interpolated temperature
 */
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
