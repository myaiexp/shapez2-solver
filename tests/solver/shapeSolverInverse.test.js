// Unit tests for inverse (predecessor) ops in shapeSolverInverse.js.
// Run with: node tests/solver/shapeSolverInverse.test.js
//
// Covers early-exit guards (wrong layer count) for inverseUnstack / inverseUncut /
// inverseUnpin, plus inverseUncut's identity-half contract (geometric left/right
// matching cut()) and one non-early-return case per function so empty results are
// proven to come from the guard, not from always returning empty.
//
// Also the four previously untested inverses (finding #8618): inverseUnpaint and
// the three rotation inverses. Rotations are each other's inverses of the forward
// ops; unpaint returns a 0-or-1 array (not one code per original color).
import { Shape } from '../../shapeClass.js';
import { rotate90CW, rotate90CCW, rotate180 } from '../../shapeRotation.js';
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

// --- inverseUncut: multi-layer early return; pure half = identity whole ------
// Guard: multi-layer → []. Geometry matches cut(): leading = right, trailing = left.
// Contract is identity empty-opposite only (no invented mates/mirrors).
check('inverseUncut 2-layer returns []', inverseUncut(shape('CuCu----:RuRu----'), null), []);
check('inverseUncut 3-layer returns []', inverseUncut(shape('Cu------:--Ru----:----Su--'), null), []);
// Pure geometric right half (trailing/left empty) → identity predecessor.
check('inverseUncut pure right half is identity', inverseUncut(shape('CuCu----'), null), ['CuCu----']);
// Pure geometric left half (leading/right empty) → identity predecessor.
check('inverseUncut pure left half is identity', inverseUncut(shape('----SuWu'), null), ['----SuWu']);
// Both sides occupied: not a Cutter half-output we reverse.
check('inverseUncut both-halves returns []', inverseUncut(shape('CuRuSuWu'), null), []);
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
