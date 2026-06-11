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

Hosted on **GitHub Pages**. Pushing to `master` triggers `.github/workflows/pages.yml`, which assembles the static app (excluding dev files) and publishes it.

- **Canonical URL**: https://myaiexp.github.io/shapez2-solver/
- **Friendly URL**: `mase.fi/shapez` 301-forwards to Pages (including all subpaths) via a Cloudflare redirect rule.
- **Deploy**: run `deploy` (or any push to `master`) — the Pages Action republishes. The `__COMMIT__` cache-buster is stamped to the short SHA by the workflow, so `?v=<sha>` assets bust on every change.
- **No VPS hosting** — hosting moved to Pages (2026-06-09); there is no server webroot or nginx config to deploy into. `deploy.sh` is retained only as a signpost.

## Key Patterns

- **No build step** — everything runs as vanilla ES modules in the browser
- **Shape codes** use Shapez 2 notation (e.g., `CuRuSuWu`, `P-P-P-P-`, multi-layer with `:` separator)
- **Search methods**: BFS (breadth-first, exhaustive), A\* (heuristic, faster for complex shapes), IDA\*, Bidirectional, and **Constructive** (decompose-and-search — splits hard multi-quadrant targets into search-sized pieces and assembles them by stacking; see Known Issues)
- **Graph rendering** via Cytoscape.js with multiple edge styles (curved, straight, orthogonal, stepped)
- **Color modes**: RGB, RYB, CMYK — affects both shape rendering and available paint colors
- **Blueprint view** converts solver output to a 2D factory grid layout with machines and belt routing, rendered on canvas with pan/zoom/hover
- **Tabbed output**: Flowchart (Cytoscape.js graph) and Blueprint (canvas grid) views, switchable via tabs

## Known Issues / Tech Debt

- Blueprint layout is single-floor only (floor switching UI exists but all machines placed on floor 0)
- Blueprint belt routing uses simple L-shaped paths, no obstacle avoidance
- Building data footprints not fully verified against in-game values
- No linter configured (tests do exist — see Conventions below)
- Solver A\* uses a per-slot **clean sub-shape coverage** heuristic (`getHeuristic`/`_matchAndCoverage` in `shapeSolverCore.js`, idea #1677): each target (layer,quadrant) is scored by the cheapest way any held shape can supply it (0 if a clean piece already covers it, up to 3 to isolate, 4 to fabricate), summed, plus a stack-to-merge term. `heuristicDivisor` (default 0.1) then weights it (weighted A\*, W = 1/divisor), so it's intentionally inadmissible for speed and paths aren't guaranteed shortest — use a larger divisor or BFS for more optimal/bounded search.
- Solver supports an optional `maxStates` cap (param, default `Infinity` — the browser app runs **uncapped** and relies on the Cancel button, since an OOM there only crashes the user's own tab). The `tests/solve.mjs` harness defaults to 100k so hard targets can't OOM helm's cgroup. On the cap the search aborts gracefully with `{ aborted: 'maxStates' }`. Successor ids are minted lazily (only for states the search keeps), so the `shapes` Map no longer grows with every edge generated (idea #1675).
- **Multi-distinct-quadrant targets are now solved by the Constructive method (was: not solvable by forward search at any cap).** Reachable, genuinely simple targets like `CuRuSuWu` (one quadrant cut from each of the four default starts, then stacked, ~15 ops) are NOT found within any reasonable state cap by A\*/BFS/IDA\*/Bidirectional — the wall is **frontier width / state multiplicity near the goal** (thousands of near-equivalent partial assemblies over the multiset-of-shapes state space; the powerset blows up regardless of heuristic). The coverage heuristic (idea #1677) improved the gradient but did not breach this structural limit. The fix shipped as the **Constructive** method (`shapeSolverConstructive.js` + `shapeSolverDecompose.js`, design doc `docs/plans/2026-06-11-recursive-decompose-search-design.md`): it tries the bounded core A\* first at every node (so clever shortcuts like `CuCuRuRu`→1 Swapper are preserved), and only on a cap does it split the target (by-quadrant / by-half / by-layer), recurse on the pieces, and pick the cheapest assembled plan by reuse-credited op count (decomposition depth as tie-break). **Pieces are searched orientation-sensitive** so each lands in its exact target quadrant and assembly `stack`s gravity-merge with no rotation; memoised sub-targets are spliced exactly once (one producer → many consumers, ids offset into disjoint global ranges). The worker dispatches `searchMethod==='Constructive'` to it (core never imports the planner → no cycle), reusing the Max States control as the per-node budget. Scope is Tier-1: uncolored flat structural shapes (C/R/S/W in any arrangement, single- or multi-layer); color/crystal/pin tiers are deferred. Out-of-Tier-1 inputs that no split can solve return `{ aborted: 'no-decomposition' }`.
- Forked originally from another solver repo; added A\* search and visual improvements

## Conventions

- **No first-line description comments on source files.** This is a public repo; filenames are descriptive enough. The auto-generated context tree convention used in private projects does not apply here.
- **Orchestrator exception to the 300-line rule.** A few files intentionally exceed 300 lines because their job is coordinating tightly-coupled steps that don't extract cleanly:
  - `shapeSolverCore.js` (~800 lines) — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a SolverContext object — both worse than the current shape.
  - `blueprintRenderer.js` (~430 lines) — class shell that owns canvas state, event handlers, tooltip DOM, and the public API. Each method does one named thing; splitting tooltip/events into separate modules would require threading instance state through.
  - `main.js` (~515 lines) — DOM app entry point. Each handler wires one named button/event to an imported module; most lines are glue, not logic. Splitting would scatter shared module-level state (solver worker, blueprint renderer, current layout, persistence flags) across files with circular dependencies.
- **Tests are plain `node tests/*.js` scripts** (no framework). The full suite is zero-dependency and runs in well under a second. Each file `process.exit(1)`s on failure, so exit codes drive both gates below. Before committing solver/layout/shape-operations changes, run `node tests/smoke.js` (snapshot suite + per-step solution-path validation) and the relevant `tests/*.test.js` unit suites. Shape ops must never mutate their input `Shape` objects — the solver shares parsed shapes via `getCachedShape`, so in-place mutation corrupts the cache and yields impossible paths; `tests/shapeCacheIntegrity.test.js` guards this.
- **Two test gates run the same suite.** CI (the `test` job in `.github/workflows/pages.yml`) runs it on every push to `master`, and the Pages **deploy is gated on it** (`deploy: needs: test`) — a red test blocks shipping to mase.fi/shapez. Locally, `.githooks/pre-commit` runs it before each commit; activate once per clone with `git config core.hooksPath .githooks` (bypass a single commit with `git commit --no-verify`).
- **Headless solve/explore harness.** `node tests/solve.mjs <target> [--start a,b,c] [--ops ...] [--method A*|BFS] [--timeout ms] [--json]` runs a solve and validates every step is a real operation; `node tests/solve.mjs --explore <depth>` does the same for the space explorer. Use it to reproduce and diagnose solver/operation bugs from the CLI without the browser.

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
