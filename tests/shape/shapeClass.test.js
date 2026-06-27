// Standalone tests for shapeClass.js — run with: node tests/shapeClass.test.js
//
// Direct coverage for the pure Shape.isEmpty() method (audit #2216 — it was
// only exercised transitively, never asserted on its own). isEmpty() returns
// true iff *every* character of the concatenated layers is NOTHING_CHAR ('-'),
// i.e. every part is "--" (Nothing shape, no color). A single non-'-' char —
// a shape char OR a stray color — makes the shape non-empty.
import { Shape, ShapePart, NOTHING_CHAR } from '../shapeClass.js';

let passed = 0;
let total = 0;
let failed = false;

// Asserts shape.isEmpty() === expected.
function check(name, shape, expected) {
    total++;
    const actual = shape.isEmpty();
    if (actual === expected) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected isEmpty()=${expected}\n    actual   isEmpty()=${actual}`);
        failed = true;
    }
}

// Convenience: build from a Shapez 2 shape code, then assert.
function checkCode(name, code, expected) {
    check(`${name} (${code})`, Shape.fromShapeCode(code), expected);
}

// Sanity: NOTHING_CHAR is the '-' the method tests against.
total++;
if (NOTHING_CHAR === '-') {
    console.log('✓ NOTHING_CHAR is "-"');
    passed++;
} else {
    console.log(`✗ NOTHING_CHAR is "-"\n    actual: ${JSON.stringify(NOTHING_CHAR)}`);
    failed = true;
}

// --- Empty shapes → true ---
checkCode('single empty part', '--', true);
checkCode('two empty parts', '----', true);
checkCode('full empty layer (4 parts)', '--------', true);
checkCode('multi-layer all empty', '--------:--------', true);
checkCode('multi-layer single-part all empty', '--:--:--', true);

// --- Non-empty shapes → false ---
checkCode('single filled part (Cu)', 'Cu', false);
checkCode('full structural layer (CuRuSuWu)', 'CuRuSuWu', false);
checkCode('partially filled layer (Cu------)', 'Cu------', false);
checkCode('crystal (cu)', 'cu', false);
checkCode('pin — shape char, no color (P-)', 'P-', false);
checkCode('empty layer above a filled layer', '--------:Cu------', false);
checkCode('filled layer above an empty layer', 'Cu------:--------', false);

// --- Direct construction (independent of code parsing) ---
check('directly-built empty part',
    new Shape([[new ShapePart(NOTHING_CHAR, NOTHING_CHAR)]]), true);
// A Nothing shape carrying a stray color is NOT empty — the color char counts.
check('Nothing shape with a stray color (-u) is non-empty',
    new Shape([[new ShapePart(NOTHING_CHAR, 'u')]]), false);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
