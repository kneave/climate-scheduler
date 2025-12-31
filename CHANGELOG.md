# Changelog

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

**Files touched:** `custom_components/climate_scheduler/sensor.py`, `services.py`, `storage.py`, `__init__.py`, and frontend files under `custom_components/climate_scheduler/frontend`.This changelog summarizes notable changes across the project history, compiled from repository tags and commit messages.
