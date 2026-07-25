// Standalone tests for shapeColorAnalysis.js — run with: node tests/shape/shapeColorAnalysis.test.js
//
// Covers the two solver-facing color helpers (audit #2209 — these had zero
// coverage before; audit #5530 split them out of the old shapeAnalysis.js):
// getPaintColors and getCrystalColors. Both are pure: they read shape.layers
// and build fresh structures, so we also spot-check that inputs are never
// mutated — the solver shares parsed Shape objects via getCachedShape, so an
// in-place write here would corrupt every later state.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import { getPaintColors, getCrystalColors } from '../../shapeColorAnalysis.js';
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

// Deep-equals via JSON — used for arrays of strings (shape codes / color lists).
function eqArr(name, actual, expected) {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
    else bad(name, JSON.stringify(expected), JSON.stringify(actual));
}

function truthy(name, cond) {
    total++;
    if (cond) ok(name);
    else bad(name, 'truthy', cond);
}

// ============================================================================
// getPaintColors — for each paintable part of the INPUT's top layer, the set
// of target colors (for that shape) that differ from the part's current color.
// ============================================================================
eqArr("getPaintColors: u→target color per shape (CuRuCuRu → CrCrRgRg)",
    getPaintColors(S('CuRuCuRu'), S('CrCrRgRg')),
    ['r', 'g']);
eqArr("getPaintColors: top layer only (Cu base ignored, top Ru painted)",
    getPaintColors(S('CuCuCuCu:RuRuRuRu'), S('RgRgRgRg')),
    ['g']);
eqArr("getPaintColors: already-matching color yields nothing",
    getPaintColors(S('CrCrCrCr'), S('CrCrCrCr')),
    []);
eqArr("getPaintColors: unpaintable input parts (X) skipped",
    getPaintColors(S('CuCuXuXu'), S('CrCrCrCr')),
    ['r']);

// ============================================================================
// getCrystalColors — distinct crystal colors, or ['u'] when there are none.
// ============================================================================
eqArr("getCrystalColors: single crystal color (crcr----)",
    getCrystalColors(S('crcr----')),
    ['r']);
eqArr("getCrystalColors: multiple crystal colors, insertion order (cgcrCuRu)",
    getCrystalColors(S('cgcrCuRu')),
    ['g', 'r']);
eqArr("getCrystalColors: no crystals → ['u'] fallback",
    getCrystalColors(S('CuRuSuWu')),
    ['u']);

// ============================================================================
// Input immutability — the solver shares parsed Shape objects via the cache,
// so accidental mutation would be catastrophic.
// ============================================================================
{
    const a = S('crCuCrCu'), b = S('CuCuCuCu');
    const before = [a.toShapeCode(), b.toShapeCode()];
    getPaintColors(a, b);
    getCrystalColors(a);
    truthy("inputs not mutated by color-analysis helpers",
        a.toShapeCode() === before[0] && b.toShapeCode() === before[1]);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
