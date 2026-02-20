# Changelog (Develop Pre-Releases)

This file archives pre-release changelog entries that use the `develop` version suffix.

## [1.15.0-develop.11] - 2026-02-20

### Changed

- **Global Profile Architecture**: Migrated from per-schedule profiles to global profiles with per-group active profile selection
  - Groups/selectors now choose `active_profile` while profile definitions are shared globally
  - Migration preserves legacy per-group profile snapshots tagged for downgrade safety

- **Profile Editor Node Settings**: Added full node settings pane support in the profile editor timeline workflow

- **Timeline UX Enhancements**:
  - Added timeline graph legend
  - Added climate dialog slider step configuration limits and improved HVAC-aware slider background updates

- **No-Change Behavior**: Reimplemented frontend no-change handling for mode settings
  - New nodes now default non-temperature settings to no-change (mode fields omitted until explicitly set)

- **Node Workflow Improvements**:
  - Test event action moved into node settings
  - Creating a new node while climate dialog is open now correctly targets the newly created node
  - Undo now covers climate settings dialog changes (not temperature-only edits)

- **UI/UX Polish**:
  - Delete action icon changed to trash can
  - Tooltip contrast/colors improved
  - Timeline scroll navigation buttons repositioned for better layout
  - Reduced frontend console log spam

- **Instruction/Context Cleanup**: Moved duplicated instructions to global area and expanded project context/contract documentation

### Removed
- **Per-Schedule Profile Model**: Replaced by global profiles architecture (legacy compatibility data retained)
- **Duplicated Local Instructions**: Consolidated into a single global instruction location

### Fixed
- **Advance Mode**: Fixed broken advance behavior
- **Save Pipeline**: Fixed no-save regression in schedule editing flow
- **Rounding/Precision**: Fixed timeline and slider rounding artifacts
- **Default Profile Selection**: Fixed default profile usage when monitoring newly added entities
- **Issue Fixes**: Included targeted fixes for [#126](https://github.com/kneave/climate-scheduler/issues/126), [#149](https://github.com/kneave/climate-scheduler/issues/149), [#154](https://github.com/kneave/climate-scheduler/issues/154), and [#156](https://github.com/kneave/climate-scheduler/issues/156)

## [1.15.0-develop.10] - 2026-02-13

### Changed
- Renamed "Preset Mode" to "Thermostat Preset" in node settings to reduce confusion between it and schedule presets

- **Coordinator**: Settings now applied only when needed
  - Apply settings on: time transitions, user edits to current node, or first run (initialization)
  - Ensures correct settings after server reboot via first-run detection
  - Virtual groups still fire events only on actual node transitions

- **Node Settings Panel Layout**: Improved panel structure
  - Removed redundant "time:" label from header
  - Time dropdown integrated into settings header for cleaner appearance
  - Climate dialog container has proper padding and rounded bottom corners
  - Consistent background colors across header and content areas

## [1.15.0-develop.9] - 2026-02-07
### Added
- **Debug Visualization**: Added "Show Node Hit Areas" checkbox in settings panel
  - Shows circular boundaries around timeline nodes indicating clickable/touchable areas
  - Helps visualize the 20px hit detection radius for debugging interaction issues
  - Can be toggled on/off as needed

- **Edit Group Modal Dialog**: Replaced browser prompt with modal dialog for group editing
  - Modal includes group name input field
  - Integrated "Delete Group" button directly in the edit modal
  - Supports keyboard shortcuts: Enter to save, Escape to cancel
  - Click outside modal to dismiss

### Changed
- **Group Management UI Cleanup**: Removed redundant "Delete Group" button from settings panel
  - Delete functionality now only available through edit group modal
  - Cleaner, more streamlined settings interface

- **Icon Improvements**: Vertically flipped pencil icon (✎) in edit group button
  - Icon now points in correct direction for better visual consistency

### Fixed
- **[#150](https://github.com/kneave/climate-scheduler/issues/150): Invalid time format: 24:00**: Fixed error when placing nodes at midnight end-of-day
  - Timeline now clamps times to maximum 23:59 to prevent 24:00 format
  - Prevents clash with 00:00 nodes on next day (coordinator checks once per minute)
  - Frontend clamps on keyframe creation, dragging, and conversion to schedule nodes
  - Backend normalizes 24:00 → 23:59 as safety net during validation
  - Fixes warnings: "Invalid time format: 24:00" in logs

- **Timeline Scroll Click Detection**: Fixed click/touch detection failing when timeline is scrolled horizontally
  - Removed double-counting of scroll offset in coordinate calculations
  - getBoundingClientRect().left already accounts for scroll position
  - Fixed in 7 locations: mouse down, move, click, double-click, context menu handlers

- **Touch Interaction**: Fixed nodes requiring double-tap to select on touch devices
  - Single tap now correctly selects nodes (when not dragging)
  - Improved touch responsiveness and user experience on mobile/tablet devices

- **Edit Group Modal Scope**: Fixed "null" appearing in delete confirmation prompt
  - Changed from closure variable to dataset storage pattern for group name
  - Modal now correctly stores and retrieves group name across all operations

## [1.15.0-develop.8] - 2026-02-04
### Fixed
- [#137](https://github.com/kneave/climate-scheduler/issues/137): rectLeft and scroll were essentially applied twice to the click/tap handler screwing things up

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
-()` function

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
-m main schedule)

## [1.15.0-develop.5] - 2026-01-25

- 2026-01-25

### Fixed
- **No-Change Node Resync**: Fixed issue [#118](https://github.com/kneave/climate-scheduler/issues/118) where nodes with no temperature/HVAC changes were not properly synchronizing schedules
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
- directories

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
-ame clicks

## [1.15.0-develop.2] - 2026-01-12
### Added
- Added "Timeline Comparison" to each schedule to preview the new graph system

## [1.15.0-develop.1] - 2026-01-11
### Changed
- Updated version number format to match symantic versioning better
- This release purely to test that HACS can install with this format
