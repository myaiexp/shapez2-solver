// Unit tests for the pure decomposition splits + cost metric used by the
// Constructive planner. Run with: node tests/shapeSolverDecompose.test.js
//
// Splits take a shape-code and return piece shape-codes in fold order (or null
// when the split does not apply). cost() scores a Plan tree by reuse-credited op
// count with decomposition-recursion depth as the tie-break.
import {
    splitByLayer,
    splitByQuadrant,
    splitByHalf,
    cost,
    opCountOf,
    depthOf
} from '../shapeSolverDecompose.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}
function assert(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — assertion failed`); failed = true; }
}

// --- splitByLayer: layers BOTTOM->TOP, null for single-layer -----------------
check('splitByLayer multi-layer', splitByLayer('CuCuCuCu:RuRuRuRu'), ['CuCuCuCu', 'RuRuRuRu']);
check('splitByLayer three layers', splitByLayer('Cu------:--Ru----:----Su--'), ['Cu------', '--Ru----', '----Su--']);
check('splitByLayer single-layer is null', splitByLayer('CuRuSuWu'), null);

// --- splitByQuadrant: positioned single-quadrant pieces, occupied only -------
check('splitByQuadrant all distinct', splitByQuadrant('CuRuSuWu'), ['Cu------', '--Ru----', '----Su--', '------Wu']);
check('splitByQuadrant two occupied', splitByQuadrant('CuRu----'), ['Cu------', '--Ru----']);
check('splitByQuadrant uniform', splitByQuadrant('CuCuCuCu'), ['Cu------', '--Cu----', '----Cu--', '------Cu']);
check('splitByQuadrant gappy', splitByQuadrant('Cu--Su--'), ['Cu------', '----Su--']);
check('splitByQuadrant multi-layer is null', splitByQuadrant('CuCuCuCu:RuRuRuRu'), null);
check('splitByQuadrant single occupied is null (base case)', splitByQuadrant('Cu------'), null);
check('splitByQuadrant empty is null', splitByQuadrant('--------'), null);

// --- splitByHalf: left + right halves, null if either half empty -------------
check('splitByHalf full', splitByHalf('CuRuSuWu'), ['CuRu----', '----SuWu']);
check('splitByHalf gappy halves', splitByHalf('Cu--Su--'), ['Cu------', '----Su--']);
check('splitByHalf right-empty is null', splitByHalf('CuRu----'), null);
check('splitByHalf left-empty is null', splitByHalf('----SuWu'), null);
check('splitByHalf multi-layer is null', splitByHalf('CuCuCuCu:Ru------'), null);

// --- cost: reuse counted once, depth tie-break -------------------------------
// Plan fixtures. A direct-search leaf: { method:'direct-search', steps:[...], children:[] }.
// A split:                              { method:'by-quadrant', steps:[], children:[...] }.
const leaf = (n) => ({ method: 'direct-search', steps: Array(n).fill({}), children: [] });
const split = (method, children) => ({ method, steps: [], children });

// planA: 4 distinct leaves (3 steps each) assembled by-quadrant -> 12 + 3 stacks = 15 ops, depth 1.
const planA = split('by-quadrant', [leaf(3), leaf(3), leaf(3), leaf(3)]);
check('opCount planA (no reuse)', opCountOf(planA), 15);
check('depth planA (flat split)', depthOf(planA), 1);

// Reuse: one shared leaf object referenced twice counts ONCE.
const shared = leaf(3);
const planB = split('by-half', [shared, shared]);            // shared built once + 1 stack = 4 ops
const planAequivNoReuse = split('by-half', [leaf(3), leaf(3)]); // 3 + 3 + 1 stack = 7 ops
check('opCount planB credits reuse', opCountOf(planB), 4);
check('opCount equivalent without reuse', opCountOf(planAequivNoReuse), 7);
assert('cost(planB) < cost(no-reuse equivalent)', cost(planB) < cost(planAequivNoReuse));

// Depth tie-break: equal opCount, shallower decomposition wins.
// flat: split of 3 leaves(1 each) -> 3 + 2 stacks = 5 ops, depth 1.
const planFlat = split('by-quadrant', [leaf(1), leaf(1), leaf(1)]);
// nested: split of [leaf(1), split([leaf(1),leaf(1)])] -> 1 + (1+1+1) + 1 = 5 ops, depth 2.
const planNested = split('by-half', [leaf(1), split('by-quadrant', [leaf(1), leaf(1)])]);
check('opCount planFlat', opCountOf(planFlat), 5);
check('opCount planNested', opCountOf(planNested), 5);
check('depth planFlat', depthOf(planFlat), 1);
check('depth planNested', depthOf(planNested), 2);
assert('depth tie-break: shallower (flat) cost < deeper (nested)', cost(planFlat) < cost(planNested));

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
