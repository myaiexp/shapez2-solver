// End-to-end tests for the Constructive decompose-and-search planner.
// Run with: node tests/solver/constructive.test.js
//
// Every emitted step is re-validated as a real operation (output === the actual
// op applied to its inputs) via the shared tests/shared/pathValidation.js — the
// spliced/id-remapped path must be physically constructible, not just plausible.
import { solveConstructive } from '../../shapeSolverConstructive.js';
import { operations } from '../../shapeSolverCore.js';
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { getAllRotations } from '../../shapeOperations.js';
import { pathIsValid } from '../shared/pathValidation.js';

const DEFAULT_STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
const ALL_OPS = Object.keys(operations);
const cfg = new ShapeOperationConfig(4);

let passed = 0, total = 0, failed = false;
function assert(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — assertion failed`); failed = true; }
}

// A solution path is valid when every step is a real op under this test's layer
// config (cfg); the shared validator re-runs each op and checks outputs ⊆ produced.
const everyStepValid = (path) => pathIsValid(path, cfg);
function isAcceptableRotation(code, target) {
    return getAllRotations(Shape.fromShapeCode(target), cfg).has(code);
}
function lastProducesTarget(path, target) {
    if (!path.length) return false;
    return path[path.length - 1].outputs.some((o) => isAcceptableRotation(o.shape, target));
}

async function run() {
    // --- CuRuSuWu: the headline multi-distinct-quadrant target ---------------
    {
        const r = await solveConstructive('CuRuSuWu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRuSuWu solved', !!r.solutionPath);
        assert('CuRuSuWu every step is a real op', everyStepValid(r.solutionPath));
        assert('CuRuSuWu final output is the target', lastProducesTarget(r.solutionPath, 'CuRuSuWu'));
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
        assert('CuRu---- every step valid', everyStepValid(r.solutionPath));
        assert('CuRu---- final output is the target', lastProducesTarget(r.solutionPath, 'CuRu----'));
    }

    // --- CuCuCuRu: should stay well under a naive 4-independent-quadrant build -
    {
        const r = await solveConstructive('CuCuCuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuCuRu solved', !!r.solutionPath);
        assert('CuCuCuRu every step valid', everyStepValid(r.solutionPath));
        assert('CuCuCuRu final output is the target', lastProducesTarget(r.solutionPath, 'CuCuCuRu'));
        assert('CuCuCuRu op count < 15', r.solutionPath.length < 15);
    }

    // --- clever shortcut preserved: CuCuRuRu via direct search (1 Swapper) ----
    {
        const r = await solveConstructive('CuCuRuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuRuRu solved', !!r.solutionPath);
        assert('CuCuRuRu via direct-search (no decomposition)', r.strategyTrace.method === 'direct-search');
        assert('CuCuRuRu op count <= 2', r.solutionPath.length <= 2);
    }

    // --- multi-layer target --------------------------------------------------
    {
        const r = await solveConstructive('CuCuCuCu:RuRuRuRu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuCuCuCu:RuRuRuRu solved', !!r.solutionPath);
        assert('CuCuCuCu:RuRuRuRu every step valid', everyStepValid(r.solutionPath));
        assert('CuCuCuCu:RuRuRuRu final output is the target', lastProducesTarget(r.solutionPath, 'CuCuCuCu:RuRuRuRu'));
    }

    // --- a multi-layer target that genuinely needs by-layer decomposition ----
    // Two distinct multi-quadrant layers — the top direct search caps, by-layer
    // peels them, each layer is itself solved (by-quadrant) and stacked.
    {
        const r = await solveConstructive('CuRuSuWu:WuSuRuCu', DEFAULT_STARTS, ALL_OPS, { maxLayers: 4 });
        assert('CuRuSuWu:WuSuRuCu solved', !!r.solutionPath);
        assert('CuRuSuWu:WuSuRuCu every step valid', everyStepValid(r.solutionPath));
        assert('CuRuSuWu:WuSuRuCu final output is the target', lastProducesTarget(r.solutionPath, 'CuRuSuWu:WuSuRuCu'));
        assert('CuRuSuWu:WuSuRuCu used a decomposition', r.strategyTrace.method !== 'direct-search');
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
