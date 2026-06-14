// Unit tests for the solver's shouldCancel cancellation path (audit #2212) — run with:
//   node tests/solverCancellation.test.js
//
// The solver threads a `shouldCancel()` callback into every search loop so a long
// search can be aborted (the browser app wires it to the Cancel button). The
// documented abort contract has two shapes:
//   • shapeSolver (A*/BFS/IDA*/Bidirectional) and shapeExplorer resolve to a bare
//     `null` when cancelled — NOT a result object, and distinct from the maxStates
//     cap which returns { solutionPath: null, aborted: 'maxStates' }.
//   • the Constructive planner resolves to an OBJECT with solutionPath:null and
//     aborted:null (null, not 'no-decomposition', signals "cancelled" vs "stuck").
// These tests exercise that path with an immediate cancel and a cancel-after-N
// checks, asserting graceful abort (no throw, no completion).
//
// Bounded-by-construction: an immediate cancel never enters a search loop, and the
// cancel-after-N tests trip far below the maxStates safety cap, so neither
// approaches the memory ceiling an uncapped hard solve would.
import { shapeSolver, shapeExplorer, operations } from '../shapeSolverCore.js';
import { solveConstructive } from '../shapeSolverConstructive.js';

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
const noop = () => {};
const SOLVER_METHODS = ['A*', 'BFS', 'IDA*', 'Bidirectional'];

// shouldCancel that fires on the very first check.
const alwaysCancel = () => true;

// shouldCancel that returns false for the first n checks, then true forever.
// .calls() exposes how many times the search actually polled it, proving the
// cancellation path was exercised rather than the search ending for another reason.
function cancelAfter(n) {
    let calls = 0;
    const fn = () => (++calls > n);
    fn.calls = () => calls;
    return fn;
}

// --- Immediate cancel: every search method resolves to null (not a result
//     object, not a throw), even for an otherwise-solvable target. Cancel takes
//     precedence over solving. ---
for (const method of SOLVER_METHODS) {
    let res = 'unset';
    let threw = false;
    try {
        res = await shapeSolver(
            'CuCuRuRu', STARTS, ALL_OPS, 4, 1000, false, false, false, 0.1,
            method, alwaysCancel, noop, Infinity
        );
    } catch (e) { threw = true; }
    check(`${method}: immediate cancel does not throw`, !threw);
    check(`${method}: immediate cancel resolves to null (documented cancelled result)`, res === null);
}

// --- Cancel after N checks: the search aborts mid-run on a hard target it could
//     never solve, returning null — NOT the maxStates abort object. The cap is a
//     pure safety net; the cancel trips ~50 checks in, long before 5000 states. ---
const N = 50;
const SAFETY_CAP = 5000;
for (const method of SOLVER_METHODS) {
    const cancel = cancelAfter(N);
    let res = 'unset';
    let threw = false;
    try {
        res = await shapeSolver(
            'CuRuCuRu', STARTS, ALL_OPS, 4, 1000, false, false, false, 0.1,
            method, cancel, noop, SAFETY_CAP
        );
    } catch (e) { threw = true; }
    check(`${method}: cancel-after-${N} does not throw`, !threw);
    check(`${method}: cancel-after-${N} resolves to null (aborted, not a maxStates object)`, res === null);
    check(`${method}: cancellation path actually exercised (polled shouldCancel > ${N}x)`, cancel.calls() > N);
}

// --- shapeExplorer honours cancellation the same way (returns null). ---
{
    let res = await shapeExplorer(STARTS, ALL_OPS, 3, 4, alwaysCancel, noop);
    check('explorer: immediate cancel resolves to null', res === null);

    const cancel = cancelAfter(5);
    res = await shapeExplorer(STARTS, ALL_OPS, 3, 4, cancel, noop);
    check('explorer: cancel-after-5 resolves to null', res === null);
    check('explorer: cancellation path actually exercised (polled shouldCancel > 5x)', cancel.calls() > 5);
}

// --- The Constructive planner's cancel contract differs: it resolves to an OBJECT
//     with solutionPath:null and aborted:null — distinct from a bare null and from
//     the 'no-decomposition' abort it returns when genuinely stuck. ---
{
    let res = 'unset';
    let threw = false;
    try {
        res = await solveConstructive(
            'CuRuSuWu', STARTS, ALL_OPS, 4, false, false, false, 0.1,
            alwaysCancel, noop, 4000
        );
    } catch (e) { threw = true; }
    check('constructive: immediate cancel does not throw', !threw);
    check('constructive: immediate cancel resolves to a result object', res != null && typeof res === 'object');
    check('constructive: cancelled result has solutionPath=null', res && res.solutionPath === null);
    check('constructive: cancelled result has aborted=null (distinct from no-decomposition)', res && res.aborted === null);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
