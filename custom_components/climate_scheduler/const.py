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
NO_CHANGE_TEMP = None  # Special value to indicate temperature should not be changed

# Update interval
UPDATE_INTERVAL_SECONDS = 60  # Check schedules every minute
# Settings keys
SETTING_USE_WORKDAY = "use_workday_integration"  # Whether to use Workday integration for 5/2 scheduling
SETTING_WORKDAYS = "workdays"  # List of days considered workdays (e.g., ["mon", "tue", "wed", "thu", "fri"])

# Default workdays (Monday through Friday)
DEFAULT_WORKDAYS = ["mon", "tue", "wed", "thu", "fri"]