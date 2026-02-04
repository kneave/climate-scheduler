# Changelog




## [1.15.0-develop.8] - 2026-02-04
### Fixed
- #137: rectLeft and scroll were essentially applied twice to the click/tap handler screwing things up

## [1.15.0-develop.7] - 2026-01-27

### Added
- **Navigation Controls**: Added Previous/Next keyframe navigation buttons to all timelines
  - Navigate between keyframes using ◀/▶ buttons
  - Buttons are active when 2+ keyframes exist
  - Available in main schedule, profile editor, and default schedule timelines

### Changed
- **Profile Editor UI Improvements**:
  - Profile dropdown now shows "Choose Profile to Edit" placeholder by default
  - Profile timeline hidden until a profile is explicitly selected
  - Close button now resets dropdown to placeholder state
  - Close button text changed from "✕" to "Close" for better clarity
  - Removed "Now editing..." toast notification
  - Timeline title hidden in profile editor

- **Default Schedule UI Cleanup**:
  - Removed schedule mode dropdown (locked to 24hr mode)
  - Removed timeline title text
  - Cleaner, more focused interface

- **Button State Management**:
  - Paste buttons now properly disabled until a schedule is copied
  - Copy button handlers properly attached to all timeline instances
  - Button states update correctly across all timelines

- **Timeline Headers**:
  - Disabled `showHeader` property for all timelines (main, profile, default)
  - Removed built-in timeline header controls in favor of external button controls

### Fixed
- **Copy/Paste Functionality**: Fixed paste button state management
  - Paste buttons now query correct prefixed IDs (main-graph-paste-btn, profile-graph-paste-btn, etc.)
  - Copy button click handlers properly attached to timeline button references
  - `updatePasteButtonState()` now handles all paste button variants

- **Profile Editor Initialization**: Fixed "editor is not defined" error
  - Removed incorrect code attempting to modify profile editor dropdown during group container creation
  - Profile editor dropdown properly populated via `loadProfiles()` function
()` function

## [1.15.0-develop.6] - 2026-01-26

### Added
- **Profile Editor Enhancements**: Major improvements to profile editing workflow
  - Replaced "Schedule Profile" with "Profile Editor" heading for clarity
  - Removed Edit button - profiles now automatically load in editor when selected from dropdown
  - Profile editor opens immediately upon selecting a profile from the dropdown
  - Added Copy and Paste buttons to profile editor for easy schedule duplication
  - Added Save button for manual profile saves (in addition to auto-save)
  - Added Close button (✕) to dismiss profile editor
  - Profile editor now uses same reusable timeline component as main schedule

- **Reusable Timeline Component**: Created `createTimelineEditor()` function for consistent timeline creation
  - Eliminates code duplication between main schedule and profile editor
  - Shared logic for timeline creation, controls, and button configuration
  - Supports customizable button sets and ID prefixes
  - Both editors now use identical layout and control structure

### Changed
- **Schedule Mode UI Improvements**: 
  - Moved schedule mode selector from settings panel to dropdown in graph quick actions
  - Renamed mode options: "All Days" → "24hr", "5/2 (Weekday/Weekend)" → "Weekday", "Individual Days" → "7 Day"
  - Consistent mode selector across main schedule and profile editor

- **Profile Editor Architecture**: Made schedule mode a per-profile property
  - Each profile now maintains its own schedule mode (24hr, Weekday, 7 Day)
  - Mode selection in profile editor is independent from main schedule
  - Profile mode is saved and restored correctly when switching profiles

### Fixed
- **Profile Data Conversion**: Fixed critical data format issues in profile editor
  - Profile editor now properly converts between backend format (HH:MM strings) and timeline format (decimal hours)
  - Uses `scheduleNodesToKeyframes()` when loading profiles to convert "HH:MM" → decimal time
  - Uses `keyframesToScheduleNodes()` when saving profiles to convert decimal time → "HH:MM"
  - Fixed "timeStr.split is not a function" error when switching to profiles edited in profile editor
  - Profiles created in main schedule now load correctly in profile editor and vice versa

- **Profile Editor Variable Scoping**: Fixed variable declaration issues
  - Changed `const profileScheduleMode` to `let` to allow mode updates
  - Fixed `currentProfileDay` to track active day correctly in auto-save
  - Profile editor day tracking is now scoped per timeline instance (independent from main schedule)
m main schedule)

## [1.15.0-develop.5] - 2026-01-25

- 2026-01-25

### Fixed
- **No-Change Node Resync**: Fixed issue #118 where nodes with no temperature/HVAC changes were not properly synchronizing schedules
  - Improved node comparison logic in coordinator to handle nodes that only change time
  - Enhanced resync reliability for multi-node schedules

### Changed
- **Code Migration**: Migrated panel.js to TypeScript for improved type safety and maintainability
  - Updated rollup configuration to support TypeScript compilation
  - Refactored panel logic with better type definitions
  
- **Light Mode Support**: Updated styling to better support light mode themes
  - Improved contrast and readability across all UI components
  - Updated colors for schedule editor, timeline, cards, and panel
  - Better visual hierarchy in both light and dark themes
  
- **Layout Improvements**: Multiple UI layout refinements for better visual presentation
  - Tidied graph layouts for cleaner appearance
  - Optimized spacing throughout the interface
  - Fixed default schedule graph rendering

- **Timeline Behavior**: Disabled timeline collapsing functionality for more consistent user experience

### Removed
- **Legacy Code Cleanup**: Removed deprecated graph.js file (1,649 lines)
  - Fully transitioned to new timeline-based visualization system
  - Cleaned up obsolete graph implementation from both frontend and source directories
 directories

## [1.15.0-develop.4] - 2026-01-24

### Changed
- **Profile Selector**: Removed "Profile:" label from group header dropdowns for cleaner appearance
- **Timeline Controls**: Hidden all timeline control buttons (Previous, Next, Collapse, Config, Undo, Clear) for simplified interface
- **Mobile Layout Optimization**: Extensively reduced spacing on small screens (≤400px) for better space utilization
  - Schedule editor padding: 20px → 4px
  - Editor header margins: 20px → 6px
  - Graph top controls gap: 16px → 4px
  - Day period selector and quick actions padding: 12px → 4px
  - All container padding/margins: 16px → 4px
  - Editor controls gap: 15px → 4px
  - Graph container top margin: 20px → 6px
- **Tablet Layout Optimization**: Moderate spacing reduction on medium screens (≤768px)
  - Schedule editor padding: 20px → 12px
  - Editor header margins: 20px → 12px
  - Day period selector and quick actions padding: 12px → 10px
  - Container padding: 16px → 10px
  - Graph container top margin: 20px → 12px
- **Responsive Controls**: Graph top controls (day period selector and quick actions) now stack vertically on screens ≤768px instead of trying to fit side by side

## [1.15.0-develop.3] - 2026-01-23

### Notes:
This update includes a complete overhaul of the UI and there will be bugs in it, I've tried to reach parity with the old graph system but I can guarantee I've missed something. Please check issues on GitHub if you hit any to see if they've already been reported, otherwise please raise a new one.  

### Fixed
- **New UI System!**: This should now work on mobile devices.
- **Node Settings Persistence**: Fixed HVAC modes, fan modes, swing modes, preset modes, and custom values (A/B/C) not being saved when editing nodes
  - Updated `autoSaveNodeSettings` in both `setupEditor` and `handleNodeSettings` to update `currentSchedule` array instead of transient keyframe objects
  - Fixed `getGraphNodes()` to return `currentSchedule` directly instead of converting from keyframes (which lost properties)
  - Updated `updateNodeFromInputs()` to update both keyframe (for rendering) and scheduleNode (for persistence)
  - Fixed time/temperature adjustment buttons to maintain all node properties when incrementing/decrementing values
  - Made `currentSchedule` a global variable to track complete node data across all editing operations

- **Day Switching Performance**: Eliminated 5-second delay when switching between weekday/weekend in 5/2 mode
  - Removed unnecessary `haAPI.getGroups()` call that fetched all groups from backend on every day switch
  - Now uses cached `allGroups` data which is kept synchronized by auto-save

- **Timeline Redraw**: Fixed timeline not updating immediately when keyframes change
  - Added `drawTimeline()` call in `updated()` lifecycle method when `keyframes` property changes
  - Timeline now redraws instantly when switching days or loading schedules

- **Paste Schedule**: Fixed pasted schedules not being saved
  - `pasteSchedule()` now updates `currentSchedule` before calling `saveSchedule()`
  - Ensures all node properties including HVAC settings are preserved when pasting

- **Previous Day Value**: Fixed previous day's end value not being displayed in multi-day schedules
  - `setPreviousDayLastTempForGraph()` now always sets `previousDayEndValue` property (even to null) instead of checking if it exists
  - `getPreviousDayLastTemp()` result is always assigned, ensuring proper value or null is set
  - Timeline now correctly shows wraparound connection in 5/2 and individual day modes

- **Tooltip Mode**: Fixed tooltip mode not persisting when changed from dropdown
  - Added `attribute: false` to `tooltipMode` property decorator to prevent Lit from managing DOM attribute
  - Dropdown now sets `tooltipMode` on both `graph` and `defaultScheduleGraph` instances

### Changed
- **Graph Wraparound Visualization**: Simplified wraparound line rendering for cleaner multi-day schedule display
  - Removed dashed vertical transition line at end of day
  - Kept solid lines: last keyframe extends to right edge, previous day value connects to first keyframe
  - In 24-hour mode: wraps to own last value; in multi-day mode: uses previous day's end value
  - Wraparound line drawn from left edge (00:00) to first keyframe, handling both time=0 and time>0 cases

### Removed
- Removed excessive debug logging for graph changes, undo operations, and keyframe clicks
ame clicks


## [1.14.12] - 2026-01-21

### Fixed
- **Timezone Handling**: Graph and UI now correctly use Home Assistant server timezone instead of browser local timezone
  - Current time indicator now shows correct server time for users traveling in different timezones
  - Historical data timestamps are displayed in server timezone
  - Advance activation/cancellation times use server timezone
  - Added timezone conversion utilities using Intl.DateTimeFormat API

### Changed
- **Code Refactoring**: Consolidated duplicate utility functions into shared utils.js file
  - Moved timezone conversion utilities to shared file
  - Moved temperature conversion functions to shared file
  - Moved time manipulation utilities to shared file
  - Eliminated ~170 lines of duplicate code across app.js and graph.js
  - Added new helper functions: formatTimeString() and adjustTime()
- **Graph Visualization**: Removed redundant dashed wraparound line from schedule graph (issue 123)


## [1.14.11] - 2026-01-17

### Added
- **Workday Integration Support**: Optional integration with Home Assistant's Workday integration for 5/2 scheduling
  - Backend detection of Workday integration (checks for `binary_sensor.workday_sensor`)
  - User-configurable option to enable/disable Workday integration usage
  - Manual workday selection with 7 day checkboxes when Workday integration is disabled or unavailable
  - Settings stored persistently: `use_workday_integration` (boolean) and `workdays` (array)
  - UI automatically shows/hides day selector based on Workday availability and user preference
  - Frontend detection with connection wait logic to handle timing issues
  - New constants: `SETTING_USE_WORKDAY`, `SETTING_WORKDAYS`, `DEFAULT_WORKDAYS`
  
- **Orphaned Entity Cleanup**: New service and UI button to cleanup orphaned entities
  - Service `cleanup_orphaned_climate_entities` scans and removes orphaned entities
  - Checks climate entities, sensor entities, and switch entities
  - Dry-run mode by default (delete=false) to preview orphaned entities
  - UI button in settings with scan-first workflow and confirmation dialog
  - Lists all orphaned entities before deletion
  - Identifies entities without matching groups or climate entities in storage

### Changed
- **UI Layout Improvements**: Settings text labels and descriptions can now use full width
  - Increased min-width from 220px to 280px on Graph Options and Temperature Precision sections
  - Added flex-wrap to allow responsive layout on smaller screens
  - Added max-width: 100% to Derivative Sensors and Workday Integration sections
  - Settings descriptions no longer constrained by fixed-width parent containers

- **Entity Filtering**: Climate Scheduler's own entities are now filtered from unmonitored entity list
  - Entities starting with `climate.climate_scheduler_` are excluded from the list
  - Prevents confusion from seeing integration's own proxy entities

- **Release Script Enhancement**: `.version` file is now updated during release process
  - Added to git commits automatically
  - Included in dry-run output for verification

### Fixed
- Workday integration detection timing issue resolved with connection wait logic
- Removed redundant status icon from Workday integration setting
- Filtering Climate Scheduler entities from the Unmonitored list

## [1.14.10] - 2026-01-14

### Fixed
- **YAML Mode Compatibility**: Fixed AttributeError when Lovelace resources are configured via YAML
  - Service `reregister_card` no longer crashes with `AttributeError: 'ResourceYAMLCollection' object has no attribute 'async_create_item'`
  - Added detection for YAML vs UI mode before attempting resource modifications
  - Service now returns helpful error message with manual configuration instructions for YAML mode users
  - All resource operations (create, update, delete) now check if methods exist before calling

### Added
- **YAML Mode Notification**: Persistent notification for YAML mode users who need manual card registration
  - Automatically detects when Lovelace is in YAML mode during initialization
  - Only shows notification if card is not already registered in YAML configuration
  - Provides clear instructions with exact YAML configuration needed
  - Notification automatically dismisses when card is detected in configuration
  - Includes integration version in notification for proper cache busting

### Changed
- Card registration now checks for YAML mode before attempting auto-registration
- Improved logging for YAML mode detection and card registration status
- Updated CARD_TROUBLESHOOTING.md with comprehensive YAML mode instructions including three configuration methods
### Fixed
- **YAML Mode Compatibility**: Fixed AttributeError when Lovelace resources are configured via YAML
  - Service `reregister_card` no longer crashes with `AttributeError: 'ResourceYAMLCollection' object has no attribute 'async_create_item'`
  - Added detection for YAML vs UI mode before attempting resource modifications
  - Service now returns helpful error message with manual configuration instructions for YAML mode users
  - All resource operations (create, update, delete) now check if methods exist before calling

### Added
- **YAML Mode Notification**: Persistent notification for YAML mode users who need manual card registration
  - Automatically detects when Lovelace is in YAML mode during initialization
  - Only shows notification if card is not already registered in YAML configuration
  - Provides clear instructions with exact YAML configuration needed
  - Notification automatically dismisses when card is detected in configuration
  - Includes integration version in notification for proper cache busting

### Changed
- Card registration now checks for YAML mode before attempting auto-registration
- Improved logging for YAML mode detection and card registration status
- Updated CARD_TROUBLESHOOTING.md with comprehensive YAML mode instructions including three configuration methods

## [1.14.9] - 2026-01-13
### Added
- Diagnostics action to help with missing cards

## [1.14.8] - 2026-01-13
### Fixed
- Issue 109: Unable to add directly to a group
- improving UI flow to remove redresh requirement
- fix the reload integration issue

## [1.15.0-develop.2] - 2026-01-12
### Added
- Added "Timeline Comparison" to each schedule to preview the new graph system

## [1.15.0-develop.1] - 2026-01-11
### Changed
- Updated version number format to match symantic versioning better
- This release purely to test that HACS can install with this format

## [1.14.7] - 2026-01-10

### Added
- **Scheduler Component Compatibility**: Switch entities now expose schedule data in scheduler-component format
  - Each schedule creates a `switch.schedule_<name>_<token>` entity
  - Attributes include `next_trigger`, `next_slot`, `actions`, and `next_entries`
  - Compatible with integrations like Intelligent-Heating-Pilot that consume scheduler data
  - Supports both single-entity and multi-entity group schedules
- Documentation: Added SCHEDULER_COMPATIBILITY.md with integration examples
- Documentation: Added TESTING_SCHEDULER_FORMAT.md with validation methods
- Validation script: validate_scheduler_format.py for verifying data format compliance

### Updated
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
  - Switch entities now use token-based unique IDs for better uniqueness (format: `switch.schedule_<name>_<token>`)
- Actions array now properly populates with all schedule nodes and entities
- Enhanced `_compute_schedule_attributes()` to derive entity from group name when missing


### Fixed
- **Node Activated Events**: Events now only fire on scheduled time transitions, not when editing current node
  - `climate_scheduler_node_activated` events now only trigger when node time changes (scheduled transition)
  - Editing the current active node's settings no longer fires spurious events
  - Climate entities still update immediately when current node is edited, but events are suppressed
  - Prevents unwanted automation triggers when adjusting schedules in the UI
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
- Issue 102: `climate_scheduler_node_activated` events fired by coordinator and the test events button didn't match. `entity_id` is used if there's a single entity but `entities` is used where there are multiple. In the future I will remove `entity_id` and have single 
- Issue 101: In 7 day or weekday/weekend modes tha coordinator wasn't checking the last node from the previous session and incorrectly using the last from the new session.
- Issue 102: `climate_scheduler_node_activated` events fired by coordinator and the test events button didn't match. `entity_id` is used if there's a single entity but `entities` is used where there are multiple. In the future I will remove `entity_id` and have single 
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




