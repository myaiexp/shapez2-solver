// End-to-end tests for the Constructive decompose-and-search planner.
// Run with: node tests/solver/constructive.test.js
//
// Every emitted step is re-validated as a real operation (output === the actual
// op applied to its inputs) via the shared tests/shared/pathValidation.js — the
// spliced/id-remapped path must be physically constructible, not just plausible.
// Three separate things can go wrong with a spliced path, so all three shared
// gates run: the ops must be real, the ids must flow (each consumed once — the
// planner reuses shared sub-plans, and a reused product needs a Belt Split or a
// second feed, never one id handed to two machines), and the FINAL INVENTORY
// must hold the target (not merely the last step's output, which says nothing
// about what the rest of the path consumed).
import { solveConstructive } from '../../shapeSolverConstructive.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { invalidPathSteps, invalidPathIds, pathReachesTarget } from '../shared/pathValidation.js';

const DEFAULT_STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
const ALL_OPS = Object.keys(operations);
const cfg = new ShapeOperationConfig(4);

let passed = 0, total = 0, failed = false;
function assert(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — assertion failed${detail ? `: ${detail}` : ''}`); failed = true; }
}

// The three gates, each reported with the shared validator's own reasons so a
// failure names the offending step rather than just flipping a boolean.
function assertPathIsBuildable(label, path, target) {
    const badSteps = invalidPathSteps(path, cfg);
    assert(`${label} every step is a real op`, badSteps.length === 0, badSteps.join(' | '));
    const badIds = invalidPathIds(path, { starts: DEFAULT_STARTS });
    assert(`${label} id flow is buildable (single-consume)`, badIds.length === 0, badIds.join(' | '));
    assert(`${label} final inventory holds the target`,
        pathReachesTarget(path, target, { starts: DEFAULT_STARTS, config: cfg }));
}

async function run() {
    // --- CuRuSuWu: the headline multi-distinct-quadrant target ---------------
    {
        const r = await solveConstructive('CuRuSuWu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRuSuWu solved', !!r.solutionPath);
        assertPathIsBuildable('CuRuSuWu', r.solutionPath, 'CuRuSuWu');
        assert('CuRuSuWu sane op count (<=20)', r.solutionPath.length <= 20);

        // strategyTrace: by-quadrant at the root, direct-search leaves.
        assert('CuRuSuWu root method is by-quadrant', r.strategyTrace.method === 'by-quadrant');
        assert('CuRuSuWu children are all direct-search',
            r.strategyTrace.children.length === 4 &&
            r.strategyTrace.children.every((c) => c.method === 'direct-search'));
        assert('CuRuSuWu statesExplored aggregated', r.statesExplored > 0);
    }

    // --- CuRu----: a two-quadrant flat target --------------------------------
    {
        const r = await solveConstructive('CuRu----', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRu---- solved', !!r.solutionPath);
        assertPathIsBuildable('CuRu----', r.solutionPath, 'CuRu----');
    }

    // --- CuCuCuRu: should stay well under a naive 4-independent-quadrant build -
    {
        const r = await solveConstructive('CuCuCuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuCuRu solved', !!r.solutionPath);
        assertPathIsBuildable('CuCuCuRu', r.solutionPath, 'CuCuCuRu');
        assert('CuCuCuRu op count < 15', r.solutionPath.length < 15);
    }

    // --- clever shortcut preserved: CuCuRuRu via direct search (1 Swapper) ----
    {
        const r = await solveConstructive('CuCuRuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuRuRu solved', !!r.solutionPath);
        assert('CuCuRuRu via direct-search (no decomposition)', r.strategyTrace.method === 'direct-search');
        assertPathIsBuildable('CuCuRuRu', r.solutionPath, 'CuCuRuRu');
        assert('CuCuRuRu op count <= 2', r.solutionPath.length <= 2);
    }

    // --- multi-layer target --------------------------------------------------
    {
        const r = await solveConstructive('CuCuCuCu:RuRuRuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuCuCu:RuRuRuRu solved', !!r.solutionPath);
        assertPathIsBuildable('CuCuCuCu:RuRuRuRu', r.solutionPath, 'CuCuCuCu:RuRuRuRu');
    }

    // --- a multi-layer target that genuinely needs by-layer decomposition ----
    // Two distinct multi-quadrant layers — the top direct search caps, by-layer
    // peels them, each layer is itself solved (by-quadrant) and stacked.
    {
        const r = await solveConstructive('CuRuSuWu:WuSuRuCu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRuSuWu:WuSuRuCu solved', !!r.solutionPath);
        assertPathIsBuildable('CuRuSuWu:WuSuRuCu', r.solutionPath, 'CuRuSuWu:WuSuRuCu');
        assert('CuRuSuWu:WuSuRuCu used a decomposition', r.strategyTrace.method !== 'direct-search');
    }

    // --- REUSE: identical pieces share one sub-plan, so its product must be
    // copied, never double-spent. Two shapes of reuse, and both matter:
    //   • CuRu----:CuRu---- reuses a BUILT intermediate -> needs a Belt Split
    //   • CuCuCuCu:CuCuCuCu reuses a bare STARTING shape -> a second feed, free
    // Before the fix, flatten handed one global id to both Stacker inputs and
    // every code-level gate still passed, so this is what invalidPathIds guards.
    {
        const r = await solveConstructive('CuRu----:CuRu----', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRu----:CuRu---- solved', !!r.solutionPath);
        assertPathIsBuildable('CuRu----:CuRu----', r.solutionPath, 'CuRu----:CuRu----');
        assert('CuRu----:CuRu---- fans the shared intermediate out with a Belt Split',
            r.solutionPath.some((s) => s.operation === 'Belt Split'));
        assert('CuRu----:CuRu---- builds the shared piece once (not twice)',
            r.solutionPath.filter((s) => s.operation === 'Stacker').length === 2);
    }
    {
        const r = await solveConstructive('CuCuCuCu:CuCuCuCu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuCuCu:CuCuCuCu solved', !!r.solutionPath);
        assertPathIsBuildable('CuCuCuCu:CuCuCuCu', r.solutionPath, 'CuCuCuCu:CuCuCuCu');
        assert('CuCuCuCu:CuCuCuCu draws a second feed instead of splitting a belt',
            r.solutionPath.length === 1 && r.solutionPath[0].operation === 'Stacker');
    }

    // --- reuse with Belt Split DISABLED: the planner must not emit an operation
    // the user excluded, so a reused intermediate is re-built in its own id range.
    {
        const noSplit = ALL_OPS.filter((op) => op !== 'Belt Split');
        const r = await solveConstructive('CuRu----:CuRu----', DEFAULT_STARTS, noSplit, { maxLayers: 4 });
        assert('CuRu----:CuRu---- (no Belt Split) solved', !!r.solutionPath);
        assertPathIsBuildable('CuRu----:CuRu---- (no Belt Split)', r.solutionPath, 'CuRu----:CuRu----');
        assert('CuRu----:CuRu---- (no Belt Split) emits no disabled op',
            !r.solutionPath.some((s) => !noSplit.includes(s.operation)));
        assert('CuRu----:CuRu---- (no Belt Split) re-builds the shared piece',
            r.solutionPath.filter((s) => s.operation === 'Stacker').length === 3);
    }

    // --- cancellation returns a null path ------------------------------------
    {
        const r = await solveConstructive('CuRuSuWu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4, shouldCancel: () => true });
        assert('cancellation returns null solutionPath', r.solutionPath === null);
    }

    console.log(`\n${passed}/${total} passed`);
    if (failed) process.exit(1);
}

run();
