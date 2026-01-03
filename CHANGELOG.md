# Changelog

## [Unreleased]
### Added
- Configurable temperature precision settings (graph snap step and input field step)
- Settings panel now allows choosing between 0.1°, 0.5°, or 1.0° temperature steps

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
