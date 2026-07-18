// Standalone tests for shapeAnalysis.js — run with: node tests/shape/shapeAnalysis.test.js
//
// Covers the pure analysis helpers (audit #2209 — the file had zero coverage):
// getPaintColors, getCrystalColors, the similarity stack (getSimilarity,
// getPartTypeCounts, getPartCounts, compareCounts, comparePartOrder), the
// solver pre-filter trio (getRequiredColors, getRequiredShapes,
// filterStartingShapes), and extractLayers (the UI "Extract Shapes" decomposer).
// Every function here is pure: it reads shape.layers and builds fresh structures,
// so we also spot-check that inputs are never mutated.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import {
    getPaintColors,
    getCrystalColors,
    getSimilarity,
    getPartTypeCounts,
    getPartCounts,
    compareCounts,
    comparePartOrder,
    getRequiredColors,
    getRequiredShapes,
    filterStartingShapes,
    extractLayers,
} from '../../shapeAnalysis.js';
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
// getRequiredColors / getRequiredShapes — solver pre-filter inputs.
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
// Input immutability — these are analysis helpers, but the solver shares parsed
// Shape objects via the cache, so accidental mutation would be catastrophic.
// ============================================================================
{
    const a = S('CrCuCrCu'), b = S('CuCuCuCu');
    const before = [a.toShapeCode(), b.toShapeCode()];
    getPaintColors(a, b);
    getSimilarity(a, b);
    comparePartOrder(a, b);
    truthy("inputs not mutated by analysis helpers",
        a.toShapeCode() === before[0] && b.toShapeCode() === before[1]);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
