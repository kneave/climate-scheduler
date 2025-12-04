# Changelog

## [1.4.0] - 2025-12-04
### Changed
- **MAJOR**: Migrated from legacy iframe panel to modern custom panel architecture
- Frontend now loads as JavaScript module with version-based cache busting
- Panel registration changed from `component_name="iframe"` to `component_name="custom"`
- API endpoints moved from `/climate_scheduler_panel/` to `/api/climate_scheduler/`

### Added
- Proper cache control with version parameter (`?v=140`)
- Direct hass object integration for better Home Assistant context access
- Support for both custom panel mode (preferred) and legacy WebSocket mode

### Fixed
- **Eliminated aggressive iframe caching** - changes now load immediately on version update
- No more need for hard browser refresh (Ctrl+F5) after deployments
- Better mobile app compatibility with direct hass object access

### Technical Details
- `panel.js` - New custom Web Component entry point
- `ha-api.js` - Updated to use hass.callService() when available
- `app.js` - Exported initialization functions for panel integration
- `__init__.py` - Custom panel registration with versioned module URLs

## [1.3.0] - 2025-12-03
### Added
- Day-based scheduling with 3 modes: all_days, 5/2 (weekday/weekend), individual days
- Schedule mode selector UI in editor
- Day selector buttons for individual day mode
- Weekday/Weekend buttons for 5/2 mode

### Changed
- Storage format updated to support per-day schedules
- Service definitions updated with optional `day` and `schedule_mode` parameters
- Group schedules support day-based scheduling

### Fixed
- Schedule persistence across day switches
- Auto-save timing during schedule reload

## [1.2.1] - 2025-12-02
### Fixed
- logging method kept in code in error

## [1.2.0] - 2025-12-02

