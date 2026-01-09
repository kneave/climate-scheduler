# Changelog

## [unreleased]
### Fixed
- **Node Activated Events**: Events now only fire on scheduled time transitions, not when editing current node
  - `climate_scheduler_node_activated` events now only trigger when node time changes (scheduled transition)
  - Editing the current active node's settings no longer fires spurious events
  - Climate entities still update immediately when current node is edited, but events are suppressed
  - Prevents unwanted automation triggers when adjusting schedules in the UI

## [1.14.7.6b] - 2026-01-09

### Added
- **Frontend Card Registration**: Improved card registration following HACS best practices
  - Card now registers in picker immediately when JavaScript loads, before class definition
  - Registration wrapped in IIFE with error handling to prevent cascade failures
  - Better logging for debugging registration issues
- **Automatic Browser Refresh Detection**: Frontend now detects when cached version is stale
  - Version checking in both `climate-scheduler-card.js` and `panel.js`
  - Shows toast notification when browser cache doesn't match server version
  - Uses sessionStorage to avoid showing notification repeatedly
  - Works for both dashboard cards and panel views
- **Automatic Reload on Install/Upgrade**: Integration automatically reloads after first install or version upgrade
  - Detects first install and upgrades by tracking version in config entry
  - Triggers automatic reload 2 seconds after setup completes
  - Ensures all entities and UI components are properly initialized
  - Eliminates need for manual reload after installation or updates

### Changed
- Removed "(Dev)" suffix from "Reload Integration" service and button
  - Service name: `climate_scheduler.reload_integration` (unchanged)
  - Display name now: "Reload integration" (was "Reload integration (Dev)")
  - Description updated to remove "development only" text
- Frontend version checking moved from backend to JavaScript
  - More accurate detection of stale browser cache
  - Backend cannot know what's cached in user's browser

### Fixed
- **Issue 101 Graph Rendering**: Enhanced fix for graph line drawing at the start of the day in 7-day and weekday/weekend modes
  - Graph now correctly uses previous day's last temperature node when drawing the line at the start of the current day
  - Added `setPreviousDayLastTemp()` method to graph.js for cross-day continuity
  - Helper function in app.js determines correct previous day based on schedule mode (all_days, 5/2, individual)
  - Fixes visual issue where graph would incorrectly draw from current day's last node at midnight
- **Timezone Handling**: Fixed coordinator to use Home Assistant's configured timezone instead of system timezone
  - Replaced all `datetime.now()` calls with `dt_util.now()` in coordinator.py (11 instances)
  - Ensures schedule activation respects HA's timezone configuration, not the host system's timezone
  - Critical for users where Home Assistant timezone differs from system timezone
  - Properly handles daylight saving time (DST) transitions
  - Storage format unchanged - times remain as "HH:MM" strings
- Card registration now more resilient to loading errors
- Version mismatch detection works correctly in both panel and dashboard contexts

## [1.14.7.5b] - 2026-01-08

### Fixed
- Issue 102: `climate_scheduler_node_activated` events fired by coordinator and the test events button didn't match. `entity_id` is used if there's a single entity but `entities` is used where there are multiple. In the future I will remove `entity_id` and have single 

## [1.14.7.4b] - 2026-01-08

### Fixed
- Issue 101: In 7 day or weekday/weekend modes tha coordinator wasn't checking the last node from the previous session and incorrectly using the last from the new session.
- Issue 102: `climate_scheduler_node_activated` events fired by coordinator and the test events button didn't match. `entity_id` is used if there's a single entity but `entities` is used where there are multiple. In the future I will remove `entity_id` and have single 

## [1.14.7.3b] - 2026-01-07

### Added
- **Scheduler Component Compatibility**: Switch entities now expose schedule data in scheduler-component format
  - Each schedule creates a `switch.schedule_<name>_<token>` entity
  - Attributes include `next_trigger`, `next_slot`, `actions`, and `next_entries`
  - Compatible with integrations like Intelligent-Heating-Pilot that consume scheduler data
  - Supports both single-entity and multi-entity group schedules
- Documentation: Added SCHEDULER_COMPATIBILITY.md with integration examples
- Documentation: Added TESTING_SCHEDULER_FORMAT.md with validation methods
- Validation script: validate_scheduler_format.py for verifying data format compliance

### Changed
- Switch entities now use token-based unique IDs for better uniqueness (format: `switch.schedule_<name>_<token>`)
- Actions array now properly populates with all schedule nodes and entities
- Enhanced `_compute_schedule_attributes()` to derive entity from group name when missing

### Fixed
- Fixed AttributeError: 'entity_id' property no longer blocks Home Assistant from setting the entity ID
- Automatic cleanup of old switch entities without token suffixes (removes duplicates on reload)
- Empty entities list now handled gracefully - derives entity from single-entity group name
- Actions and next_entries now properly populated even when entities list is temporarily empty


## [1.14.6] - 2026-01-03

### Added
- Configurable temperature precision settings (graph snap step and input field step)
- Settings panel now allows choosing between 0.1°, 0.5°, or 1.0° temperature steps
- test_fire_event service now accepts node and day parameters for testing specific scenarios

### Changed
- test_fire_event now includes all group entities in event data instead of single entity_id
- node_activated events now only fire on actual node transitions, preventing event spam on every coordinator update

### Fixed
- Duplicate variable declaration causing syntax error in frontend
- Fixed constant stream of events being generated every 60 seconds even when no node transition occurred

## [1.14.5] - 2026-01-03
### Changed
- Temperature steps changed from 0.5c to 0.1c

## [1.14.4] - 2026-01-02
### Fixed
- Issue #78: Schedules now reapply on node time transitions even if settings are the same, ensuring manual changes are reset to the schedule at each node time

## [1.14.3] - 2026-01-02
### Fixed
- Intermittent issues saving nodes
- More robust card registration

## [1.14.2] - 2026-01-01
### Fixed
- Issue #75: Fixing loads of inconsistencies with schedule advance
- Issue #74: Settings not saving
- Extra checks for null temperature entities
- Issue #57: is_group errors
- Issue #62: En/disabling schedules
- Autosave bugs
- Services for malformed sensors
- Duplicate sensor creation issues

### Added
- Enable/disable slider to the schedule header
- Reregister_card service
- Detection and handling for climate entities with no temperature target
- Actions to cleanup sensors
- Test fire button
- User configurable variables
- Event firing for automation handling
- Better error handling to prevent needless logging

### Changed
- Frontend resource registration improvements
- Service definitions moved from services.yaml to services.py
- Changed field names away from numbers
- Updated UI tweaks

## [1.14.1] - 2025-12-31
### Fixed
- Extra checking for NULL temperature entities (Issue #73)

## [1.14.0] - 2025-12-31
### Added
- Version checking on init to update resource URL for cache busting
- Sensors for warmest and coolest rooms

### Fixed
- Fixed the issue with the sync all thermostats button
- Sensors now created against grouped entities

### Changed
- Massive overhaul of how everything is handled as groups
- Updated README.md with better HACS instructions
- Removed reference to separate card

## [1.12.0] - 2025-12-21
### Added
- Reintegrated the frontend into the same repo
- Card registration functionality

### Fixed
- Fixed version number generation for main
- Dealing with the saving bug
- Fixed the beta release menu

### Changed
- Updated the versioning
- Updated registration and build number

## [1.10.0] - 2025-12-21
### Added
- "Factory reset" option to test fresh install behaviour

### Fixed
- Entity monitoring when starting from a new install

## [1.9.1] - 2025-12-20
### Fixed
- Adding extra checks for entity existing

## [1.9.0] - 2025-12-19
### Added
- Enabling schedules on newly monitored entities
- Making single entities groups by default

## [1.8.2] - 2025-12-18
### Added
- Handling for min/max for Fahrenheit

### Removed
- Default schedule

## [1.8.1] - 2025-12-15
### Added
- Versioning for the UI

### Fixed
- Reduced controller spam

## [1.8.0] - 2025-12-15
### Added
- Derivative sensors for all active thermostats
- Updated sensor assignment for device/area

## [1.7.1] - 2025-12-15
### Fixed
- Version loading for the backend to display the state in the frontend

## [1.7.0] - 2025-12-14
### Added
- Schedule profiles
- Actions documentation

### Changed
- Tweaking the version handling

## [1.6.0] - 2025-12-13
### Added
- Advance function to skip to the next node early

### Fixed
- Persisting advance status to storage properly

## [1.5.7] - 2025-12-12
### Fixed
- Trying to fix the "ignore entity" bug
- Scheduler not respecting enabled status

### Added
- Notification to let users know the frontend is now in a separate repo

### Removed
- Frontend from the component repo

## [1.5.6] - 2025-12-11
### Fixed
- Updated the "clear schedule" function to work with groups
- Making the new entity schedule creation more robust

### Added
- Manual conversion between temperature units

## [1.5.5] - 2025-12-11
### Fixed
- A few critical issues: duplicated code and a potential infinite loop

### Added
- Min/max temperature settings

### Removed
- Redundant index.html

## [1.5.4] - 2025-12-10
### Fixed
- Fixing the mess of CSS

### Changed
- Updated README with updated instructions

## [1.5.3] - 2025-12-09
### Added
- Manual save button

### Fixed
- Auto-save function

## [1.5.2] - 2025-12-09
### Fixed
- Issues with loading the integration and the custom card

## [1.5.1] - 2025-12-08
### Fixed
- Duplicate import
- Removed the manifest load for performance reasons

### Changed
- Following best practice for security purposes

## [1.5.0] - 2025-12-06
### Added
- Custom card so the UI can be included in dashboards easier

## [1.4.1] - 2025-12-06
### Added
- Known issues documentation

### Changed
- Hiding the active list if no individual entities are active

## [1.4.0] - 2025-12-05
### Added
- Dragging of time periods

### Fixed
- Updating active schedules

### Changed
- Enhanced README with additional scheduling details
- Updated documentation and installation flow

## [1.3.0] - 2025-12-04
### Added
- Day-based scheduling feature
- Clipboard functionality

### Fixed
- 5/2 mode

### Changed
- Switched away from legacy iframes

## [1.2.1] - 2025-12-02
### Fixed
- Logging function left in place

## [1.2.0] - 2025-12-02
### Added
- HVAC modes support
- Tooltip mode option
- Autosave for settings
- Editing for default schedule

### Fixed
- HVAC/other settings issues

### Changed
- Improved handling of mode switches
- Updated group handling for modes
- Better handling for enabled schedules
- Tidied up the UI for modes
- Added extra debugging

## [1.1.0] - 2025-12-01
### Added
- Remote release creation
- Release script
- More data to the graphs

### Fixed
- Issue with the schedule not saving

### Changed
- Updated changelog generation
- Consolidated version number to manifest
- Updated the menu to include quit

## [1.0.3] - 2025-11-29
### Fixed
- Mobile app compatibility (works in landscape mode)






