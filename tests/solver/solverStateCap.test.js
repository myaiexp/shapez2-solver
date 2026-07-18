// Unit tests for the solver's maxStates cap (idea #1675) — run with:
//   node tests/solver/solverStateCap.test.js
//
// Hard targets (e.g. alternating quadrants CuRuCuRu) have an effectively
// unbounded state space. Before the cap the search OOM'd the process; now it
// aborts gracefully once `maxStates` distinct states are discovered. These tests
// use a TINY cap so they are bounded-by-construction and safe to run — they never
// approach the memory ceiling that an uncapped hard solve would.
import { shapeSolver, operations } from '../../shapeSolverCore.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { pathIsValid } from '../shared/pathValidation.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const ALL_OPS = Object.keys(operations);
const STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu'];
const noCancel = () => false;
const noop = () => {};

// Every step must be a real operation (guards lazy id minting / applySuccessor
// from ever reconstructing an impossible path). Validated under the solver's
// maxLayers via the shared tests/shared/pathValidation.js.
const CONFIG = new ShapeOperationConfig(4);

// --- A hard target aborts at the cap instead of running unbounded ---
const CAP = 2000;
for (const method of ['A*', 'BFS', 'IDA*', 'Bidirectional']) {
    const res = await shapeSolver(
        'CuRuCuRu', STARTS, ALL_OPS, 4, 1000, false, false, false, 0.1,
        method, noCancel, noop, CAP
    );
    check(`${method}: hard target returns a result object (no throw/hang)`, res != null);
    check(`${method}: hard target found no solution`, res && res.solutionPath == null);
    check(`${method}: hard target reports aborted='maxStates'`, res && res.aborted === 'maxStates');
    // costSoFar can overshoot the cap by at most one expansion's worth of
    // successors before the top-of-loop check trips; statesExplored (dequeues)
    // stays well under. A generous bound proves it did not run away.
    check(`${method}: state count stayed bounded by the cap`,
        res && typeof res.statesExplored === 'number' && res.statesExplored <= CAP * 10);
}

// --- The cap does not break normal solving: a reachable target still solves
//     and its reconstructed path is valid (every step a real op) ---
{
    const res = await shapeSolver(
        'CuCuRuRu', STARTS, ALL_OPS, 4, 1000, false, false, false, 0.1,
        'A*', noCancel, noop, 50000
    );
    check('solvable target still solves under a cap', res && res.solutionPath && res.solutionPath.length > 0);
    check('solved target is not flagged aborted', res && !res.aborted);
    check('reconstructed solution path is valid (lazy minting intact)', pathIsValid(res?.solutionPath, CONFIG));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
