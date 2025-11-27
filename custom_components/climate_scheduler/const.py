"""Constants for the Climate Scheduler integration."""

DOMAIN = "climate_scheduler"

# Storage
STORAGE_VERSION = 1
STORAGE_KEY = "climate_scheduler_data"

# Default schedule nodes (time in HH:MM format, temp in Celsius)
DEFAULT_SCHEDULE = [
    {"time": "00:00", "temp": 18.0},
    {"time": "07:00", "temp": 21.0},
    {"time": "23:00", "temp": 18.0}
]

# Temperature settings
MIN_TEMP = 5.0
MAX_TEMP = 30.0
TEMP_THRESHOLD = 0.5  # Only update if difference exceeds this

# Update interval
UPDATE_INTERVAL_SECONDS = 60  # Check schedules every minute
