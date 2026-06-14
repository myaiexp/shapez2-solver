// Standalone tests for shapeAnalysis.js — run with: node tests/shapeAnalysis.test.js
//
// Covers the pure analysis helpers (audit #2209 — the file had zero coverage):
// _extractLayers (all four mode variants + include flags, per finding #2213),
// _getPaintColors, _getCrystalColors, the similarity stack (_getSimilarity,
// _getPartTypeCounts, _getPartCounts, _compareCounts, _comparePartOrder), and
// the solver pre-filter trio (_getRequiredColors, _getRequiredShapes,
// _filterStartingShapes). Every function here is pure: it reads shape.layers and
// builds fresh structures, so we also spot-check that inputs are never mutated.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import {
    _extractLayers,
    _getPaintColors,
    _getCrystalColors,
    _getSimilarity,
    _getPartTypeCounts,
    _getPartCounts,
    _compareCounts,
    _comparePartOrder,
    _getRequiredColors,
    _getRequiredShapes,
    _filterStartingShapes,
} from '../shapeAnalysis.js';
import { Shape } from '../shapeClass.js';

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
// _extractLayers — groups each layer's parts by key (mode), one grouped layer
// per distinct key, with parts placed back at their original index. Nothing and
// Crystal parts are always dropped; Pins drop only when includePins=false.
// ============================================================================

// mode 'part' (default): one grouped layer per distinct shape char.
eqArr("_extractLayers part: CuRuSuWu → one layer per shape, index-preserved",
    _extractLayers(S('CuRuSuWu')),
    ['Cu------', '--Ru----', '----Su--', '------Wu']);
eqArr("_extractLayers part: repeated shapes merge into one layer (CuCuRuRu)",
    _extractLayers(S('CuCuRuRu')),
    ['CuCu----', '----RuRu']);

// mode 'layer': single key → whole layer kept intact (Nothing/Crystal still dropped).
eqArr("_extractLayers layer: keeps each layer whole (CuRuSuWu)",
    _extractLayers(S('CuRuSuWu'), 'layer'),
    ['CuRuSuWu']);
eqArr("_extractLayers layer: per-layer over multi-layer input",
    _extractLayers(S('CuRuSuWu:WuWuWuWu'), 'layer'),
    ['CuRuSuWu', 'WuWuWuWu']);

// mode 'color': group by color, shape+color preserved.
eqArr("_extractLayers color: groups by color char (CrCrRgRg)",
    _extractLayers(S('CrCrRgRg'), 'color'),
    ['CrCr----', '----RgRg']);

// mode 'part-color': group by shape+color pair.
eqArr("_extractLayers part-color: splits same shape by color (CrCuCrCu)",
    _extractLayers(S('CrCuCrCu'), 'part-color'),
    ['Cr--Cr--', '--Cu--Cu']);

// includeColor=false → colors collapsed to 'u' in the output.
eqArr("_extractLayers includeColor=false collapses color to u (CrCrCrCr)",
    _extractLayers(S('CrCrCrCr'), 'part', true, false),
    ['CuCuCuCu']);

// Pins: kept by default, dropped when includePins=false.
eqArr("_extractLayers keeps pins by default (CuP-----)",
    _extractLayers(S('CuP-----')),
    ['Cu------', '--P-----']);
eqArr("_extractLayers includePins=false drops pins (CuP-----)",
    _extractLayers(S('CuP-----'), 'part', false),
    ['Cu------']);

// Crystals are always dropped (here 'c' = crystal).
eqArr("_extractLayers always drops crystal parts (cuCuRu--)",
    _extractLayers(S('cuCuRu--')),
    ['--Cu----', '----Ru--']);

// A fully-empty layer contributes nothing.
eqArr("_extractLayers skips an all-Nothing layer (--------:CuCuCuCu)",
    _extractLayers(S('--------:CuCuCuCu')),
    ['CuCuCuCu']);

// ============================================================================
// _getPaintColors — for each paintable part of the INPUT's top layer, the set
// of target colors (for that shape) that differ from the part's current color.
// ============================================================================
eqArr("_getPaintColors: u→target color per shape (CuRuCuRu → CrCrRgRg)",
    _getPaintColors(S('CuRuCuRu'), S('CrCrRgRg')),
    ['r', 'g']);
eqArr("_getPaintColors: top layer only (Cu base ignored, top Ru painted)",
    _getPaintColors(S('CuCuCuCu:RuRuRuRu'), S('RgRgRgRg')),
    ['g']);
eqArr("_getPaintColors: already-matching color yields nothing",
    _getPaintColors(S('CrCrCrCr'), S('CrCrCrCr')),
    []);
eqArr("_getPaintColors: unpaintable input parts (X) skipped",
    _getPaintColors(S('CuCuXuXu'), S('CrCrCrCr')),
    ['r']);

// ============================================================================
// _getCrystalColors — distinct crystal colors, or ['u'] when there are none.
// ============================================================================
eqArr("_getCrystalColors: single crystal color (crcr----)",
    _getCrystalColors(S('crcr----')),
    ['r']);
eqArr("_getCrystalColors: multiple crystal colors, insertion order (cgcrCuRu)",
    _getCrystalColors(S('cgcrCuRu')),
    ['g', 'r']);
eqArr("_getCrystalColors: no crystals → ['u'] fallback",
    _getCrystalColors(S('CuRuSuWu')),
    ['u']);

// ============================================================================
// _getPartTypeCounts / _getPartCounts — multiset counts (Nothing IS counted).
// ============================================================================
{
    const c = _getPartTypeCounts(S('CuRuSuWu'));
    eqNum("_getPartTypeCounts: distinct shapes counted (C)", c.get('C'), 1);
    eqNum("_getPartTypeCounts: distinct shapes counted (W)", c.get('W'), 1);
    eqNum("_getPartTypeCounts: distinct shapes size", c.size, 4);
}
{
    const c = _getPartTypeCounts(S('CuCu----'));
    eqNum("_getPartTypeCounts: repeated shape counted (C:2)", c.get('C'), 2);
    eqNum("_getPartTypeCounts: Nothing counted too (-:2)", c.get('-'), 2);
}
{
    const c = _getPartCounts(S('CrCuCrCu'));
    eqNum("_getPartCounts: shape:color key (C:r → 2)", c.get('C:r'), 2);
    eqNum("_getPartCounts: shape:color key (C:u → 2)", c.get('C:u'), 2);
    eqNum("_getPartCounts: two distinct keys", c.size, 2);
}

// ============================================================================
// _compareCounts — sum(min)/sum(max) over the key union; both-empty → 1.
// ============================================================================
approx("_compareCounts: both empty → 1", _compareCounts(new Map(), new Map()), 1);
approx("_compareCounts: identical → 1",
    _compareCounts(new Map([['C', 2]]), new Map([['C', 2]])), 1);
approx("_compareCounts: 2 vs 1 → 0.5",
    _compareCounts(new Map([['C', 2]]), new Map([['C', 1]])), 0.5);
approx("_compareCounts: extra key halves the ratio",
    _compareCounts(new Map([['C', 1], ['R', 1]]), new Map([['C', 1]])), 0.5);
approx("_compareCounts: disjoint keys → 0",
    _compareCounts(new Map([['C', 1]]), new Map([['R', 1]])), 0);

// ============================================================================
// _comparePartOrder — best part-shape match ratio across all CW rotations of
// shape1; 0 when the layer counts differ.
// ============================================================================
approx("_comparePartOrder: identical → 1", _comparePartOrder(S('CuRuSuWu'), S('CuRuSuWu')), 1);
approx("_comparePartOrder: a rotation lines up → 1 (RuCuRuCu vs CuRuCuRu)",
    _comparePartOrder(S('RuCuRuCu'), S('CuRuCuRu')), 1);
approx("_comparePartOrder: differing layer counts → 0",
    _comparePartOrder(S('CuRuSuWu'), S('CuRuSuWu:CuRuSuWu')), 0);
approx("_comparePartOrder: partial best match (CuRuSuWu vs CuXuXuXu → 0.25)",
    _comparePartOrder(S('CuRuSuWu'), S('CuXuXuXu')), 0.25);

// ============================================================================
// _getSimilarity — typeSim*wType + colorSim*wColor + orderSim*wOrder.
// ============================================================================
approx("_getSimilarity: identical shapes → 1", _getSimilarity(S('CuRuSuWu'), S('CuRuSuWu')), 1);
approx("_getSimilarity: fully different shapes → 0",
    _getSimilarity(S('CuCuCuCu'), S('RuRuRuRu')), 0);
// Same shape, different color: typeSim=1, colorSim=0, orderSim=1 (shape-only compare).
approx("_getSimilarity: default weights blend (CrCrCrCr vs CuCuCuCu → 0.7)",
    _getSimilarity(S('CrCrCrCr'), S('CuCuCuCu')), 0.7);
approx("_getSimilarity: weights={type:1} isolates type term → 1",
    _getSimilarity(S('CrCrCrCr'), S('CuCuCuCu'), { type: 1, color: 0, order: 0 }), 1);
approx("_getSimilarity: weights={color:1} isolates color term → 0",
    _getSimilarity(S('CrCrCrCr'), S('CuCuCuCu'), { type: 0, color: 1, order: 0 }), 0);

// ============================================================================
// _getRequiredColors / _getRequiredShapes — solver pre-filter inputs.
// ============================================================================
eqSet("_getRequiredColors: distinct non-u paintable colors (CrCrRgRg)",
    _getRequiredColors(S('CrCrRgRg')), ['r', 'g']);
eqSet("_getRequiredColors: all-uncolored → empty", _getRequiredColors(S('CuRuSuWu')), []);
eqSet("_getRequiredColors: unpaintable (X) color ignored, paintable kept (XrCg----)",
    _getRequiredColors(S('XrCg----')), ['g']);

eqSet("_getRequiredShapes: all structural shapes (CuRuSuWu)",
    _getRequiredShapes(S('CuRuSuWu')), ['C', 'R', 'S', 'W']);
eqSet("_getRequiredShapes: Nothing excluded (CuCu----)",
    _getRequiredShapes(S('CuCu----')), ['C']);
eqSet("_getRequiredShapes: Crystal excluded (cuCu----)",
    _getRequiredShapes(S('cuCu----')), ['C']);
eqSet("_getRequiredShapes: Pin IS a required shape (P-Cu----)",
    _getRequiredShapes(S('P-Cu----')), ['P', 'C']);

// ============================================================================
// _filterStartingShapes — keep a start code iff it has a required shape, or a
// required color on a paintable part. Both-empty target → keep everything.
// ============================================================================
eqArr("_filterStartingShapes: keep by required shape, drop unrelated",
    _filterStartingShapes(['CuCuCuCu', 'HuHuHuHu', 'WuWuWuWu'], 'CuRuSuWu'),
    ['CuCuCuCu', 'WuWuWuWu']);
eqArr("_filterStartingShapes: no requirements (all-Nothing target) → keep all",
    _filterStartingShapes(['CuCuCuCu', 'RuRuRuRu'], '--------'),
    ['CuCuCuCu', 'RuRuRuRu']);
eqArr("_filterStartingShapes: keep by required color on paintable part",
    _filterStartingShapes(['RrRrRrRr', 'SuSuSuSu', 'CuCuCuCu'], 'CrCrCrCr'),
    ['RrRrRrRr', 'CuCuCuCu']);
eqArr("_filterStartingShapes: required color on UNPAINTABLE part doesn't count",
    _filterStartingShapes(['XrXrXrXr'], 'CrCrCrCr'),
    []);

// ============================================================================
// Input immutability — these are analysis helpers, but the solver shares parsed
// Shape objects via the cache, so accidental mutation would be catastrophic.
// ============================================================================
{
    const a = S('CrCuCrCu'), b = S('CuCuCuCu');
    const before = [a.toShapeCode(), b.toShapeCode()];
    _extractLayers(a, 'part-color', true, false);
    _getPaintColors(a, b);
    _getSimilarity(a, b);
    _comparePartOrder(a, b);
    truthy("inputs not mutated by analysis helpers",
        a.toShapeCode() === before[0] && b.toShapeCode() === before[1]);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
