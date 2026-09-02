# Shapez 2 Solver

> Web-based puzzle solver for Shapez 2. BFS/A\* search to find efficient shape assembly solutions, rendered as visual flowcharts and factory blueprints.

**Live**: https://mase.fi/shapez

## Stack

- **Language**: Vanilla JavaScript (ES modules)
- **UI**: Plain HTML + CSS, no framework
- **Graph visualization**: Cytoscape.js 3.33.4 + cytoscape-dagre 3.0.0 (flowchart); three.js 0.160.1 + 3d-force-graph 1.79.1 (space explorer). All four loaded via CDN in `index.html`.
- **No build system** — static files served directly, all imports via ES module `<script type="module">`
- **CSP + SRI** — `index.html` sets a strict Content-Security-Policy (`script-src 'self' https://unpkg.com https://cdn.jsdelivr.net`, `object-src 'none'`, `form-action 'none'`, …) and every CDN script carries an SRI `integrity` hash. Adding a library or bumping a version requires updating both the `script-src` host list and the hash.

## Project Structure

Each of the four major modules — `shapeOperations`, `shapeSolver`, `blueprintLayout`, `blueprintRenderer` — is a public-entry-point file with a small set of sibling helper files prefixed by the same name (e.g., `shapeSolverCache.js`, `blueprintTopology.js`). `shapeSolver.js` is a thin Web Worker wrapper around the algorithm in `shapeSolverCore.js`. The space explorer is a fifth cluster: `shapeExplorerCore.js` plus `operationGraphSpace.js` (3D force graph).

## Deployment

Hosted on **GitHub Pages**. Pushing to `master` triggers `.github/workflows/pages.yml`, which assembles the static app (excluding dev files) and publishes it.

- **Canonical URL**: https://myaiexp.github.io/shapez2-solver/
- **Friendly URL**: `mase.fi/shapez` 301-forwards to Pages (including all subpaths) via a Cloudflare redirect rule.
- **Deploy**: run `deploy` (or any push to `master`) — the Pages Action republishes. The `__COMMIT__` cache-buster is stamped to the short SHA by the workflow, so `?v=<sha>` assets bust on every change.
- **No VPS hosting** — hosting moved to Pages (2026-06-09); there is no server webroot or nginx config to deploy into. `deploy.sh` is retained only as a signpost.

## Key Patterns

- **No build step** — everything runs as vanilla ES modules in the browser
- **Shape codes** use Shapez 2 notation (e.g., `CuRuSuWu`, `P-P-P-P-`, multi-layer with `:` separator)
- **Search methods**: BFS, A\*, IDA\*, Bidirectional, and **Constructive** (decompose-and-search for hard multi-quadrant targets; see [solver internals](docs/solver-internals.md))
- **Flowchart** via Cytoscape.js with multiple edge styles (curved, straight, orthogonal, stepped)
- **Space explorer** — BFS of the transformation space, rendered as a `ForceGraph3D` (three.js) that replaces the flowchart view; UI depth is clamped (see [solver internals](docs/solver-internals.md))
- **Color modes**: RGB, RYB, CMYK — affects both shape rendering and available paint colors
- **Blueprint view** converts solver output to a 2D factory grid layout with machines and belt routing, rendered on canvas with pan/zoom/hover
- **Blueprint string export** — `Copy Blueprint` produces a `SHAPEZ2-2-…$` string pasteable into the game (`blueprintExport.js`; format in [blueprint reference](docs/shapez-2-blueprint-reference.md))
- **Tabbed output**: Flowchart (Cytoscape.js) and Blueprint (canvas grid), switchable via tabs
- **localStorage persistence** — restores solver inputs, last solution, and view state across refresh (`persistence.js`; [design](docs/plans/2026-04-22-persistent-solver-state-design.md)). `Reset Saved State` clears it.
- **Solver options**: `preventWaste`, `orientationSensitive`, `monolayerPainting`, `filterUnusedShapes`, and `throughputMultiplier` (duplicates machines in the blueprint layout and inserts splitters/mergers)

## Known Issues / Tech Debt

- Blueprint layout is single-floor only (floor switching UI exists but all machines placed on floor 0)
- Blueprint belt routing uses simple L-shaped paths, no obstacle avoidance
- Building data footprints not fully verified against in-game values
- No linter configured (tests do exist — see [testing](docs/testing.md))
- A\* coverage heuristic is intentionally inadmissible (weighted A\*); paths aren't guaranteed shortest — [solver internals](docs/solver-internals.md)
- Three distinct search budgets (`maxStates`, `maxStatesPerLevel`, `nodeBudget`) — the browser leaves the global ceiling uncapped; do not call the shared input "Max States". Details: [solver internals](docs/solver-internals.md)
- Space explorer has no state cap; UI depth is clamped to 1–8 — [solver internals](docs/solver-internals.md)
- Multi-distinct-quadrant targets (`CuRuSuWu` and kin) are not found by forward search at any reasonable cap; **Constructive** decomposes and assembles them. Scope, abort codes, inventory rules: [solver internals](docs/solver-internals.md). Design: [2026-06-11](docs/plans/2026-06-11-recursive-decompose-search-design.md)
- Forked originally from another solver repo; added A\* search and visual improvements

## Conventions

- **No first-line description comments** on source files (public repo; filenames are enough). File-size exceptions and the 300-line rule: [architecture conventions](docs/architecture-conventions.md)
- **Tests** are plain `node tests/**/*.js` scripts. Layout, the path-validation gate, CI/pre-commit, and the headless harness: [testing](docs/testing.md)

## Documentation

All docs live under `docs/` (design/plan pairs under `docs/plans/`). `.claude/` is Helm session context only.

### Maps

- [testing.md](docs/testing.md) — test layout, pathValidation gate, CI/pre-commit, `solve.mjs`
- [architecture-conventions.md](docs/architecture-conventions.md) — 300-line rule, orchestrator exceptions
- [solver-internals.md](docs/solver-internals.md) — heuristic, budgets, explorer bound, Constructive scope and abort codes

### Design

- [factory-blueprint-design.md](docs/plans/2026-03-04-factory-blueprint-design.md) — 2D factory layout from solver output
- [factory-blueprint-impl.md](docs/plans/2026-03-04-factory-blueprint-impl.md) — implementation plan for the blueprint view
- [modularize-large-files-design.md](docs/plans/2026-04-18-modularize-large-files-design.md) — split of the original 300+ line files
- [modularize-large-files-plan.md](docs/plans/2026-04-18-modularize-large-files-plan.md) — implementation plan for that split
- [persistent-solver-state-design.md](docs/plans/2026-04-22-persistent-solver-state-design.md) — localStorage restore of inputs/solution/view
- [persistent-solver-state-plan.md](docs/plans/2026-04-22-persistent-solver-state-plan.md) — implementation plan for persistence
- [recursive-decompose-search-design.md](docs/plans/2026-06-11-recursive-decompose-search-design.md) — Constructive decompose-and-search
- [recursive-decompose-search-plan.md](docs/plans/2026-06-11-recursive-decompose-search-plan.md) — implementation plan for Constructive

### References

- [shapez-2-reference.md](docs/shapez-2-reference.md) — in-game machine footprints, belt mechanics
- [shapez-2-blueprint-reference.md](docs/shapez-2-blueprint-reference.md) — `SHAPEZ2-2-…$` string format (`blueprintExport.js` `@see`s this)

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
