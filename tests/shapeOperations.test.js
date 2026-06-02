// Golden regression tests for the core shapeOperations primitives that lacked a
// hard-coded anchor — run with: node tests/shapeOperations.test.js
//
// smoke.js "tests" these ops via a snapshot file that auto-baselines whatever the
// code emits on first run (no regression protection on a fresh baseline). The
// other unit suites already pin rotation (shapeRotation.test.js), crystals/pins
// (shapeCrystals.test.js) and gravity (shapeGravity.test.js) with literals — but
// the half-split geometry of cut, the layer order of stack, the Painter
// primitive (topPaint) and the A* similarity heuristic (_getSimilarity) had no
// golden assertion. These are literal input -> literal output, independent of
// snapshots.json, so they fail loudly if the algorithm silently regresses.
import { Shape } from '../shapeClass.js';
import { cut, stack, topPaint } from '../shapeOperations.js';
import { _getSimilarity } from '../shapeAnalysis.js';

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

// --- _getSimilarity: A* heuristic core -----------------------------------
// Identical shapes are maximally similar (type+colour+order all match -> 1.0).
check('similarity of identical shapes is 1',
    _getSimilarity(s('CuCuCuCu'), s('CuCuCuCu')), 1);

// Fully disjoint shapes (no shared part type, colour, or order) score 0.
check('similarity of fully disjoint shapes is 0',
    _getSimilarity(s('CuCuCuCu'), s('RuRuRuRu')), 0);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
