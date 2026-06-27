// Unit tests for the early-return branches of the inverse (predecessor) ops in
// shapeSolverInverse.js. Run with: node tests/shapeSolverInverse.test.js
//
// inverseUnstack / inverseUncut / inverseUnpin each bail out with an empty
// result array on an early-exit guard (wrong layer count). This suite asserts
// those early returns, plus one contrasting non-early-return case per function
// so the empty result is proven to come from the guard, not from the function
// always returning empty.
import { Shape } from '../shapeClass.js';
import {
    inverseUnstack,
    inverseUncut,
    inverseUnpin
} from '../shapeSolverInverse.js';

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

// --- inverseUncut: early return when numLayers !== 1 -------------------------
// Guard: `if (shape.numLayers !== 1) return results;` — uncut only applies to a
// single-layer half, so any multi-layer shape returns the empty array.
check('inverseUncut 2-layer returns []', inverseUncut(shape('CuCu----:RuRu----'), null), []);
check('inverseUncut 3-layer returns []', inverseUncut(shape('Cu------:--Ru----:----Su--'), null), []);
// Contrast: a single-layer right-empty half passes the guard and reconstructs a whole.
check('inverseUncut single-layer half (non-early)', inverseUncut(shape('CuCu----'), null), ['CuCu----']);

// --- inverseUnpin: early return when numLayers < 2 ---------------------------
// Guard: `if (shape.numLayers < 2) return results;` — a single-layer shape has
// no bottom pin layer to remove, so the empty array is returned.
check('inverseUnpin single-layer returns []', inverseUnpin(shape('CuCuCuCu'), null), []);
check('inverseUnpin single-layer pins returns []', inverseUnpin(shape('P-P-P-P-'), null), []);
// Contrast: a 2-layer shape with an all-pin bottom passes the guard and drops it.
check('inverseUnpin 2-layer pin base (non-early)', inverseUnpin(shape('P-P-P-P-:CuCuCuCu'), null), ['CuCuCuCu']);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
