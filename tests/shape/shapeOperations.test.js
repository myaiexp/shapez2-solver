// Golden regression tests for the core shapeOperations primitives that lacked a
// hard-coded anchor — run with: node tests/shape/shapeOperations.test.js
//
// smoke.js "tests" these ops via a snapshot file that auto-baselines whatever the
// code emits on first run (no regression protection on a fresh baseline). The
// other unit suites already pin rotation (shapeRotation.test.js), crystals/pins
// (shapeCrystals.test.js) and gravity (shapeGravity.test.js) with literals — but
// the half-split geometry of cut, the layer order of stack, the Painter
// primitive (topPaint), getSimilarity (legacy shape-comparison metric kept for
// tests/shared/smoke; the solver uses _matchAndCoverage in shapeSolverCore.js since
// idea #1677, not getSimilarity) and the
// remaining structural ops (halfCut, swapHalves, trash, beltSplit) had no
// golden assertion. These are literal input -> literal output, independent of
// snapshots.json, so they fail loudly if the algorithm silently regresses.
import { Shape } from '../../shapeClass.js';
import { cut, stack, topPaint, halfCut, swapHalves, trash, beltSplit, extractLayers } from '../../shapeOperations.js';
import { getSimilarity } from '../../shapeAnalysis.js';

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

// Shape codes use Shapez 2 notation: each part is two chars (shape+color), four
// parts per layer, ':' separates layers (first segment = bottom/floor).
const s = code => Shape.fromShapeCode(code);
const codes = shapes => shapes.map(sh => sh.toShapeCode());

// --- cut: half-split geometry --------------------------------------------
// cut returns [right-half, left-half]: the right half keeps the trailing two
// quadrants (shifted into place, leading two emptied), the left half keeps the
// leading two. A symmetric shape verifies the split count and emptying.
check('cut halves a full single layer into right/left',
    codes(cut(s('CuCuCuCu'))), ['----CuCu', 'CuCu----']);

// An asymmetric shape pins the quadrant -> half MAPPING (which quadrants land in
// which half) — a symmetric shape can't catch a quadrant-ordering regression.
// CuRuSuWu -> right keeps Su,Wu; left keeps Cu,Ru.
check('cut maps quadrants to halves (asymmetric)',
    codes(cut(s('CuRuSuWu'))), ['----SuWu', 'CuRu----']);

// --- stack: bottom/top layer order ---------------------------------------
// stack(bottom, top) places the FIRST argument on the floor and the second on
// top; distinct colours pin the order so a bottom/top swap is caught.
check('stack puts the first shape on the bottom layer',
    codes(stack(s('CuCuCuCu'), s('RuRuRuRu'))), ['CuCuCuCu:RuRuRuRu']);

// --- topPaint: the Painter primitive -------------------------------------
// Recolours every paintable part of the top layer to the given colour.
check('topPaint recolours the whole top layer',
    codes(topPaint(s('CuCuCuCu'), 'r')), ['CrCrCrCr']);

// Empty quadrants are unpaintable — they stay '--', they do NOT become '-r'.
// This catches a regression that paints holes as well as solids.
check('topPaint leaves empty quadrants unpainted',
    codes(topPaint(s('Cu------'), 'r')), ['Cr------']);

// Multi-layer: the Painter only touches the TOP (last) layer. Lower layers must
// be left exactly as-is. Here the bottom is uncoloured (Cu) and only the top
// (Ru) is recoloured red -> bottom stays Cu, top becomes Rr.
check('topPaint paints only the top layer of a multi-layer shape',
    codes(topPaint(s('CuCuCuCu:RuRuRuRu'), 'r')), ['CuCuCuCu:RrRrRrRr']);

// Contrasting case that makes "only the top layer" a meaningful claim: give the
// bottom layer a colour DIFFERENT from the paint. If topPaint ever recoloured
// all layers, the green bottom would turn red — so this fails loudly on that
// regression. Correct: green bottom stays green, top is repainted red.
check('topPaint leaves a pre-coloured lower layer untouched',
    codes(topPaint(s('CgCgCgCg:RuRuRuRu'), 'r')), ['CgCgCgCg:RrRrRrRr']);

// Three layers pins that ONLY the topmost is painted — both the middle (already
// green) and the bottom (uncoloured) survive unchanged, only the top goes blue.
check('topPaint on a 3-layer shape paints just the topmost layer',
    codes(topPaint(s('CuCuCuCu:RgRgRgRg:SuSuSuSu'), 'b')),
    ['CuCuCuCu:RgRgRgRg:SbSbSbSb']);

// --- getSimilarity: legacy similarity metric (not solver A* heuristic) ----
// Identical shapes are maximally similar (type+colour+order all match -> 1.0).
check('similarity of identical shapes is 1',
    getSimilarity(s('CuCuCuCu'), s('CuCuCuCu')), 1);

// Fully disjoint shapes (no shared part type, colour, or order) score 0.
check('similarity of fully disjoint shapes is 0',
    getSimilarity(s('CuCuCuCu'), s('RuRuRuRu')), 0);

// --- halfCut: keep one half, discard the other ---------------------------
// halfCut is cut(...)[1] — it keeps the LEFT half (leading two quadrants) and
// throws the right half away. An asymmetric input pins WHICH half survives:
// CuRuSuWu -> left half CuRu----, the SuWu half is destroyed.
check('halfCut keeps the left half and discards the right',
    codes(halfCut(s('CuRuSuWu'))), ['CuRu----']);

// --- swapHalves: exchange the trailing halves of two shapes --------------
// Each output keeps its own leading half and takes the OTHER shape's trailing
// half. Distinct colours per quadrant pin the quadrant mapping so a left/right
// or A/B mix-up is caught.
//   A=CuCuRuRu (lead CuCu | trail RuRu), B=SuSuWuWu (lead SuSu | trail WuWu)
//   -> A keeps CuCu, takes B's WuWu; B keeps SuSu, takes A's RuRu.
check('swapHalves exchanges trailing halves (all-distinct quadrants)',
    codes(swapHalves(s('CuCuRuRu'), s('SuSuWuWu'))), ['CuCuWuWu', 'SuSuRuRu']);

// A fully asymmetric pair (every quadrant distinct, no symmetry to hide an
// index error) exposes both within-half order and which half is swapped.
check('swapHalves on a fully asymmetric pair',
    codes(swapHalves(s('CuRuSuWu'), s('WuSuRuCu'))), ['CuRuRuCu', 'WuSuSuWu']);

// --- trash: destroys the shape entirely ----------------------------------
// trash returns NO output shapes (an empty array) — not the input, not an empty
// shape. A non-trivial multi-part input still yields nothing.
check('trash returns no output shapes',
    codes(trash(s('CuRuSuWu'))), []);

// --- beltSplit: duplicate the shape onto two outputs ---------------------
// beltSplit is a pass-through tee: the same shape comes out on both outputs,
// unchanged. A multi-part input pins that nothing is dropped or altered.
check('beltSplit duplicates the shape onto both outputs',
    codes(beltSplit(s('CuRuSuWu'))), ['CuRuSuWu', 'CuRuSuWu']);

// --- extractLayers: decompose a shape into per-key sub-shape codes --------
// Groups each layer's parts by key (mode), one grouped layer per distinct key,
// with parts placed back at their original index. Nothing and Crystal parts are
// always dropped; Pins drop only when includePins=false. (Moved here from the
// shapeAnalysis suite when extractLayers became a shapeOperations transform.)

// mode 'part' (default): one grouped layer per distinct shape char.
check('extractLayers part: CuRuSuWu → one layer per shape, index-preserved',
    extractLayers(s('CuRuSuWu')), ['Cu------', '--Ru----', '----Su--', '------Wu']);
check('extractLayers part: repeated shapes merge into one layer (CuCuRuRu)',
    extractLayers(s('CuCuRuRu')), ['CuCu----', '----RuRu']);

// mode 'layer': single key → whole layer kept intact (Nothing/Crystal dropped).
check('extractLayers layer: keeps each layer whole (CuRuSuWu)',
    extractLayers(s('CuRuSuWu'), 'layer'), ['CuRuSuWu']);
check('extractLayers layer: per-layer over multi-layer input',
    extractLayers(s('CuRuSuWu:WuWuWuWu'), 'layer'), ['CuRuSuWu', 'WuWuWuWu']);

// mode 'color': group by color, shape+color preserved.
check('extractLayers color: groups by color char (CrCrRgRg)',
    extractLayers(s('CrCrRgRg'), 'color'), ['CrCr----', '----RgRg']);

// mode 'part-color': group by shape+color pair.
check('extractLayers part-color: splits same shape by color (CrCuCrCu)',
    extractLayers(s('CrCuCrCu'), 'part-color'), ['Cr--Cr--', '--Cu--Cu']);

// includeColor=false → colors collapsed to 'u' in the output.
check('extractLayers includeColor=false collapses color to u (CrCrCrCr)',
    extractLayers(s('CrCrCrCr'), 'part', true, false), ['CuCuCuCu']);

// Pins: kept by default, dropped when includePins=false.
check('extractLayers keeps pins by default (CuP-----)',
    extractLayers(s('CuP-----')), ['Cu------', '--P-----']);
check('extractLayers includePins=false drops pins (CuP-----)',
    extractLayers(s('CuP-----'), 'part', false), ['Cu------']);

// Crystals are always dropped (here 'c' = crystal).
check('extractLayers always drops crystal parts (cuCuRu--)',
    extractLayers(s('cuCuRu--')), ['--Cu----', '----Ru--']);

// A fully-empty layer contributes nothing.
check('extractLayers skips an all-Nothing layer (--------:CuCuCuCu)',
    extractLayers(s('--------:CuCuCuCu')), ['CuCuCuCu']);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
