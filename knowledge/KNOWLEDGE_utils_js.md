# KNOWLEDGE: utils.js

## Purpose
Shared utility functions for the Climate Scheduler frontend. Pure functions with no side effects — timezone conversion, temperature conversion, time manipulation, and temperature interpolation. 186 lines. No state, no HA API calls, no DOM access.

## Key Functions (alphabetical)

### adjustTime(line 145)
- **Signature**: `(timeStr, minutesToAdd)`
- **Contract**: Adds (or subtracts, if negative) minutes to a "HH:MM" time string with 24-hour wraparound. Returns new "HH:MM" string.
- **Edge cases**: Wraps around midnight correctly (negative → adds 1440, ≥1440 → subtracts 1440). Only handles single-day wraparound; extreme offsets may need multiple wraps.

### celsiusToFahrenheit(line 77)
- **Signature**: `(celsius)`
- **Contract**: Converts °C to °F. Formula: `(c * 9/5) + 32`.
- **Edge cases**: No bounds checking. Returns values like 32.00000000001 due to floating point.

### convertTemperature(line 97)
- **Signature**: `(temp, fromUnit, toUnit)`
- **Contract**: Converts temperature between '°C' and '°F'. If same unit, returns unchanged. Falls through to return `temp` for unknown units.
- **Edge cases**: No validation of unit strings. Unknown units silently pass through.

### fahrenheitToCelsius(line 86)
- **Signature**: `(fahrenheit)`
- **Contract**: Converts °F to °C. Formula: `(f - 32) * 5/9`.
- **Edge cases**: Same floating-point precision as celsiusToFahrenheit.

### formatTimeString(line 135)
- **Signature**: `(hours, minutes)`
- **Contract**: Formats hours (0-23) and minutes (0-59) as "HH:MM" string with zero-padding.
- **Edge cases**: No bounds validation on inputs.

### getServerDate(line 16)
- **Signature**: `(date, serverTimeZone)`
- **Contract**: Converts a UTC Date to a Date-like object whose getter methods (getFullYear, getMonth, getDate, getHours, getMinutes, getSeconds) return values in the specified server timezone. Uses `Intl.DateTimeFormat` with `timeZone` option.
- **Returns**: `{getFullYear, getMonth, getDate, getHours, getMinutes, getSeconds, getTime, _originalDate}`
- **Edge cases**: Returns the original `date` object (with local time) if `serverTimeZone` is falsy. `_originalDate` is exposed for debugging but not used by the app.

### getServerNow(line 54)
- **Signature**: `(serverTimeZone)`
- **Contract**: Returns `getServerDate(new Date(), serverTimeZone)` — current time in server timezone.

### interpolateTemperature(line 161)
- **Signature**: `(nodes, timeStr)`
- **Contract**: Step-function interpolation (hold until next node). Sorts nodes by time, finds the most recent node before or at `timeStr`. If no node before current time, uses last node (wraparound from previous day). Returns 18 as default if empty array.
- **State**: None (pure function).
- **Edge cases**: Returns 18 for empty nodes. Wraparound uses the LAST node in sorted order (highest time), which represents the temperature from the end of the previous day. Does NOT interpolate between nodes — it's a step function.

### minutesToTime(line 123)
- **Signature**: `(minutes)`
- **Contract**: Converts minutes since midnight to "HH:MM" string.
- **Edge cases**: `Math.floor` for both hours and minutes — handles fractional minutes by truncating.

### timeToMinutes(line 113)
- **Signature**: `(timeStr)`
- **Contract**: Parses "HH:MM" string, returns minutes since midnight (0-1439).
- **Edge cases**: No validation — assumes well-formed input. Splits on `:` and maps to Number.

### utcToServerDate(line 64)
- **Signature**: `(utcDate, serverTimeZone)`
- **Contract**: Alias for `getServerDate(utcDate, serverTimeZone)`.

## Critical State

None — this file is stateless.

## Known Bugs / Gaps

1. **No input validation**: All functions assume well-formed inputs. Malformed time strings, null values, or non-numeric temperatures will produce NaN or crash.
2. **Floating-point precision**: Temperature conversions can produce values like 73.3999999 instead of 73.4. The `normalizeTemperature` function in app.js handles this, but it's not in utils.js.
3. **No negative time handling in timeToMinutes**: If timeStr is "24:00" or malformed, behavior is undefined.
4. **interpolateTemperature uses step function only**: If the schedule needs linear interpolation between nodes, this function won't work.

## Cross-Module Dependencies

- **app.js**: Imports all functions from this file. Primary consumers are temperature conversion (for schedule display and conversion tools), time manipulation (for graph rendering), and timezone conversion (for history data alignment with server timezone).
- **ha-api.js**: No direct dependency.
- **panel.js**: No direct dependency.