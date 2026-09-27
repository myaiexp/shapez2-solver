// Unit tests for inverse (predecessor) ops in shapeSolverInverse.js.
// Run with: node tests/solver/shapeSolverInverse.test.js
//
// Covers early-exit guards (wrong layer count) for inverseUnstack / inverseUnpin,
// inverseUncut's whole-shape predecessors (geometric left/right matching cut()),
// and one non-early-return case per function so empty results are
// proven to come from the guard, not from always returning empty.
//
// Also the four previously untested inverses (finding #8618): inverseUnpaint and
// the three rotation inverses. Rotations are each other's inverses of the forward
// ops; unpaint returns a 0-or-1 array (not one code per original color).
import { Shape } from '../../shapeClass.js';
import { rotate90CW, rotate90CCW, rotate180 } from '../../shapeRotation.js';
import { cut } from '../../shapeOperations.js';
import {
    inverseUnstack,
    inverseUncut,
    inverseUnpin,
    inverseUnpaint,
    inverseRotateCW,
    inverseRotateCCW,
    inverseRotate180,
} from '../../shapeSolverInverse.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

const shape = (code) => Shape.fromShapeCode(code);

// --- inverseUnstack: early return when numLayers < 2 -------------------------
// Guard: `if (shape.numLayers < 2) return results;` — a single-layer shape has
// nothing to unstack, so the empty array is returned before the split loop.
check('inverseUnstack single-layer returns []', inverseUnstack(shape('CuCuCuCu'), null), []);
check('inverseUnstack single-layer gappy returns []', inverseUnstack(shape('Cu--Su--'), null), []);
// Contrast: a 2-layer shape passes the guard and yields the (bottom, top) pair.
check('inverseUnstack 2-layer splits (non-early)', inverseUnstack(shape('CuCuCuCu:RuRuRuRu'), null), ['CuCuCuCu', 'RuRuRuRu']);

// --- inverseUncut: whole predecessors of a pure half -------------------------
// Geometry matches cut(): leading = right, trailing = left. Candidates are the
// 180° mirror, then one uniform fill per distinct part; duplicates and the half
// itself are dropped, and every emitted whole must cut back to the half.
check('inverseUncut uniform right half → one mirrored whole',
    inverseUncut(shape('CuCu----'), null), ['CuCuCuCu']);
check('inverseUncut mixed right half → mirror, then per-part fills',
    inverseUncut(shape('CuRu----'), null), ['CuRuCuRu', 'CuRuCuCu', 'CuRuRuRu']);
check('inverseUncut left half fills the right side',
    inverseUncut(shape('----SuWu'), null), ['SuWuSuWu', 'SuSuSuWu', 'WuWuSuWu']);
check('inverseUncut gappy half fills only the empty side',
    inverseUncut(shape('Cu------'), null), ['Cu--Cu--', 'Cu--CuCu']);
check('inverseUncut multi-layer half fills every layer',
    inverseUncut(shape('CuCu----:RuRu----'), null),
    ['CuCuCuCu:RuRuRuRu', 'CuCuCuCu:RuRuCuCu', 'CuCuRuRu:RuRuRuRu']);
// Crystals fused across a cut seam shatter, so those wholes do not cut back to
// the half and are rejected: an all-crystal half has no predecessor, while a
// half whose crystals stay off the seams keeps its candidates.
check('inverseUncut all-crystal half: shattering wholes rejected',
    inverseUncut(shape('crcr----'), null), []);
{
    const preds = inverseUncut(shape('crCu----'), null);
    check('inverseUncut crystal off the seams keeps its wholes', preds, ['crCucrCu', 'crCuCuCu']);
    check('inverseUncut crystal wholes cut back to the half',
        preds.every(p => cut(shape(p))[1].toShapeCode() === 'crCu----'), true);
}
// Both sides occupied: not a Cutter half-output we reverse.
check('inverseUncut both-halves returns []', inverseUncut(shape('CuRuSuWu'), null), []);
// Different halves on different layers: no single cut produced it.
check('inverseUncut mixed-side layers returns []', inverseUncut(shape('CuCu----:----RuRu'), null), []);
// Fully empty: both sides empty, not a useful predecessor.
check('inverseUncut empty returns []', inverseUncut(shape('--------'), null), []);

// --- inverseUnpin: early return when numLayers < 2 ---------------------------
// Guard: `if (shape.numLayers < 2) return results;` — a single-layer shape has
// no bottom pin layer to remove, so the empty array is returned.
check('inverseUnpin single-layer returns []', inverseUnpin(shape('CuCuCuCu'), null), []);
check('inverseUnpin single-layer pins returns []', inverseUnpin(shape('P-P-P-P-'), null), []);
// Contrast: a 2-layer shape with an all-pin bottom passes the guard and drops it.
check('inverseUnpin 2-layer pin base (non-early)', inverseUnpin(shape('P-P-P-P-:CuCuCuCu'), null), ['CuCuCuCu']);

// --- inverseUnpaint: 0-or-1 fully-unpainted predecessor of the top layer -----
// Unpainted top → [] (nothing to undo). Painted top → the uncolored code.
// Lower layers are copied through; only the top layer's paintable colors drop to u.
check('inverseUnpaint unpainted top returns []', inverseUnpaint(shape('CuCuCuCu'), null), []);
check('inverseUnpaint unpainted top of a stack returns []',
    inverseUnpaint(shape('CrCrCrCr:CuCuCuCu'), null), []);
check('inverseUnpaint painted monolayer → uncolored code',
    inverseUnpaint(shape('CrCrCrCr'), null), ['CuCuCuCu']);
check('inverseUnpaint painted top leaves lower layers alone',
    inverseUnpaint(shape('CuCuCuCu:RrRgRbRy'), null), ['CuCuCuCu:RuRuRuRu']);
check('inverseUnpaint mixed top unpaints only painted parts',
    inverseUnpaint(shape('CrCuRgCu'), null), ['CuCuRuCu']);

// --- rotation inverses: each is the forward op in the opposite direction -----
{
    const s = shape('CuRuSuWu');
    check('inverseRotateCW(rotate90CW(s)) recovers s',
        inverseRotateCW(rotate90CW(s)[0], null), ['CuRuSuWu']);
    check('inverseRotateCCW(rotate90CCW(s)) recovers s',
        inverseRotateCCW(rotate90CCW(s)[0], null), ['CuRuSuWu']);
    check('inverseRotate180(rotate180(s)) recovers s',
        inverseRotate180(rotate180(s)[0], null), ['CuRuSuWu']);
    // Direct predecessor of the unrotated shape (the inverse applied to s itself).
    check('inverseRotateCW(s) is rotate90CCW(s)',
        inverseRotateCW(s, null), [rotate90CCW(s)[0].toShapeCode()]);
    check('inverseRotateCCW(s) is rotate90CW(s)',
        inverseRotateCCW(s, null), [rotate90CW(s)[0].toShapeCode()]);
    check('inverseRotate180(s) is rotate180(s)',
        inverseRotate180(s, null), [rotate180(s)[0].toShapeCode()]);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
