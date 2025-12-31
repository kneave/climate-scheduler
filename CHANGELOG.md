# Changelog

This changelog summarizes notable changes across the project history, compiled from repository tags and commit messages.

## [v1.14.0] - 2025-12-31
### Added
- Derivative rate-of-change sensors for climate entities and associated floor sensors (where available).
- Sensors reporting the warmest and coldest monitored climate entities.

### Changed
- Major overhaul of group handling (single- and multi-entity groups); sensors are now created against grouped entities.
- Frontend: version check & cache-busting for static resources; reintegrated frontend registration and build metadata.
- Static path for the frontend is now `/cimate_scheduler/static` to prevent possible issues with use of `/local` or `/hacsfiles`.

### Fixed
- Removed legacy `is_group` references and fixed enabling/disabling of schedules caused by prior single/group handling differences.
- Fixed UI member-entity expansion and the "Sync All Thermostats" button; improved sensor device-linking and stability.

### Removed
- Removed legacy `is_group` logic and several unused deployment helper scripts.
- Removed references to the separate custom card from docs/README.

**Files touched:** `custom_components/climate_scheduler/sensor.py`, `services.py`, `storage.py`, `__init__.py`, and frontend files under `custom_components/climate_scheduler/frontend`.

## [v1.12.0] - 2025-12-21
- Change: Reintegrated frontend into the component repository; updated registration and versioning.
- Docs: Removed references to the separate card and improved HACS instructions.

## [v1.11.0.3b] - 2025-12-21
- Release: Beta release iteration — frontend registration/build number fixes and release menu improvements.

## [v1.11.0.2b] - 2025-12-21
- Change: Frontend reintegration work; registration and build tweaks.

## [v1.11.0.1b] - 2025-12-21
- Change: Release script updates for beta releases; packaging adjustments.

## [v1.10.0] - 2025-12-21
- Feature: Factory reset option added for testing fresh install behaviour.
- Fix: Entity monitoring fixes for clean installs.

## [v1.9.1] - 2025-12-20
- Fix: Extra checks for entity existence.

## [v1.9.0] - 2025-12-19
- Change: Single-entity groups are created by default.
- Change: Newly monitored entities automatically have schedules enabled.

## [v1.8.2] - 2025-12-18
- Fix/Change: Handling of min/max temperatures for Fahrenheit improved; default schedule removed.

## [v1.8.1] - 2025-12-15
- Maintenance: UI controller spam reduced; added frontend versioning metadata.

## [v1.8.0] - 2025-12-15
- Feature: Initial derivative sensors for active thermostats added; device/area-aware sensor assignment.

## [v1.7.1] - 2025-12-15
- Fix: Version loading for backend/frontend state display corrected.

## [v1.7.0] - 2025-12-14
- Feature: Schedule profiles added for group-based scheduling.

## [v1.6.0] - 2025-12-13
- Feature: Manual 'advance' function to skip an entity to its next scheduled node.
- Change: Advance status persisted to storage.

## [v1.5.7] - 2025-12-12
- Fixes and stability improvements around scheduler enabled state and entity ignore handling.

## [v1.5.6] - 2025-12-11
- Change: `clear schedule` updated to work correctly with groups.

## [v1.5.5] - 2025-12-11
- Fix: Critical bug fixes for duplicated code paths and potential infinite loops.

## [v1.5.4] - 2025-12-10
- Docs/CSS: Readme updates and CSS cleanup.

## [v1.5.3] - 2025-12-09
- Change: Manual save button added; autosave improvements.

## [v1.5.2] - 2025-12-09
- Fix: Integration and custom card loading fixes.

## [v1.5.1] - 2025-12-08
- Maintenance: Removed manifest load for performance; security best-practice adjustments.

## [v1.5.0] - 2025-12-06
- Feature: Custom card added for easier inclusion in dashboards.

## [v1.4.1] - 2025-12-06
- Fix: UI toggles to hide active list when no individual entities are active.

## [v1.4.0] - 2025-12-05
- Feature: Drag-to-adjust time periods in UI; improved active schedule updating.

## [v1.3.0] - 2025-12-04
- Feature: Day-based scheduling (including 5/2 mode) and clipboard support.

## [v1.2.1] - 2025-12-02
- Fix: Minor bugfix (logging artifact removed).

## [v1.2.0] - 2025-12-02
- Feature: Day-specific scheduling modes; tooltip mode option; improved HVAC mode handling and enabled schedule handling.

## [v1.1.0] - 2025-12-01
- Change: Consolidated version number to `manifest.json`, added release automation and improved release tooling.

## [1.0.3] - 2025-11-29
- Fix: Mobile app compatibility improvements; graph data improvements.

## Initial development - 2025-11-27 → 2025-11-29
- Project created; initial group support and basic scheduler UI/graphing implemented.

---

Notes:
- This changelog was generated from repository tags and commit messages. For file-level details see the affected files such as [custom_components/climate_scheduler/sensor.py](custom_components/climate_scheduler/sensor.py), [custom_components/climate_scheduler/services.py](custom_components/climate_scheduler/services.py), and the frontend files under [custom_components/climate_scheduler/frontend](custom_components/climate_scheduler/frontend).