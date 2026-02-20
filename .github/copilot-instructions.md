# Copilot Project Instructions

These instructions are for AI assistants working in this repository.

## 1) Startup Context Order (Required)

Before proposing or making changes, establish context in this order:

1. `documents/CONTEXT_SNAPSHOT.md`
2. `documents/ARCHITECTURE_MAP.md`
3. `documents/CONTRACTS.md`
4. Relevant hotspot guide(s):
   - `documents/HOTSPOTS_APP_JS.md`
   - `documents/HOTSPOTS_COORDINATOR.md`
5. ADR index and relevant ADRs:
   - `documents/adr/README.md`

If scope is unclear, default to the smallest set of files needed and ask concise clarifying questions.

## 2) Source-of-Truth Policy (Required)

- For compiled frontend components, edit only `src/*.ts`.
- Do **not** manually edit compiled artifacts in `custom_components/climate_scheduler/frontend/*.js` when TS source exists.
- `custom_components/climate_scheduler/frontend/app.js` is runtime source and may be edited directly.
- Respect `rollup.config.mjs` outputs.

## 3) Change Safety Rules

- Make minimal, targeted changes.
- Preserve event payload contracts unless explicitly changing them and updating docs.
- Preserve service payload contracts unless explicitly changing them and updating docs.
- Keep active timeline and profile timeline behavior consistent when touching node settings.
- Do not remove user-facing safeguards (e.g., delete-last-node protection) unless requested.

## 4) Required Verification After Edits

At minimum, verify impacted files for errors and run focused checks for changed behavior.

For scheduling UI changes, verify:
- node select/move/delete in active timeline
- node select/move/delete in profile timeline
- save/debounce behavior
- mode/day/profile transitions

For backend scheduling changes, verify:
- schedule mode resolution (`all_days`, `5/2`, `individual`)
- advance/cancel lifecycle
- `climate_scheduler_node_activated` event payload compatibility

## 5) Documentation Update Rules

When behavior or contracts change, update as needed:
- `documents/CONTEXT_SNAPSHOT.md`
- `documents/CONTRACTS.md`
- relevant hotspot guide
- ADR (if architectural decision with cross-file impact)

Keep documentation concise and operational.

## 6) Search/Review Hygiene

When searching for TODOs/tests/issues, avoid dependency noise by scoping to project files and excluding local virtual environments where possible.

## 7) Review Mode Preference

If user asks for “review only”, do not modify code.
If user asks for “review + fix”, patch minimal fixes and summarize risks and validation.
