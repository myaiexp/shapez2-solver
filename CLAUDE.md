# Shapez 2 Solver

> Web-based puzzle solver for Shapez 2. BFS/A\* search to find efficient shape assembly solutions, rendered as visual flowcharts and factory blueprints.

**Live**: https://mase.fi/shapez

## Stack

- **Language**: Vanilla JavaScript (ES modules)
- **UI**: Plain HTML + CSS, no framework
- **Graph visualization**: Cytoscape.js (loaded via CDN in index.html)
- **No build system** — static files served directly, all imports via ES module `<script type="module">`

## Project Structure

Each of the four major modules — `shapeOperations`, `shapeSolver`, `blueprintLayout`, `blueprintRenderer` — is a public-entry-point file with a small set of sibling helper files prefixed by the same name (e.g., `shapeSolverCache.js`, `blueprintTopology.js`). `shapeSolver.js` is a thin Web Worker wrapper around the algorithm in `shapeSolverCore.js`.

## Deployment

- **URL**: https://mase.fi/shapez/
- **Webroot**: `/var/www/html/shapez/`
- **Nginx**: location block in `/etc/nginx/sites-enabled/default` (alias to webroot)
- **Deploy**: `rsync` project files to webroot, excluding `.claude/`, `.git/`, `*.md`. See `deploy.sh`.

## Key Patterns

- **No build step** — everything runs as vanilla ES modules in the browser
- **Shape codes** use Shapez 2 notation (e.g., `CuRuSuWu`, `P-P-P-P-`, multi-layer with `:` separator)
- **Two search algorithms**: BFS (breadth-first, exhaustive) and A\* (heuristic, faster for complex shapes)
- **Graph rendering** via Cytoscape.js with multiple edge styles (curved, straight, orthogonal, stepped)
- **Color modes**: RGB, RYB, CMYK — affects both shape rendering and available paint colors
- **Blueprint view** converts solver output to a 2D factory grid layout with machines and belt routing, rendered on canvas with pan/zoom/hover
- **Tabbed output**: Flowchart (Cytoscape.js graph) and Blueprint (canvas grid) views, switchable via tabs

## Known Issues / Tech Debt

- Blueprint layout is single-floor only (floor switching UI exists but all machines placed on floor 0)
- Blueprint belt routing uses simple L-shaped paths, no obstacle avoidance
- Building data footprints not fully verified against in-game values
- No tests, no linter configured
- Forked originally from another solver repo; added A\* search and visual improvements

## Conventions

- **No first-line description comments on source files.** This is a public repo; filenames are descriptive enough. The auto-generated context tree convention used in private projects does not apply here.
- **Orchestrator exception to the 300-line rule.** A few files intentionally exceed 300 lines because their job is coordinating tightly-coupled steps that don't extract cleanly:
  - `shapeSolverCore.js` (~800 lines) — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a SolverContext object — both worse than the current shape.
  - `blueprintRenderer.js` (~430 lines) — class shell that owns canvas state, event handlers, tooltip DOM, and the public API. Each method does one named thing; splitting tooltip/events into separate modules would require threading instance state through.
- **Smoke test before commit.** Run `node tests/smoke.js` after any change to solver, layout, or shape-operations code.

## Roadmap & Ideation

This project uses Helm's project management tools, not local files:

- **Roadmap**: `helm roadmap show shapez2-solver` — see current phase and items
- **Ideas**: `helm idea list shapez2-solver` — capture tech debt, features, improvements
- **Add idea**: `helm idea add shapez2-solver "<title>" "<summary>" "<details>" "<category>" <impact> <complexity>`

### Historical decisions

- A\* search algorithm added alongside BFS for faster solving
- Cytoscape.js chosen for graph visualization
- Color mode support (RGB/RYB/CMYK) added
- Blueprint layout: top-to-bottom flow, Belt Splits as pass-through topology, L-shaped belt routing
- Blueprint renderer: create/destroy on tab switch, ResizeObserver for responsive canvas, DPI-aware
- Shape builder UI was prototyped in Phase 0 then cut from production (removed from codebase 2026-04-16)
