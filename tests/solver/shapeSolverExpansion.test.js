// Unit tests for the successor-pruning gate in shapeSolverExpansion.js. Run with:
//   node tests/solver/shapeSolverExpansion.test.js
//
// shouldSkipUnaryOp decides which unary successors the solver and explorer ever
// generate. A wrong prune silently makes targets unsolvable — golden op tests
// and smoke path-validation only check paths that WERE found, so an over-eager
// skip never trips them. This suite pins the skip / don't-skip boundary for each
// prune branch (rotation symmetry, empty-half cut, monolayer paint, empty input,
// single-id trash), then confirms expandUnaryOp honours it end to end.
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { operations } from '../../shapeSolverOperations.js';
import { shouldSkipUnaryOp, expandUnaryOp } from '../../shapeSolverExpansion.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

const config = new ShapeOperationConfig(4);
const shape = (code) => Shape.fromShapeCode(code);
const skip = (op, code, opts = {}) => shouldSkipUnaryOp(op, shape(code), { config, ...opts });

// --- shouldSkipUnaryOp: MUST skip -------------------------------------------

// Empty input: no successor can come from nothing, regardless of op.
check('empty input skips (Cutter)', skip('Cutter', '--------'), true);

// Rotation symmetry: every rotation of CuCuCuCu is identical, so a rotator is a
// no-op — rotations.size === 1.
check('symmetric rotator skips (Rotator CW)', skip('Rotator CW', 'CuCuCuCu'), true);
check('symmetric rotator skips (Rotator CCW)', skip('Rotator CCW', 'CuCuCuCu'), true);
// Rotator 180 is redundant whenever a shape has 2-fold symmetry (size <= 2):
// CuRuCuRu rotated 180 maps back onto itself.
check('two-fold shape skips Rotator 180', skip('Rotator 180', 'CuRuCuRu'), true);

// One-sided cut: a half with an empty side would just reproduce the input.
check('right-empty half skips Cutter', skip('Cutter', 'CuCu----'), true);
check('left-empty half skips Cutter', skip('Cutter', '----SuWu'), true);
check('right-empty half skips Half Destroyer', skip('Half Destroyer', 'CuCu----'), true);

// Monolayer painting restricts Painter to single-layer inputs.
check('multi-layer paint skips under monolayerPainting',
    skip('Painter', 'CuCuCuCu:RuRuRuRu', { monolayerPainting: true }), true);

// The last remaining shape must not be trashed (nothing left to build with).
check('sole-id Trash skips', skip('Trash', 'CuCuCuCu', { availableIdsSize: 1 }), true);

// --- shouldSkipUnaryOp: MUST NOT skip ---------------------------------------

// Asymmetric rotator: CuRuSuWu has 4 distinct rotations, so rotating is useful.
check('asymmetric rotator not skipped (Rotator CW)', skip('Rotator CW', 'CuRuSuWu'), false);
check('two-fold shape NOT skipped by Rotator CW', skip('Rotator CW', 'CuRuCuRu'), false);

// Both halves occupied: a real cut that yields two distinct pieces.
check('both-halves cutter not skipped', skip('Cutter', 'CuRuSuWu'), false);

// Multi-layer complementary halves: each layer has one empty side, but on
// OPPOSITE sides — so neither side is empty across ALL layers. cut() runs every
// layer and yields two useful pieces (----SuSu and CuCu----), so the prune must
// NOT skip. A layer-0-only check wrongly reads layer 0's empty right half and
// skips, making ----SuSu unreachable from this start (audit finding).
check('multi-layer complementary-half cutter not skipped', skip('Cutter', 'CuCu----:----SuSu'), false);
check('multi-layer complementary-half Half Destroyer not skipped', skip('Half Destroyer', 'CuCu----:----SuSu'), false);

// Multi-layer with the SAME side empty on every layer is still a genuine no-op
// (one piece empty, the other the untouched input) — the prune must skip it.
check('multi-layer whole-side-empty cutter skips', skip('Cutter', 'CuCu----:SuSu----'), true);

// Single-layer paint is exactly what monolayerPainting allows.
check('single-layer paint not skipped under monolayerPainting',
    skip('Painter', 'CuCuCuCu', { monolayerPainting: true }), false);

// Trash with more than one shape available is a legal successor.
check('Trash not skipped when other shapes remain',
    skip('Trash', 'CuCuCuCu', { availableIdsSize: 2 }), false);

// --- expandUnaryOp: the skip actually suppresses descriptors ----------------

// A pruned op yields zero descriptors (empty-half cutter).
check('expandUnaryOp: pruned cutter → no descriptors',
    expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuCu----', shape('CuCu----'), config, { needsColor: false }),
    []);

// A valid cutter yields one descriptor with both cut halves as outputs.
const cutDesc = expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuRuSuWu', shape('CuRuSuWu'), config, { needsColor: false });
check('expandUnaryOp: valid cutter → one descriptor', cutDesc.length, 1);
check('expandUnaryOp: cutter descriptor type/inputs',
    { type: cutDesc[0]?.type, inputIds: cutDesc[0]?.inputIds, color: cutDesc[0]?.color },
    { type: 'Cutter', inputIds: [0], color: null });
check('expandUnaryOp: cutter outputs are the two halves',
    [...(cutDesc[0]?.outputCodes ?? [])].sort(), ['----SuWu', 'CuRu----']);

// End-to-end guard for the audit regression: a multi-layer shape with empty
// halves on opposite layers must cut into TWO useful pieces. A layer-0-only
// prune would skip this op and emit [] (target unreachable); the correct
// all-layers prune emits one descriptor carrying both non-empty halves.
const mlCutDesc = expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuCu----:----SuSu', shape('CuCu----:----SuSu'), config, { needsColor: false });
check('expandUnaryOp: multi-layer complementary cut → one descriptor', mlCutDesc.length, 1);
check('expandUnaryOp: multi-layer complementary cut emits both halves',
    [...(mlCutDesc[0]?.outputCodes ?? [])].sort(), ['----SuSu', 'CuCu----']);

// Painter enumerates target-implied colors and applies each.
const paintDesc = expandUnaryOp('Painter', operations['Painter'], 0, 'CuCuCuCu', shape('CuCuCuCu'), config,
    { needsColor: true, colorContext: { target: shape('CrCrCrCr') } });
check('expandUnaryOp: painter → one recolored descriptor', paintDesc,
    [{ type: 'Painter', inputIds: [0], outputCodes: ['CrCrCrCr'], color: 'r' }]);

// Monolayer-paint pruning threads through expandUnaryOp too.
check('expandUnaryOp: multi-layer paint pruned under monolayerPainting',
    expandUnaryOp('Painter', operations['Painter'], 0, 'CuCuCuCu:RuRuRuRu', shape('CuCuCuCu:RuRuRuRu'), config,
        { needsColor: true, pruning: { monolayerPainting: true }, colorContext: { target: shape('CrCrCrCr:RrRrRrRr') } }),
    []);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
