# Testing

Tests are plain `node tests/**/*.js` scripts (no framework), grouped by subsystem into `tests/{shape,solver,blueprint,shared}/` — mirroring the source's prefix-grouping.

`shared/` holds the harness (`fixtures.js`, `smoke.js`, `solve.mjs`, `snapshots.json`, `similarity.js`, `pathValidation.js`) plus cross-cutting app tests (`colorMode`, `persistence`, `exploreDepth`, `pathInventory`).

The full suite is zero-dependency and runs in well under a second. Each file `process.exit(1)`s on failure, so exit codes drive both gates below. Before committing solver/layout/shape-operations changes, run `node tests/shared/smoke.js` (snapshot suite + per-step solution-path validation) and the relevant `tests/**/*.test.js` unit suites.

Shape ops must never mutate their input `Shape` objects — the solver shares parsed shapes via `getCachedShape`, so in-place mutation corrupts the cache and yields impossible paths; `tests/shape/shapeCacheIntegrity.test.js` guards this.

`similarity.js` is the solver's retired pre-#1677 heuristic — test-only, kept because smoke snapshots it as a pure op; never import it from app code.

## Path-validation gate

`tests/shared/pathValidation.js` is the single correctness gate behind every harness and suite that validates a path. A path must clear three independent checks:

1. every step replays as a real op
2. the ids flow physically (each consumed once; fan-out needs a `Belt Split`)
3. the final inventory holds the target (a zero-op path passes iff a starting shape is acceptable)

It has its own unit suite, `pathValidation.test.js`, because a hole in the gate silently unblocks every importer at once. Production inventory predicates (`pathReachesTarget`, `pathInventoryAcceptable`, `acceptableCodes`) live in `pathInventory.js` and are re-exported from `pathValidation.js` so harness imports stay one-stop.

## Two gates, same suite

CI (the `test` job in `.github/workflows/pages.yml`) runs the suite on every push to `master`, and the Pages **deploy is gated on it** (`deploy: needs: test`) — a red test blocks shipping to mase.fi/shapez.

Both gates discover `tests/**/*.test.js` into an array (quoted iteration, so paths with spaces stay one file), refuse to proceed if fewer than 30 files matched (an empty `find` used to make the loop succeed vacuously), then run `node tests/shared/smoke.js` and two cheap `solve.mjs` invocations. Keep the floor and the `solve.mjs` lines in lockstep between the workflow and `.githooks/pre-commit`.

Locally, `.githooks/pre-commit` runs it before each commit; activate once per clone with `git config core.hooksPath .githooks` (bypass a single commit with `git commit --no-verify`).

## Headless solve/explore harness

`node tests/shared/solve.mjs` runs a solve (or `--explore N`) from the CLI and validates every step is a real operation. Use it to reproduce and diagnose solver/operation bugs without the browser. CI and pre-commit each run one solve (`CuCu----` / Cutter) and one `--explore 2` so a signature change in the modules it wraps fails the gate.

Flag set, methods, and defaults live in the usage header at the top of `tests/shared/solve.mjs` — read that rather than copying a subset here.
