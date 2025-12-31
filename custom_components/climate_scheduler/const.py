"""Constants for the Climate Scheduler integration."""

DOMAIN = "climate_scheduler"

# Storage
STORAGE_VERSION = 1
STORAGE_KEY = "climate_scheduler_data"

# Default schedule nodes (time in HH:MM format, temp in Celsius)
DEFAULT_SCHEDULE = []

# Temperature settings (in Celsius)
MIN_TEMP = 5.0
MAX_TEMP = 30.0
TEMP_THRESHOLD = 0.5  # Only update if difference exceeds this
NO_CHANGE_TEMP = None  # Special value to indicate temperature should not be changed

# Update interval
UPDATE_INTERVAL_SECONDS = 60  # Check schedules every minute
