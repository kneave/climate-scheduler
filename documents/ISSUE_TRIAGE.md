# Issue Triage Report — 2026-10-24

**Scope:** All 44 open issues verified against `main` (`d5dddf5` = v1.15.1 + PR #200/#167), not merely against reporter claims. File:line refs are from main unless noted. NOTE: main holds 7+ months of unreleased fixes (last release v1.15.1, 2026-03-01) — several "likely fixed" verdicts are invisible to users on release builds until the next release ships.

**Method:** 5 parallel review agents; each issue's body/comments fetched via `gh`, then code paths traced in the repo, then commit/PR history searched for existing fixes (`gh pr list --state all`, `git log --all --grep`).

## Verdict Summary

| Verdict | Count | Issues |
|---|---|---|
| Valid bug — confirmed | 12 | #196, #194, #193, #187, #186, #181, #175, #160, #158 (UI half), #146, #144, #130 |
| Likely fixed — close after confirmation | 6 | #173, #169, #168 (new migrations), #161, #152, #145, #121 |
| Stale / needs reporter data | 5 | #198, #195, #188, #180, #176 |
| Valid enhancement (not started) | 14 | #203 (patch offered), #190, #178, #141, #136, #143, #115, #107, #92, #84, #76, #59, #54, #162 |
| Question / doc gap — answerable | 3 | #157, #61, #164 |

## Priority Clusters

### P1 — Fahrenheit units broken end-to-end (#194 + #193, fix together)
- `climate.py:115-116` hardcodes group entity range `5.0/35.0` °C regardless of unit system; `async_set_temperature` forwards unconverted values (`climate.py:373-390`) → HA rejects an 80 °F setpoint with `ServiceValidationError`.
- `sensor.py:296,385` hardcode `UnitOfTemperature.CELSIUS` for coldest/warmest; a °F device's 79 is reported as "79 °C" ≈ 174 °F. Rate sensors pin "°C/h" (`sensor.py:157`) with no device class.
- Storage settings are unit-aware (`storage.py:266-273, 675-677`) and the coordinator clamps to them, but migrated installs that persisted 5/35 never self-heal.
- **Fix:** derive min/max from storage settings in the group entity; derive sensor units from `hass.config.units.temperature_unit`; add a migration note pointing °F users at the built-in Convert Schedules tool.

### P1 — Global-profile schedule bleed (#187)
- `_sync_group_profile_views` forces every group's `schedules` to a deepcopy of the same active global profile on every save (`storage.py:346-392`); edits mirror back into the shared profile (`storage.py:1632-1633`); runtime reads project global profiles (`storage.py:1524-1537`).
- `async_add_entity` keys single-entity groups by friendly name and silently no-ops on collision (`storage.py:728-760`) — duplicate-named TRVs collide without error.
- Matches reporter's "all profiles became copies of one room" exactly.
- **Fix:** first reproduce with 3 groups; then design decision — per-group schedule isolation vs. documented global-profile semantics — plus friendly-name collision handling.

### P2 — Device/entity lifecycle (#130 + #144, same root cause)
- `async_unload_entry` never removes device-registry entries (`__init__.py:374-399`); no `async_remove_config_entry_device` anywhere. Orphaned devices always show undeletable.
- No `state_removed`/`entity_registry_updated` listeners → deleted climate entities remain as phantom members (mitigation: manual `cleanup_unmonitored_storage`, `storage.py:1091-1150`, but users report phantoms persist on v1.15.1).
- **Fix:** implement `async_remove_config_entry_device` + auto-prune on entity-removal event. Highest-priority item in this cluster.

### P2 — Stale raw-storage reads in climate/switch entities (#160)
- `_handle_coordinator_update` reads raw `self._storage._data` (`climate.py:184-197`) instead of the projected runtime view, exposing legacy profile names as presets; renamed profiles make `async_set_preset_mode` raise "Profile does not exist" (`climate.py:452-455`). Same raw-data pattern in `switch.py:140-147`.
- **Fix:** one-line-class change — use `_project_group_runtime_view`/`async_get_group` here, mirroring the setup path.

### P2 — Temperature applied after turn_off (#181)
- Auto-tick (`coordinator.py:959-1018`) and advance path call `set_temperature` unconditionally after `turn_off`; devices that treat temp-set ≠ null as "on" (Fritz TRVs) re-enable immediately.
- **Fix:** per-node or per-entity "skip temperature when off" option (other device classes want the opposite — not a global flip). Related: #126.

### P3 — Quick wins
- **#196 duplicate resource registration:** registration loop keeps only the last URL match and swallows failed deletes at debug level (`__init__.py:264-293`) — collect all matches, delete all, create once, log warnings.
- **#146 default schedule ignored on group creation:** `async_create_group` hardcodes a single 18° node (`storage.py:1453-1477`) instead of using `_get_default_schedule_template()` (`storage.py:421-435`) — the clear-schedule path already uses the template.
- **#175 switch entity latency:** `async_turn_on/off` toggles storage then writes state, but `is_on` reads a cache that's never updated locally (`switch.py:117-124, 178-195, 400-410`) — update local state (or await refresh) before `async_write_ha_state`.
- **#186 24:00 warnings:** `validate_node` normalizes 24:00 only in local vars and saved schedules are never normalized (`storage.py:36-39`, only call site `storage.py:334`); `switch.py:255-258` then raises on `int("24")` forever. Frontend boundary-drag clamp-then-snap can re-round to exactly 24:00 (`src/keyframe-timeline.ts:1497-1504`). Normalize times at load/save backend-side and fix the clamp/snap order.

## Likely Fixed — close after confirmation

| # | Fixed by | Note |
|---|---|---|
| #173 | PR #200 (`355369f`) | Exactly the reported throw site (`app.js` subscribeToEvents unauthorized catch). Users on release builds still affected — ship a release, then retest. |
| #169 | v1.15.1 `d038dde` profile-resolution rewrite | Reporter's dump matches the dual-pointer design `_resolve_group_active_global_profile` now handles (`storage.py:456-463`); needs reporter confirmation. |
| #168 | `d038dde` (new migrations only) | Corrupted-by-v1.15.0 data gets no repair — migration only runs on empty registries. Decide: repair migration vs. manual recovery doc. |
| #161 | Global-profiles diagnostics rewrite | Diagnostics flows through profile-aware `async_get_groups` (`services.py:1816-1833`); minor gap: no dedicated profiles section. Title-only issue — confirm with reporter. |
| #152 | `get_profiles` service + preset_mode attribute | Reporter explicitly approved closing. |
| #145 | `delete_group` service + Edit-modal button (`f0703f8`) | Feature delivered in v1.15. |
| #121 | v1.15 timeline overhaul + mobile breakpoints (`22b3fd4`, `4c212d9`, `styles.css:730,806`) | Split residual mobile polish into a fresh issue if needed. |

## Stale / Needs Reporter Data

- **#198 (Danfoss LC-13):** the suspected root cause (preset-only detection via `current_temperature`) was removed in `0cae78c` before the issue was filed; reporter never supplied entity state. Re-open dialogue asking for attributes/diagnostics from a current build.
- **#180 (3:00 revert):** main never writes a previous setpoint back — no revert mechanism exists. Exact-hour-only failure pattern suggests an external 3 AM job. Latent gap worth noting: null-temp nodes without `noChange` are silently skipped; the remediation branch (C2/C3 validation) would reject them at the service boundary.
- **#195, #188:** reporter diagnostics show healthy registration; localStorage theory in #188 doesn't hold cross-origin (hostname vs IP are different origins). Plausible real cause in #188 is backend last-write-wins between two editor sessions. Need fresh data or close with explanation.
- **#176 (rename error):** rename-to-existing raises ValueError → toast is expected behavior; switch entities keyed by group name go stale after rename (`switch.py:95-105`). Need the reporter's exact error text.

## Enhancements (all still valid)

| # | Summary | State |
|---|---|---|
| #203 | Always-visible group previews + edit mode | **Contributor supplied a full patch for v1.15.1** — review, build/test, merge or direct |
| #190 | Show entity_id when friendly names collide | Small; presentation decision needed |
| #189 | Card shows schedule temp during manual override | Data is protected; display-only; show override target while `override_until` active |
| #141 | Time-slot targeting for advance | Index-based design viable (thread analysis); event payload already carries node data |
| #136 | Per-entity profile override | Superseded by global-profile architecture; re-scope or close |
| #143 | Attributes → sensors | Partial (coldest/warmest/rate exist); needs scoping decision |
| #115 | "All Zones" virtual target | **Docs currently promise what code rejects** — fix `documents/ACTIONS.md` or implement fan-out target |
| #107 | Release test plan | Local branch + `origin/feature/test-suite` both have suites; reconcile & merge |
| #92 | Condition-gated nodes | Owner design sketch pending; minimal path = condition hook in coordinator tick |
| #84 | Timed boost | `advance_schedule` override machinery reusable for duration+offset service |
| #76 | Alt temperature sensor override | Auto-selection only; blocked on design (1.16 per owner) |
| #59 | Per-schedule card | Card is all-or-nothing today; needs `schedule_id`/`read_only` config |
| #54 | Ventilation support | Node fan/preset fields exist; window-sensor integration deferred to 1.16 |
| #162 | Release checklist | Fold into pytest suite + release script as umbrella |

## Answerable / Doc Gaps

- **#157:** A/B/C fields are documented only in `documents/AUTOMATION_EVENTS.md:79-81, 287`; Cancel Advance exists since v1.15.0. Reply + README section, then close.
- **#61:** Substantial docs exist (`ACTIONS.md` 700+ lines, `AUTOMATION_EVENTS.md`, `DEVELOPMENT.md`) but no end-user walkthrough — deferred by owner until UI freeze; keep as backlog.
- **#164:** Card width is governed by Lovelace layout (`.wrapper { width: 100% }`); answer with grid/layout-card guidance.

## Cross-Session Notes

- The local `feature/code-review-remediation` branch (C1–C3 validation hardening) directly intersects triaged issues: #180's null-temp silent-skip and #181's temp-after-off paths. Red-team blockers C7/C8 from `custom_components/climate_scheduler/Code Review.md` still gate that branch.
- `origin/feature/test-suite` holds a larger suite (~175 tests incl. migrations/coordinator coverage) than the local remediation branch harness (~6 tests + CI). Reconcile before merging either (#107).
- Releases: v1.15.1 (2026-03-01) is the last published release; main since contains #167+#200 fix commits affecting #198-suspect logic, #173, #169, #168. Ship a release before closing any user-visible issue.