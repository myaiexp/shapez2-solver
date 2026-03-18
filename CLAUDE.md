# Shapez 2 Solver

> Web-based tool that finds efficient solutions for creating target shapes in Shapez 2, showing visual flowcharts of operation steps.

## Stack

- **Language**: Vanilla JavaScript (ES modules)
- **UI**: Plain HTML + CSS, no framework
- **Graph visualization**: Cytoscape.js (loaded via CDN in index.html)
- **No build system** — static files served directly, all imports via ES module `<script type="module">`

## Project Structure

```
index.html              — Main page, all UI markup (tabs: Flowchart + Blueprint)
styles.css              — All styling
main.js                 — Entry point: UI wiring, event handlers, orchestration
shapeSolver.js          — BFS and A* search algorithms, solver logic (724 lines)
shapeOperations.js      — Shape class, all operations (cut, rotate, stack, paint, etc.) (761 lines)
shapeRendering.js       — Canvas-based shape rendering with color modes (443 lines)
operationGraph.js       — Cytoscape.js graph: layout, rendering, export (461 lines)
buildingData.js         — Building definitions for all 12 solver operations (121 lines)
blueprintLayout.js      — Converts solutionPath to spatial grid layout (726 lines)
blueprintRenderer.js    — Canvas renderer with pan/zoom/hover for blueprint view (653 lines)
shapeValidation.js      — Input validation (125 lines)
shapeColorData.js       — Shape/color type constants, parsing utilities (71 lines)
shapeBuilder.js         — Visual shape builder UI (443 lines, cut from production)
images/                 — Operation icons for graph nodes
.claude/
  ideas.md              — Feature ideas, tech debt, things worth revisiting
  phases/               — Phase docs (current.md symlink → active phase)
  plans/                — Archived design/implementation plans for completed features
  references/           — Game mechanics reference, optimization plan, blueprint reference
```

## Key Patterns

- **No build step** — everything runs as vanilla ES modules in the browser
- **Shape codes** use Shapez 2 notation (e.g., `CuRuSuWu`, `P-P-P-P-`, multi-layer with `:` separator)
- **Two search algorithms**: BFS (breadth-first, exhaustive) and A\* (heuristic, faster for complex shapes)
- **Graph rendering** via Cytoscape.js with multiple edge styles (curved, straight, orthogonal, stepped)
- **Color modes**: RGB, RYB, CMYK — affects both shape rendering and available paint colors
- **Shape builder** was prototyped but cut from production in latest commit — lives in `shapeBuilder.js`
- **Blueprint view** converts solver output to a 2D factory grid layout with machines and belt routing, rendered on canvas with pan/zoom/hover
- **Tabbed output**: Flowchart (Cytoscape.js graph) and Blueprint (canvas grid) views, switchable via tabs

## Known Issues / Tech Debt

- Several files exceed 300 lines (shapeOperations.js: 761, blueprintLayout.js: 726, shapeSolver.js: 724, blueprintRenderer.js: 653) — candidates for splitting
- Blueprint layout is single-floor only (floor switching UI exists but all machines placed on floor 0)
- Blueprint belt routing uses simple L-shaped paths, no obstacle avoidance
- Building data footprints not fully verified against in-game values
- No tests, no linter configured
- Forked originally from another solver repo; added A\* search and visual improvements

---

## Current Phase

**Phase 1: Factory Blueprint MVP** — COMPLETE. Canvas-based 2D factory blueprint view with machine placement and belt routing.

Details: `.claude/phases/current.md`

**Next up**: Solver performance optimization — see `.claude/references/solver-optimization-plan.md` for analysis and prioritized improvements (caching, backward search, symmetry reduction, operation pruning, IDA\*).

### Decisions from previous phases

- A\* search algorithm added alongside BFS for faster solving
- Shape builder UI prototyped then cut from production (kept in separate module)
- Cytoscape.js chosen for graph visualization
- Color mode support (RGB/RYB/CMYK) added
- Blueprint layout: top-to-bottom flow, Belt Splits as pass-through topology, L-shaped belt routing
- Blueprint renderer: create/destroy on tab switch, ResizeObserver for responsive canvas, DPI-aware

---

## Doc Management

This project splits documentation to minimize context usage. Follow these rules:

### File layout

| File                         | Purpose                                                        | When to read                              |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `CLAUDE.md` (this file)      | Project identity, structure, patterns, current phase pointer   | Auto-loaded every session                 |
| `.claude/phases/current.md`  | Symlink → active phase file                                    | Read when starting phase work             |
| `.claude/phases/NNN-name.md` | Phase files (active via symlink, completed ones local-only)    | Only if you need historical context       |
| `.claude/ideas.md`           | Future feature ideas, tech debt, and enhancements              | When planning next phase or brainstorming |
| `.claude/plans/`             | Design docs and implementation plans from brainstorming        | When implementing or reviewing designs    |
| `.claude/references/`        | Domain reference material (specs, external docs, data sources) | When you need domain knowledge            |
| `.claude/[freeform].md`      | Project-specific context docs (architecture, deployment, etc.) | As referenced from this file              |

### Phase transitions

1. **Condense** — extract lasting decisions from the active phase file and add to "Decisions from previous phases". Keep each to 1-2 lines.
2. **Archive** — remove the `current.md` symlink. The completed phase file stays but is no longer committed.
3. **Start fresh** — create a new numbered phase file from `~/.claude/phase-template.md`, then symlink `current.md` → it.
4. **Update this file** — update the "Current Phase" section above.
5. **Prune** — remove anything from this file that was phase-specific and no longer applies.
