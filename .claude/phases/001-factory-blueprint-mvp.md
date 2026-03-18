# Phase 1: Factory Blueprint MVP

## Goal

Add a canvas-based 2D factory blueprint view that converts solver output into a spatial layout showing machine placement and belt routing, displayed in a new tab alongside the existing flowchart.

## Status

**Implemented.** All 5 tasks complete, code reviewed and fixes applied.

## What Was Built

Three new modules + UI changes:

1. **`buildingData.js`** — Building definitions for all 12 solver operations (footprints, I/O ports, floor data). Belt Split is `null` (belt mechanic, not a building).

2. **`blueprintLayout.js`** (726 lines) — Converts solver `solutionPath` into a `BlueprintLayout` with concrete machine positions and belt tiles on a 2D grid. 4-stage pipeline: topology extraction → Kahn's toposort → row grouping → position assignment with L-shaped belt routing.

3. **`blueprintRenderer.js`** (653 lines) — Canvas renderer with pan/zoom/hover interactivity, DPI-aware rendering, floor switching, and PNG export.

4. **`index.html` + `styles.css`** — Tab switcher (Flowchart/Blueprint) in the main view area, canvas element, floor navigation controls.

5. **`main.js`** — Wiring: view tab switching initializes/destroys renderer, solver results generate layouts, floor controls, context-aware snapshot.

## Architecture Decisions

- Layout flows top-to-bottom: source shapes enter at top, operations in rows going down
- Belt Split steps are pass-through in topology (never placed as machines)
- Stacker inputs spread across columns (offset override) to avoid 2D overlap
- Renderer creates/destroys on tab switch (no idle resource usage)
- Canvas uses ResizeObserver for responsive sizing

## Known Limitations / Future Work

- All machines placed on floor 0 (floor switching UI exists but MVP is single-floor)
- Belt routing uses simple L-shaped paths (no obstacle avoidance)
- No platform/notch constraints from Shapez 2's build mechanics
- Building data (footprints, I/O positions) not fully verified against in-game values
- No belt launcher/catcher support for gap routing
