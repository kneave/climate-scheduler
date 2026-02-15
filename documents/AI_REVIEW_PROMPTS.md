# AI Review Prompt Starters

Purpose: short, reusable prompts that keep token use low.

## 1) Focused Bug Hunt

Review only custom_components/climate_scheduler/frontend/app.js for likely causes of [symptom].
Constraints:
- minimal patch only
- no unrelated refactor
- top 3 root-cause candidates + confidence
- explicit verification checklist

## 2) Contract Drift Check

Check drift between src/keyframe-timeline.ts + src/climate-dialog.ts payloads and
custom_components/climate_scheduler/services.py + storage.py validators.
Output:
- mismatched fields/types/defaults
- invariant gaps
- minimal remediation path

## 3) Change-Safe Refactor

Refactor saveSchedule/performSave in app.js without behavior change.
Constraints:
- preserve event payloads and service calls
- keep edits local to app.js
- include risk notes and rollback plan

## 4) Performance Pass

Inspect graph hover + node settings flow in src/keyframe-timeline.ts and app.js.
Output:
- top bottlenecks
- reason each is expensive
- no-risk optimizations first

## 5) PR-Style Review

Review changed files only; classify findings as Critical / Medium / Low.
For each: impact, exact location, minimal fix.

Suggested file set:
- src/keyframe-timeline.ts
- src/climate-dialog.ts
- custom_components/climate_scheduler/frontend/app.js
- custom_components/climate_scheduler/coordinator.py
- custom_components/climate_scheduler/storage.py

## 6) Context Snapshot Refresh

Update documents/CONTEXT_SNAPSHOT.md in <=120 lines.
Include only current architecture, source-of-truth rules, active conventions, hotspots, and open risks.
