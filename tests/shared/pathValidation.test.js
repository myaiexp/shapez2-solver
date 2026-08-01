// Unit tests for the shared path gates — run with:
//   node tests/shared/pathValidation.test.js
//
// tests/shared/pathValidation.js is the single correctness gate behind smoke.js,
// solve.mjs, constructive.test.js and solverStateCap.test.js, yet nothing tested
// the gate itself: a hole in it silently unblocks every harness at once (audit
// #5499/#5500 — a double-consumed id and a zero-op solve both slipped through).
// These tests drive it with hand-written paths so each rule is pinned in
// isolation, including the ones no solver currently emits.
import {
    orderedSubsequenceFailure,
    invalidPathSteps,
    invalidPathIds,
    invalidExplorerEdges,
    pathIsValid,
    simulateFinalInventory,
    pathReachesTarget,
    invalidDisallowedOps,
    pathInventoryAcceptable,
} from './pathValidation.js';
import { ShapeOperationConfig } from '../../shapeClass.js';

const cfg = new ShapeOperationConfig(4);
const STARTS = ['CuCuCuCu', 'RuRuRuRu'];

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}
const io = (id, shape) => ({ id, shape });
const step = (operation, inputs, outputs, params = {}) => ({ operation, inputs, outputs, params });

// A real two-step path: cut CuCuCuCu, keep the left half, stack it onto RuRuRuRu.
// Ids mirror the solver's minting — starts are 0..n-1, products are fresh.
const CUT = step('Cutter', [io(0, 'CuCuCuCu')], [io(2, '----CuCu'), io(3, 'CuCu----')]);
const STACK = step('Stacker', [io(1, 'RuRuRuRu'), io(3, 'CuCu----')], [io(4, 'RuRuRuRu:CuCu----')]);

// --- orderedSubsequenceFailure ----------------------------------------------
check('subsequence: exact match passes', orderedSubsequenceFailure(['a', 'b'], ['a', 'b']) === null);
check('subsequence: subset in order passes', orderedSubsequenceFailure(['b'], ['a', 'b', 'c']) === null);
check('subsequence: fabricated output fails',
    orderedSubsequenceFailure(['z'], ['a', 'b']) === 'not produced: z');
check('subsequence: swapped order fails (ports bind by index)',
    orderedSubsequenceFailure(['b', 'a'], ['a', 'b']) === 'out-of-order/duplicate output a');
check('subsequence: over-claiming one produced entry fails',
    orderedSubsequenceFailure(['a', 'a'], ['a', 'b']) === 'out-of-order/duplicate output a');

// --- invalidPathSteps: op replay --------------------------------------------
check('steps: a real path replays clean', invalidPathSteps([CUT, STACK], cfg).length === 0,
    invalidPathSteps([CUT, STACK], cfg).join(' | '));
check('steps: unknown op is rejected',
    invalidPathSteps([step('Teleporter', [io(0, 'CuCuCuCu')], [io(1, 'RuRuRuRu')])], cfg).length === 1);
check('steps: fabricated output is rejected',
    invalidPathSteps([step('Cutter', [io(0, 'CuCuCuCu')], [io(2, 'RuRuRuRu')])], cfg).length === 1);
check('steps: a null path has no bad steps (presence is gated separately)',
    invalidPathSteps(null, cfg).length === 0);

// --- invalidPathIds: the item-flow gate the code replay cannot see -----------
check('ids: a real path flows clean', invalidPathIds([CUT, STACK]).length === 0,
    invalidPathIds([CUT, STACK]).join(' | '));

// The audit case: one produced id feeding two machines. Every step still replays.
const doubleSpend = [
    CUT,
    step('Stacker', [io(1, 'RuRuRuRu'), io(3, 'CuCu----')], [io(4, 'RuRuRuRu:CuCu----')]),
    step('Stacker', [io(3, 'CuCu----'), io(4, 'RuRuRuRu:CuCu----')], [io(5, 'CuCu----:RuRuRuRu:CuCu----')])
];
check('ids: double-consumed intermediate is rejected', invalidPathIds(doubleSpend).length === 1);
check('ids: double-consume names the Belt Split remedy',
    invalidPathIds(doubleSpend)[0].includes('Belt Split'));
check('ids: the double-spend path still passes op replay (why this gate exists)',
    invalidPathSteps(doubleSpend, cfg).length === 0);
check('ids: pathIsValid folds in the id gate', pathIsValid(doubleSpend, cfg) === false);

// Same id twice within ONE step (a Stacker fed from one belt).
check('ids: one step consuming an id twice is rejected',
    invalidPathIds([CUT, step('Stacker', [io(3, 'CuCu----'), io(3, 'CuCu----')], [io(5, 'CuCu----:CuCu----')])]).length === 1);

// A Belt Split is the sanctioned fan-out: it consumes once and mints fresh ids.
const splitFanOut = [
    CUT,
    step('Belt Split', [io(3, 'CuCu----')], [io(5, 'CuCu----'), io(6, 'CuCu----')]),
    step('Stacker', [io(5, 'CuCu----'), io(6, 'CuCu----')], [io(7, 'CuCu----:CuCu----')])
];
check('ids: Belt Split fan-out is accepted', invalidPathIds(splitFanOut).length === 0,
    invalidPathIds(splitFanOut).join(' | '));
check('ids: the Belt Split path also replays as real ops',
    invalidPathSteps(splitFanOut, cfg).length === 0, invalidPathSteps(splitFanOut, cfg).join(' | '));

// Two starts of the SAME code are distinct items — that is not a double-spend.
check('ids: two feeds of the same starting code are fine',
    invalidPathIds([step('Stacker', [io(0, 'CuCuCuCu'), io(1, 'CuCuCuCu')], [io(2, 'CuCuCuCu:CuCuCuCu')])],
        { starts: ['CuCuCuCu', 'CuCuCuCu'] }).length === 0);

check('ids: an id produced by two steps is rejected',
    invalidPathIds([CUT, step('Cutter', [io(1, 'RuRuRuRu')], [io(2, '----RuRu'), io(9, 'RuRu----')])]).length === 1);

check('ids: consuming an id before it is produced is rejected',
    invalidPathIds([STACK, CUT]).some(r => r.includes('before')));

check('ids: an input from outside the starting set is rejected when starts are known',
    invalidPathIds([step('Stacker', [io(0, 'CuCuCuCu'), io(1, 'SuSuSuSu')], [io(2, 'CuCuCuCu:SuSuSuSu')])],
        { starts: STARTS }).length === 1);
check('ids: without starts, unproduced inputs are taken on trust',
    invalidPathIds([step('Stacker', [io(0, 'CuCuCuCu'), io(1, 'SuSuSuSu')], [io(2, 'CuCuCuCu:SuSuSuSu')])]).length === 0);

// --- simulateFinalInventory --------------------------------------------------
check('inventory: consumed inputs leave, outputs stay',
    JSON.stringify(simulateFinalInventory([CUT, STACK])) === JSON.stringify(['----CuCu', 'RuRuRuRu:CuCu----']));
check('inventory: a trashed product is gone',
    JSON.stringify(simulateFinalInventory([CUT, step('Trash', [io(3, 'CuCu----')], [])])) === JSON.stringify(['----CuCu']));

// --- pathReachesTarget: the goal gate ----------------------------------------
check('goal: the assembled target is found',
    pathReachesTarget([CUT, STACK], 'RuRuRuRu:CuCu----', { config: cfg, starts: STARTS }));
check('goal: a rotation of the target counts when not orientation-sensitive',
    pathReachesTarget([CUT], '--CuCu--', { config: cfg, starts: STARTS }));
check('goal: orientation-sensitive rejects the rotation',
    !pathReachesTarget([CUT], '--CuCu--', { config: cfg, starts: STARTS, orientationSensitive: true }));
// Building the target and then trashing it is the case pure op-replay misses:
// every step is real, the last-step-output check would even see it produced.
check('goal: a target that was built and then trashed is not reached',
    !pathReachesTarget([CUT, STACK, step('Trash', [io(4, 'RuRuRuRu:CuCu----')], [])],
        'RuRuRuRu:CuCu----', { config: cfg, starts: STARTS }));
check('goal: a null path never reaches the target',
    !pathReachesTarget(null, 'CuCuCuCu', { config: cfg, starts: STARTS }));

// The already-solved contract: zero ops IS the solution when a start matches.
check('goal: zero-op path succeeds when a start is the target',
    pathReachesTarget([], 'CuCuCuCu', { config: cfg, starts: STARTS }));
check('goal: zero-op path succeeds on a rotation of a start',
    pathReachesTarget([], 'CuCuCuCu', { config: cfg, starts: ['CuCuCuCu'] }));
check('goal: zero-op path fails when no start matches',
    !pathReachesTarget([], 'SuSuSuSu', { config: cfg, starts: STARTS }));
check('goal: zero-op path stays strict when starts are unknown',
    !pathReachesTarget([], 'CuCuCuCu', { config: cfg }));
check('valid: a zero-op path is trivially valid (nothing to replay)',
    pathIsValid([], cfg, { starts: STARTS }));

// --- invalidExplorerEdges: explorer graph op replay -------------------------
// Hand-built graph mirrors explorer wire shape: shape-* / op-* ids + edges.
const realExploreCut = {
    shapes: [
        { id: 'shape-0', code: 'CuCuCuCu' },
        { id: 'shape-1', code: '----CuCu' },
        { id: 'shape-2', code: 'CuCu----' },
    ],
    ops: [{ id: 'op-0', type: 'Cutter', params: {} }],
    edges: [
        { source: 'shape-0', target: 'op-0' },
        { source: 'op-0', target: 'shape-1' },
        { source: 'op-0', target: 'shape-2' },
    ],
};
check('explore: a real cut graph has no invalid edges',
    invalidExplorerEdges(realExploreCut, cfg).length === 0,
    invalidExplorerEdges(realExploreCut, cfg).join(' | '));

const fabricatedExploreOut = {
    shapes: [
        { id: 'shape-0', code: 'CuCuCuCu' },
        { id: 'shape-1', code: 'RuRuRuRu' },
    ],
    ops: [{ id: 'op-0', type: 'Cutter', params: {} }],
    edges: [
        { source: 'shape-0', target: 'op-0' },
        { source: 'op-0', target: 'shape-1' },
    ],
};
check('explore: fabricated output edge is rejected',
    invalidExplorerEdges(fabricatedExploreOut, cfg).length === 1);
check('explore: null graph has no invalid edges',
    invalidExplorerEdges(null, cfg).length === 0);

// --- invalidDisallowedOps: enabled-ops subset --------------------------------
check('opsAllowed: path using only listed ops passes',
    invalidDisallowedOps([CUT, STACK], ['Cutter', 'Stacker']).length === 0);
check('opsAllowed: a disabled Stacker is rejected',
    invalidDisallowedOps([CUT, STACK], ['Cutter']).length === 1);
check('opsAllowed: null path has no disallowed ops',
    invalidDisallowedOps(null, ['Cutter']).length === 0);

// --- pathInventoryAcceptable: preventWaste cleanliness -----------------------
// Symmetric CuCuCuCu halves are rotations of each other, so use an asymmetric
// cut: CuRu---- is the target and ----SuWu is genuine waste.
const CUT_ASYM = step('Cutter', [io(0, 'CuRuSuWu')], [io(2, '----SuWu'), io(3, 'CuRu----')]);
check('inventoryAcceptable: leftovers that are not the target fail',
    !pathInventoryAcceptable([CUT_ASYM], 'CuRu----', { config: cfg, starts: ['CuRuSuWu'] }));
check('inventoryAcceptable: trashing the waste half leaves only the target',
    pathInventoryAcceptable(
        [CUT_ASYM, step('Trash', [io(2, '----SuWu')], [])],
        'CuRu----', { config: cfg, starts: ['CuRuSuWu'] }));
// pathReachesTarget still passes when waste remains — that is the gap this gate closes.
check('inventoryAcceptable: reaches-target alone is not waste-free',
    pathReachesTarget([CUT_ASYM], 'CuRu----', { config: cfg, starts: ['CuRuSuWu'] })
    && !pathInventoryAcceptable([CUT_ASYM], 'CuRu----', { config: cfg, starts: ['CuRuSuWu'] }));
check('inventoryAcceptable: null path is not waste-free',
    !pathInventoryAcceptable(null, 'CuCuCuCu', { config: cfg, starts: STARTS }));
check('inventoryAcceptable: zero-op succeeds when every start is the target',
    pathInventoryAcceptable([], 'CuCuCuCu', { config: cfg, starts: ['CuCuCuCu'] }));
check('inventoryAcceptable: zero-op fails when an extra non-target start remains',
    !pathInventoryAcceptable([], 'CuCuCuCu', { config: cfg, starts: STARTS }));

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
