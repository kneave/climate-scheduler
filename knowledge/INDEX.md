# Climate Scheduler — Codebase Knowledge Index

Generated from full end-to-end source reads of every module.

## How to Use

Each `KNOWLEDGE_*.md` file documents a single module with:
- **Purpose**: What it does in the system
- **Key Functions**: Signature, contract, mutations, calls, edge cases, test coverage
- **Invariants**: Proven vs. assumed state invariants
- **Contract Connections**: Links to CONTRACTS.md
- **Known Bugs / Gaps**: Documented issues
- **Cross-Module Dependencies**: What it imports and who imports it

The `python_model.json` and `frontend_model.json` are machine-readable structural models
extracted via AST/regex — function signatures, call graphs, class hierarchies, state mutations.

## Knowledge Files

### Python Backend
| File | Module | Lines | Key Risks |
|------|--------|-------|-----------|
| KNOWLEDGE_const.md | const.py | 70 | Max temp mismatch (35 vs 30) |
| KNOWLEDGE_init.md | __init__.py | 500 | Service unload gap, self-reload hack |
| KNOWLEDGE_config_flow.md | config_flow.py | 140 | Minimal config surface |
| KNOWLEDGE_storage.md | storage.py | 1881 | Migration clobbering, NaN/inf, missing method |
| KNOWLEDGE_coordinator.md | coordinator.py | 1127 | Fan/swing/preset skipped in advance, day boundaries |
| KNOWLEDGE_services.md | services.py | 1909 | async_clear_schedule bug, mixed schedule_id |
| KNOWLEDGE_climate.md | climate.py | 590 | max_temp mismatch, schedule shape mismatch |
| KNOWLEDGE_sensor.md | sensor.py | 480 | Direct _storage._data access |
| KNOWLEDGE_switch.md | switch.py | 421 | preset_mode drops temperature, no-op refresh |

### Frontend
| File | Module | Lines | Key Risks |
|------|--------|-------|-----------|
| KNOWLEDGE_app_js.md | app.js | 7580 | Profile-edit leak, save-dropped, currentSchedule overwrite, dead code |
| KNOWLEDGE_ha_api_js.md | ha-api.js | 673 | Silent error swallowing |
| KNOWLEDGE_utils_js.md | utils.js | 186 | Pure utilities, low risk |
| KNOWLEDGE_panel_js.md | panel.js | 599 | DOM shell, version check |
| KNOWLEDGE_climate_dialog.md | climate-dialog.ts/.js | 1094 | noChange mutates stateObj |
| KNOWLEDGE_keyframe_timeline.md | keyframe-timeline.ts/.js | 2348 | CSS named colors, double-draw |
| KNOWLEDGE_climate_scheduler_card.md | card.ts/.js | 252 | Event type inconsistency |
| KNOWLEDGE_panel_ts.md | panel.ts | 640 | No cleanup, XSS risk, innerHTML |

### Structural Models (machine-readable)
| File | Schema | Covers |
|------|--------|--------|
| python_model.json | climate-scheduler-python-model-v1 | All .py files: signatures, calls, mutations, classes |
| frontend_model.json | climate-scheduler-frontend-model-v1 | All .ts/.js files: signatures, classes, events, service calls |

## Extraction Tools
| Tool | Purpose |
|------|---------|
| tools/extract_python_model.py | AST-based Python model extraction |
| tools/extract_ts_js_model.py | Regex-based TS/JS model extraction |

## Regeneration

```bash
mkdir -p knowledge
python3 tools/extract_python_model.py --dir custom_components/climate_scheduler/ > knowledge/python_model.json
python3 tools/extract_ts_js_model.py --dir src/ custom_components/climate_scheduler/frontend/ > knowledge/frontend_model.json
```

Note: KNOWLEDGE files are curated by reading source end-to-end. They need manual review
when code changes — the JSON models are auto-regenerable, the markdown is not.

## Bug Summary (cross-module)

1. **async_clear_schedule** — services.py:995 calls nonexistent method; partial fix with async_set_schedule(entity_id, [])
2. **validate_node accepts NaN/inf** — storage.py lets float("NaN") and float("inf") through as temperatures
3. **_sync_group_profile_views clobbers migrations** — runs on every save, overlays before migration data is complete
4. **fan/swing/preset skipped during advance** — coordinator.py advance_to_next_node only applies modes in noChange branch
5. **climate.py max_temp=35 vs const.py MAX_TEMP=30** — hardcoded override of the constant
6. **climate.py schedule shape mismatch** — accesses schedules[day]["nodes"] but storage uses flat lists
7. **switch.py preset_mode drops temperature** — node with both temp and preset_mode only applies preset
8. **switch.py refresh is no-op** — _refresh_group_data can't call async from sync property
9. **app.js profile-edit leak** — editing profile writes to currentSchedule, can leak on timeline switch
10. **app.js save dropped** — single pendingSaveNeeded boolean, rapid saves can lose data
11. **app.js currentSchedule overwrite** — editGroupSchedule/switchDay overwrite unsaved edits
12. **app.js dead code in handleGraphChange** — thermostat immediate-update logic unreachable
13. **__init__.py service unload gap** — 8 services registered but not unregistered on unload
14. **coordinator.py cross-module coupling** — calls private storage._time_to_minutes directly
15. **coordinator.py naive vs aware datetime** — datetime.fromisoformat vs dt_util.now() mismatch