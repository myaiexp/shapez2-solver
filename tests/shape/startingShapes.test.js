// Standalone tests for startingShapes.js — run with: node tests/shape/startingShapes.test.js
//
// Covers the UI-side Starting Shapes prep (audit #2209 gave these their first
// coverage; audit #5530 split them out of the old shapeAnalysis.js): the target
// pre-filter trio (getRequiredColors, getRequiredShapes, filterStartingShapes)
// and extractLayers (the "Extract Shapes" modal's decomposer). Every function
// here is pure: it reads shape.layers and builds fresh structures, so we also
// spot-check that inputs are never mutated.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import {
    getRequiredColors,
    getRequiredShapes,
    filterStartingShapes,
    extractLayers,
} from '../../startingShapes.js';
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

// Set contents compared order-independently (sorted).
function eqSet(name, actualSet, expected) {
    total++;
    const a = Array.from(actualSet).sort();
    const e = [...expected].sort();
    if (JSON.stringify(a) === JSON.stringify(e)) ok(name);
    else bad(name, JSON.stringify(e), JSON.stringify(a));
}

function truthy(name, cond) {
    total++;
    if (cond) ok(name);
    else bad(name, 'truthy', cond);
}

// ============================================================================
// getRequiredColors / getRequiredShapes — starting-shape pre-filter inputs.
// ============================================================================
eqSet("getRequiredColors: distinct non-u paintable colors (CrCrRgRg)",
    getRequiredColors(S('CrCrRgRg')), ['r', 'g']);
eqSet("getRequiredColors: all-uncolored → empty", getRequiredColors(S('CuRuSuWu')), []);
eqSet("getRequiredColors: unpaintable (X) color ignored, paintable kept (XrCg----)",
    getRequiredColors(S('XrCg----')), ['g']);

eqSet("getRequiredShapes: all structural shapes (CuRuSuWu)",
    getRequiredShapes(S('CuRuSuWu')), ['C', 'R', 'S', 'W']);
eqSet("getRequiredShapes: Nothing excluded (CuCu----)",
    getRequiredShapes(S('CuCu----')), ['C']);
eqSet("getRequiredShapes: Crystal excluded (cuCu----)",
    getRequiredShapes(S('cuCu----')), ['C']);
eqSet("getRequiredShapes: Pin IS a required shape (P-Cu----)",
    getRequiredShapes(S('P-Cu----')), ['P', 'C']);

// ============================================================================
// filterStartingShapes — keep a start code iff it has a required shape, or a
// required color on a paintable part. Both-empty target → keep everything.
// ============================================================================
eqArr("filterStartingShapes: keep by required shape, drop unrelated",
    filterStartingShapes(['CuCuCuCu', 'HuHuHuHu', 'WuWuWuWu'], 'CuRuSuWu'),
    ['CuCuCuCu', 'WuWuWuWu']);
eqArr("filterStartingShapes: no requirements (all-Nothing target) → keep all",
    filterStartingShapes(['CuCuCuCu', 'RuRuRuRu'], '--------'),
    ['CuCuCuCu', 'RuRuRuRu']);
eqArr("filterStartingShapes: keep by required color on paintable part",
    filterStartingShapes(['RrRrRrRr', 'SuSuSuSu', 'CuCuCuCu'], 'CrCrCrCr'),
    ['RrRrRrRr', 'CuCuCuCu']);
eqArr("filterStartingShapes: required color on UNPAINTABLE part doesn't count",
    filterStartingShapes(['XrXrXrXr'], 'CrCrCrCr'),
    []);

// ============================================================================
// extractLayers — decompose a shape into per-key sub-shape codes. Groups each
// layer's parts by key (mode), one grouped layer per distinct key, parts placed
// back at their original index. Nothing/Crystal always dropped; Pins drop only
// when includePins=false.
// ============================================================================
// mode 'part' (default): one grouped layer per distinct shape char.
eqArr('extractLayers part: CuRuSuWu → one layer per shape, index-preserved',
    extractLayers(S('CuRuSuWu')), ['Cu------', '--Ru----', '----Su--', '------Wu']);
eqArr('extractLayers part: repeated shapes merge into one layer (CuCuRuRu)',
    extractLayers(S('CuCuRuRu')), ['CuCu----', '----RuRu']);

// mode 'layer': single key → whole layer kept intact (Nothing/Crystal dropped).
eqArr('extractLayers layer: keeps each layer whole (CuRuSuWu)',
    extractLayers(S('CuRuSuWu'), 'layer'), ['CuRuSuWu']);
eqArr('extractLayers layer: per-layer over multi-layer input',
    extractLayers(S('CuRuSuWu:WuWuWuWu'), 'layer'), ['CuRuSuWu', 'WuWuWuWu']);

// mode 'color': group by color, shape+color preserved.
eqArr('extractLayers color: groups by color char (CrCrRgRg)',
    extractLayers(S('CrCrRgRg'), 'color'), ['CrCr----', '----RgRg']);

// mode 'part-color': group by shape+color pair.
eqArr('extractLayers part-color: splits same shape by color (CrCuCrCu)',
    extractLayers(S('CrCuCrCu'), 'part-color'), ['Cr--Cr--', '--Cu--Cu']);

// includeColor=false → colors collapsed to 'u' in the output.
eqArr('extractLayers includeColor=false collapses color to u (CrCrCrCr)',
    extractLayers(S('CrCrCrCr'), 'part', true, false), ['CuCuCuCu']);

// Pins: kept by default, dropped when includePins=false.
eqArr('extractLayers keeps pins by default (CuP-----)',
    extractLayers(S('CuP-----')), ['Cu------', '--P-----']);
eqArr('extractLayers includePins=false drops pins (CuP-----)',
    extractLayers(S('CuP-----'), 'part', false), ['Cu------']);

// Crystals are always dropped (here 'c' = crystal).
eqArr('extractLayers always drops crystal parts (cuCuRu--)',
    extractLayers(S('cuCuRu--')), ['--Cu----', '----Ru--']);

// A fully-empty layer contributes nothing.
eqArr('extractLayers skips an all-Nothing layer (--------:CuCuCuCu)',
    extractLayers(S('--------:CuCuCuCu')), ['CuCuCuCu']);

// ============================================================================
// Input immutability — extractLayers rebuilds every layer from fresh
// ShapeParts, so the shape it decomposes must come back untouched.
// ============================================================================
{
    const a = S('CrCuCrCu');
    const before = a.toShapeCode();
    extractLayers(a, 'part-color');
    getRequiredColors(a);
    getRequiredShapes(a);
    truthy("inputs not mutated by starting-shape helpers", a.toShapeCode() === before);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
