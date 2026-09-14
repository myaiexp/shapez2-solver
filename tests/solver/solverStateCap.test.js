// Unit tests for the solver's maxStates cap (idea #1675) — run with:
//   node tests/solver/solverStateCap.test.js
//
// Hard targets (e.g. alternating quadrants CuRuCuRu) have an effectively
// unbounded state space. Before the cap the search OOM'd the process; now it
// aborts gracefully once `maxStates` distinct states are discovered. These tests
// use a TINY cap so they are bounded-by-construction and safe to run — they never
// approach the memory ceiling that an uncapped hard solve would.
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';
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
// maxStates is a ceiling on *distinct* state keys for every method (A*/BFS/
// Bidirectional via costSoFar/visited size; IDA* via a lifetime distinctStates
// set). One expansion can mint several successors before the next check, so
// allow a small overshoot — not the old CAP×10 that hid IDA* counting
// cumulative expansions instead of distinct keys.
const CAP = 2000;
// Branching-factor headroom only (one expansion / a few successors), not a
// full frontier of runaway growth.
const CAP_SLOP = 256;
for (const method of ['A*', 'BFS', 'IDA*', 'Bidirectional']) {
    const res = await shapeSolver('CuRuCuRu', STARTS, ALL_OPS, {
        maxLayers: 4, maxStatesPerLevel: 1000,
        searchMethod: method, shouldCancel: noCancel, onProgress: noop, maxStates: CAP,
    });
    check(`${method}: hard target returns a result object (no throw/hang)`, res != null);
    check(`${method}: hard target found no solution`, res && res.solutionPath == null);
    check(`${method}: hard target reports aborted='maxStates'`, res && res.aborted === 'maxStates');
    check(`${method}: distinct-state metric stayed near the cap`,
        res && typeof res.statesExplored === 'number' && res.statesExplored <= CAP + CAP_SLOP);
    // statesExplored is the distinct-key count (same unit as maxStates) for every
    // method — A*/Bidirectional used to report node expansions instead (#6422).
    check(`${method}: statesExplored is at least the cap floor (distinct keys)`,
        res && typeof res.statesExplored === 'number' && res.statesExplored >= CAP);
}

// --- IDA* on a small, transposition-heavy op set still reaches the cap ---
// Cutter/Stacker/Rotator CW keeps the distinct-key space small while re-reaching
// the same states along many paths. Without the per-pass transposition table
// each threshold pass was an exponential DFS that never hit maxStates (minting
// millions of ids, 500+ MB). The deadline turns a regression into a failure
// (cancel → null) instead of a hung test run.
{
    const deadline = performance.now() + 20000;
    const t0 = performance.now();
    const res = await shapeSolver('CuRuSuWu', [...STARTS, 'WuWuWuWu'], ['Cutter', 'Stacker', 'Rotator CW'], {
        maxLayers: 4, searchMethod: 'IDA*', onProgress: noop, maxStates: CAP,
        shouldCancel: () => performance.now() > deadline,
    });
    check('IDA* transposition-heavy: aborted at the cap before the deadline',
        res != null && res.aborted === 'maxStates');
    check('IDA* transposition-heavy: distinct-state metric stayed near the cap',
        res != null && res.statesExplored <= CAP + CAP_SLOP);
    console.log(`  (IDA* transposition-heavy abort took ${Math.round(performance.now() - t0)} ms)`);
}

// --- The cap does not break normal solving: a reachable target still solves
//     and its reconstructed path is valid (every step a real op) ---
{
    const res = await shapeSolver('CuCuRuRu', STARTS, ALL_OPS, {
        maxLayers: 4, maxStatesPerLevel: 1000,
        searchMethod: 'A*', shouldCancel: noCancel, onProgress: noop, maxStates: 50000,
    });
    check('solvable target still solves under a cap', res && res.solutionPath && res.solutionPath.length > 0);
    check('solved target is not flagged aborted', res && !res.aborted);
    check('reconstructed solution path is valid (lazy minting intact)', pathIsValid(res?.solutionPath, CONFIG));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
