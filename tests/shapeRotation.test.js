// Unit tests for shapeRotation primitives + _comparePartOrder — run with: node tests/shapeRotation.test.js
import { Shape } from '../shapeClass.js';
import { rotate90CW, rotate90CCW, rotate180 } from '../shapeRotation.js';
import { _comparePartOrder } from '../shapeAnalysis.js';
import { rotate90CW as opsRotate90CW } from '../shapeOperations.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        failed = true;
    }
}

const s = code => Shape.fromShapeCode(code);

// Rotation primitives: known shape, known result. These catch any corruption of
// the rotation logic (direction, offset, layer handling).
check('rotate90CW shifts parts clockwise',
    rotate90CW(s('CuRuSuWu'))[0].toShapeCode(), 'WuCuRuSu');
check('rotate90CCW shifts parts counter-clockwise',
    rotate90CCW(s('CuRuSuWu'))[0].toShapeCode(), 'RuSuWuCu');
check('rotate180 shifts parts by half',
    rotate180(s('CuRuSuWu'))[0].toShapeCode(), 'SuWuCuRu');

// rotate90CW applied 4 times returns to the original (full revolution).
let r = s('CuRuSuWu');
for (let i = 0; i < 4; i++) r = rotate90CW(r)[0];
check('rotate90CW x4 is identity', r.toShapeCode(), 'CuRuSuWu');

// shapeOperations re-export is the exact same function reference (byte-identical API).
check('shapeOperations re-exports the same rotate90CW',
    opsRotate90CW === rotate90CW, true);

// _comparePartOrder ordering against a KNOWN rotation case.
// Identity: a shape compared with itself matches fully.
check('_comparePartOrder identity → 1',
    _comparePartOrder(s('CuRuSuWu'), s('CuRuSuWu')), 1);
// Rotation-aware: shape2 is exactly rotate90CW(shape1), so one of the rotations
// _comparePartOrder generates (via rotate90CW) aligns perfectly → ratio 1.
check('_comparePartOrder finds the matching rotation → 1',
    _comparePartOrder(s('CuRuSuWu'), s('WuCuRuSu')), 1);
// Partial: each rotation of CuRuSuWu shares exactly one part-type with CuCuCuCu → 1/4.
check('_comparePartOrder partial overlap → 0.25',
    _comparePartOrder(s('CuRuSuWu'), s('CuCuCuCu')), 0.25);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
