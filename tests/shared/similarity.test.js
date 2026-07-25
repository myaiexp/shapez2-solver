// Standalone tests for tests/shared/similarity.js — run with: node tests/shared/similarity.test.js
//
// The similarity stack is a TEST-ONLY helper (audit #5530 moved it out of the
// app: the solver has used _matchAndCoverage in shapeSolverCore.js since idea
// #1677). It still needs pinning because smoke.js snapshots getSimilarity as a
// pure op and shapeRotation.test.js leans on comparePartOrder as a
// rotation-agnostic comparator — a silent change here would move those results.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import {
    getSimilarity,
    getPartTypeCounts,
    getPartCounts,
    compareCounts,
    comparePartOrder,
} from './similarity.js';
import { Shape } from '../../shapeClass.js';

let passed = 0;
let total = 0;
let failed = false;

const S = (code) => Shape.fromShapeCode(code);

function ok(name) { console.log(`✓ ${name}`); passed++; }
function bad(name, exp, act) {
    console.log(`✗ ${name}\n    expected: ${exp}\n    actual:   ${act}`);
    failed = true;
}

// Float compare with epsilon — similarity scores are weighted sums of ratios.
function approx(name, actual, expected) {
    total++;
    if (typeof actual === 'number' && Math.abs(actual - expected) < 1e-9) ok(name);
    else bad(name, expected, actual);
}

function eqNum(name, actual, expected) {
    total++;
    if (actual === expected) ok(name);
    else bad(name, expected, actual);
}

function truthy(name, cond) {
    total++;
    if (cond) ok(name);
    else bad(name, 'truthy', cond);
}

// ============================================================================
// getPartTypeCounts / getPartCounts — multiset counts (Nothing IS counted).
// ============================================================================
{
    const c = getPartTypeCounts(S('CuRuSuWu'));
    eqNum("getPartTypeCounts: distinct shapes counted (C)", c.get('C'), 1);
    eqNum("getPartTypeCounts: distinct shapes counted (W)", c.get('W'), 1);
    eqNum("getPartTypeCounts: distinct shapes size", c.size, 4);
}
{
    const c = getPartTypeCounts(S('CuCu----'));
    eqNum("getPartTypeCounts: repeated shape counted (C:2)", c.get('C'), 2);
    eqNum("getPartTypeCounts: Nothing counted too (-:2)", c.get('-'), 2);
}
{
    const c = getPartCounts(S('CrCuCrCu'));
    eqNum("getPartCounts: shape:color key (C:r → 2)", c.get('C:r'), 2);
    eqNum("getPartCounts: shape:color key (C:u → 2)", c.get('C:u'), 2);
    eqNum("getPartCounts: two distinct keys", c.size, 2);
}

// ============================================================================
// compareCounts — sum(min)/sum(max) over the key union; both-empty → 1.
// ============================================================================
approx("compareCounts: both empty → 1", compareCounts(new Map(), new Map()), 1);
approx("compareCounts: identical → 1",
    compareCounts(new Map([['C', 2]]), new Map([['C', 2]])), 1);
approx("compareCounts: 2 vs 1 → 0.5",
    compareCounts(new Map([['C', 2]]), new Map([['C', 1]])), 0.5);
approx("compareCounts: extra key halves the ratio",
    compareCounts(new Map([['C', 1], ['R', 1]]), new Map([['C', 1]])), 0.5);
approx("compareCounts: disjoint keys → 0",
    compareCounts(new Map([['C', 1]]), new Map([['R', 1]])), 0);

// ============================================================================
// comparePartOrder — best part-shape match ratio across all CW rotations of
// shape1; 0 when the layer counts differ.
// ============================================================================
approx("comparePartOrder: identical → 1", comparePartOrder(S('CuRuSuWu'), S('CuRuSuWu')), 1);
approx("comparePartOrder: a rotation lines up → 1 (RuCuRuCu vs CuRuCuRu)",
    comparePartOrder(S('RuCuRuCu'), S('CuRuCuRu')), 1);
approx("comparePartOrder: differing layer counts → 0",
    comparePartOrder(S('CuRuSuWu'), S('CuRuSuWu:CuRuSuWu')), 0);
approx("comparePartOrder: partial best match (CuRuSuWu vs CuXuXuXu → 0.25)",
    comparePartOrder(S('CuRuSuWu'), S('CuXuXuXu')), 0.25);

// ============================================================================
// getSimilarity — typeSim*wType + colorSim*wColor + orderSim*wOrder.
// ============================================================================
approx("getSimilarity: identical shapes → 1", getSimilarity(S('CuRuSuWu'), S('CuRuSuWu')), 1);
approx("getSimilarity: fully different shapes → 0",
    getSimilarity(S('CuCuCuCu'), S('RuRuRuRu')), 0);
// Same shape, different color: typeSim=1, colorSim=0, orderSim=1 (shape-only compare).
approx("getSimilarity: default weights blend (CrCrCrCr vs CuCuCuCu → 0.7)",
    getSimilarity(S('CrCrCrCr'), S('CuCuCuCu')), 0.7);
approx("getSimilarity: weights={type:1} isolates type term → 1",
    getSimilarity(S('CrCrCrCr'), S('CuCuCuCu'), { type: 1, color: 0, order: 0 }), 1);
approx("getSimilarity: weights={color:1} isolates color term → 0",
    getSimilarity(S('CrCrCrCr'), S('CuCuCuCu'), { type: 0, color: 1, order: 0 }), 0);

// ============================================================================
// Input immutability — comparePartOrder rotates its first argument internally,
// so it must hand back a rotated COPY rather than spin the caller's shape.
// ============================================================================
{
    const a = S('CrCuCrCu'), b = S('CuCuCuCu');
    const before = [a.toShapeCode(), b.toShapeCode()];
    getSimilarity(a, b);
    comparePartOrder(a, b);
    truthy("inputs not mutated by similarity helpers",
        a.toShapeCode() === before[0] && b.toShapeCode() === before[1]);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
