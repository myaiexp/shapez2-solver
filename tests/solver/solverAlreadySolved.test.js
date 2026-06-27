// Unit tests for the solver's already-solved / zero-step case (audit #3725) —
// run with:  node tests/solver/solverAlreadySolved.test.js
//
// The solver was never tested with the target already present in the starting
// set. Every search method checks isGoal() on the INITIAL state before
// generating any successors, so when a starting shape already equals (or, with
// preventWaste off, is merely among the inputs as) the target, the search must
// return immediately with the minimal solution: an empty solutionPath at depth
// 0, not aborted, not null. These tests pin that contract so a future refactor
// of the goal-check / path-reconstruction can't silently regress it into a
// spurious search (or a null "no solution").
import { shapeSolver, operations } from '../../shapeSolverCore.js';
import { Shape } from '../../shapeClass.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const ALL_OPS = Object.keys(operations);
const METHODS = ['A*', 'BFS', 'IDA*', 'Bidirectional'];
const noCancel = () => false;
const noop = () => {};

// Assert a result is the canonical already-solved answer: an empty (zero-op)
// solution at depth 0, found cleanly (not aborted, not a null cancel).
function assertAlreadySolved(label, res) {
    check(`${label}: returns a result object (no null/throw)`, res != null);
    check(`${label}: solutionPath is an array, not null`, res != null && Array.isArray(res.solutionPath));
    check(`${label}: solution is empty (zero ops)`, res != null && Array.isArray(res.solutionPath) && res.solutionPath.length === 0);
    check(`${label}: depth is 0`, res != null && res.depth === 0);
    check(`${label}: not flagged aborted`, res != null && !res.aborted);
}

// Thin wrapper so each call site reads as the scenario it tests. Defaults match
// the app's typical non-orientation-sensitive, no-prevent-waste solve.
function solve(target, starts, { method = 'A*', preventWaste = false, orientationSensitive = false } = {}) {
    return shapeSolver(
        target, starts, ALL_OPS,
        /* maxLayers */ 4,
        /* maxStatesPerLevel */ 1000,
        preventWaste,
        orientationSensitive,
        /* monolayerPainting */ false,
        /* heuristicDivisor */ 0.1,
        method, noCancel, noop,
        /* maxStates */ 100000
    );
}

// --- Case A: start EXACTLY equals the target — every method short-circuits ---
for (const method of METHODS) {
    const res = await solve('CuCuCuCu', ['CuCuCuCu'], { method });
    assertAlreadySolved(`${method} exact-equals`, res);
}

// --- Case B: the target is CONTAINED among several starting shapes ---
// With preventWaste off, holding an acceptable shape is enough — the extra
// RuRuRuRu/SuSuSuSu inputs do not force any work. Cover every method.
for (const method of METHODS) {
    const res = await solve('CuCuCuCu', ['RuRuRuRu', 'CuCuCuCu', 'SuSuSuSu'], { method });
    assertAlreadySolved(`${method} contained-among-starts`, res);
}

// --- Case C: a ROTATION of the target counts as already-solved when the solve
// is not orientation-sensitive (the acceptable set spans all rotations). ---
{
    // Generate a genuine, non-identity rotation rather than hardcoding the code.
    const rotated = operations['Rotator CW'].fn(Shape.fromShapeCode('CuRuSuWu'))[0].toShapeCode();
    check('rotation fixture is a non-identity rotation of the target', rotated !== 'CuRuSuWu' && !!rotated);
    const res = await solve('CuRuSuWu', [rotated], { method: 'A*' });
    assertAlreadySolved('A* rotation-equivalent (orientation-insensitive)', res);
}

// --- Case D: the already-solved invariant holds in ORIENTATION-SENSITIVE mode
// too, when the start is the EXACT target string (no rotation tolerance). ---
{
    const res = await solve('CuRuSuWu', ['CuRuSuWu'], { method: 'A*', orientationSensitive: true });
    assertAlreadySolved('A* exact-equals (orientation-sensitive)', res);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
