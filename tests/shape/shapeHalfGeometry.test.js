// Unit tests for cut half-geometry (the single source of truth for left/right).
// Run with: node tests/shape/shapeHalfGeometry.test.js
import { Shape, ShapePart, NOTHING_CHAR, layerToCode } from '../../shapeClass.js';
import {
    leftHalfSize,
    rightHalfSize,
    isLeftHalfEmpty,
    isRightHalfEmpty,
    isLeftHalfEmptyShape,
    isRightHalfEmptyShape,
    buildLeftHalfParts,
    buildRightHalfParts,
} from '../../shapeHalfGeometry.js';
import { cut } from '../../shapeOperations.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

const EMPTY = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
const s = (code) => Shape.fromShapeCode(code);

// --- sizes: even and odd part counts (ceil left, floor right) ---------------
check('leftHalfSize(4)', leftHalfSize(4), 2);
check('rightHalfSize(4)', rightHalfSize(4), 2);
check('leftHalfSize(6)', leftHalfSize(6), 3);
check('rightHalfSize(6)', rightHalfSize(6), 3);
check('leftHalfSize(5) is ceil', leftHalfSize(5), 3);
check('rightHalfSize(5) is floor', rightHalfSize(5), 2);
check('left+right cover n=5', leftHalfSize(5) + rightHalfSize(5), 5);
check('left+right cover n=4', leftHalfSize(4) + rightHalfSize(4), 4);

// --- empty-side predicates match cut product sides --------------------------
// CuRu---- keeps leading (right); trailing (left) is empty.
check('isLeftHalfEmpty on right-only half', isLeftHalfEmpty(s('CuRu----').layers[0]), true);
check('isRightHalfEmpty on right-only half', isRightHalfEmpty(s('CuRu----').layers[0]), false);
// ----SuWu keeps trailing (left); leading (right) is empty.
check('isLeftHalfEmpty on left-only half', isLeftHalfEmpty(s('----SuWu').layers[0]), false);
check('isRightHalfEmpty on left-only half', isRightHalfEmpty(s('----SuWu').layers[0]), true);
// Full shape: neither half empty.
check('isLeftHalfEmpty on full', isLeftHalfEmpty(s('CuRuSuWu').layers[0]), false);
check('isRightHalfEmpty on full', isRightHalfEmpty(s('CuRuSuWu').layers[0]), false);

// Multi-layer complementary: neither side empty across ALL layers.
check('complementary multi-layer not left-empty',
    isLeftHalfEmptyShape(s('CuCu----:----SuSu')), false);
check('complementary multi-layer not right-empty',
    isRightHalfEmptyShape(s('CuCu----:----SuSu')), false);
// Same side empty on every layer.
check('whole-side multi-layer is left-empty',
    isLeftHalfEmptyShape(s('CuCu----:SuSu----')), true);
check('whole-side multi-layer is not right-empty',
    isRightHalfEmptyShape(s('CuCu----:SuSu----')), false);

// --- positioned builders match cut() product codes --------------------------
const full = s('CuRuSuWu').layers[0];
check('buildLeftHalfParts matches cut left',
    layerToCode(buildLeftHalfParts(full, EMPTY)), cut(s('CuRuSuWu'))[0].toShapeCode());
check('buildRightHalfParts matches cut right',
    layerToCode(buildRightHalfParts(full, EMPTY)), cut(s('CuRuSuWu'))[1].toShapeCode());

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
