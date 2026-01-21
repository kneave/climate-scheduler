/**
 * Shared Utility Functions
 * Common utilities used across the Climate Scheduler frontend
 */

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
