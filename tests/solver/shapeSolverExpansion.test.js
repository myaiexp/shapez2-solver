// Unit tests for successor expansion in shapeSolverExpansion.js. Run with:
//   node tests/solver/shapeSolverExpansion.test.js
//
// shouldSkipUnaryOp decides which unary successors the solver and explorer ever
// generate. A wrong prune silently makes targets unsolvable — golden op tests
// and smoke path-validation only check paths that WERE found, so an over-eager
// skip never trips them. This suite pins the skip / don't-skip boundary for each
// prune branch (rotation symmetry, empty-half cut, monolayer paint, empty input),
// then confirms expandUnaryOp honours it end to end. Trash is not a prune branch:
// both callers special-case it with an early continue before expandUnaryOp, so
// shouldSkipUnaryOp never sees it.
//
// Binary siblings (buildBinaryInputDescriptor / expandBinaryOp) and Crystal
// Generator color enumeration had no direct callers here — a no-op Swapper
// leaking into the frontier, or Crystal Generator falling back to the wrong
// color set, would only show up as maxStates aborts on real workloads.
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { operations } from '../../shapeSolverOperations.js';
import {
    shouldSkipUnaryOp,
    expandUnaryOp,
    expandBinaryOp,
    buildBinaryInputDescriptor,
    enumerateUnaryColors,
} from '../../shapeSolverExpansion.js';

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

// One-sided cut: a half with an empty geometric side would just reproduce the input.
// cut convention (shapeHalfGeometry): left = trailing, right = leading.
// CuCu---- is a right-only half (left empty); ----SuWu is a left-only half (right empty).
check('left-empty half skips Cutter', skip('Cutter', 'CuCu----'), true);
check('right-empty half skips Cutter', skip('Cutter', '----SuWu'), true);
check('left-empty half skips Half Destroyer', skip('Half Destroyer', 'CuCu----'), true);

// Monolayer painting restricts Painter to single-layer inputs.
check('multi-layer paint skips under monolayerPainting',
    skip('Painter', 'CuCuCuCu:RuRuRuRu', { monolayerPainting: true }), true);

// --- shouldSkipUnaryOp: MUST NOT skip ---------------------------------------

// Asymmetric rotator: CuRuSuWu has 4 distinct rotations, so rotating is useful.
check('asymmetric rotator not skipped (Rotator CW)', skip('Rotator CW', 'CuRuSuWu'), false);
check('two-fold shape NOT skipped by Rotator CW', skip('Rotator CW', 'CuRuCuRu'), false);

// Both halves occupied: a real cut that yields two distinct pieces.
check('both-halves cutter not skipped', skip('Cutter', 'CuRuSuWu'), false);

// Multi-layer complementary halves: each layer has one empty geometric side, but
// on OPPOSITE sides — so neither side is empty across ALL layers. cut() runs every
// layer and yields two useful pieces (----SuSu and CuCu----), so the prune must
// NOT skip. A layer-0-only check wrongly reads layer 0's empty left half (trailing)
// and skips, making ----SuSu unreachable from this start (audit finding).
check('multi-layer complementary-half cutter not skipped', skip('Cutter', 'CuCu----:----SuSu'), false);
check('multi-layer complementary-half Half Destroyer not skipped', skip('Half Destroyer', 'CuCu----:----SuSu'), false);

// Multi-layer with the SAME side empty on every layer is still a genuine no-op
// (one piece empty, the other the untouched input) — the prune must skip it.
check('multi-layer whole-side-empty cutter skips', skip('Cutter', 'CuCu----:SuSu----'), true);

// Single-layer paint is exactly what monolayerPainting allows.
check('single-layer paint not skipped under monolayerPainting',
    skip('Painter', 'CuCuCuCu', { monolayerPainting: true }), false);

// --- expandUnaryOp: the skip actually suppresses descriptors ----------------
// useCache: false so this file does not populate the module-global
// operationResultCache (a later case with a different maxLayers would
// otherwise read a stale entry).

// A pruned op yields zero descriptors (empty-half cutter).
check('expandUnaryOp: pruned cutter → no descriptors',
    expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuCu----', shape('CuCu----'), config, { needsColor: false, useCache: false }),
    []);

// A valid cutter yields one descriptor with both cut halves as outputs.
const cutDesc = expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuRuSuWu', shape('CuRuSuWu'), config, { needsColor: false, useCache: false });
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
const mlCutDesc = expandUnaryOp('Cutter', operations['Cutter'], 0, 'CuCu----:----SuSu', shape('CuCu----:----SuSu'), config, { needsColor: false, useCache: false });
check('expandUnaryOp: multi-layer complementary cut → one descriptor', mlCutDesc.length, 1);
check('expandUnaryOp: multi-layer complementary cut emits both halves',
    [...(mlCutDesc[0]?.outputCodes ?? [])].sort(), ['----SuSu', 'CuCu----']);

// Painter enumerates target-implied colors and applies each.
const paintDesc = expandUnaryOp('Painter', operations['Painter'], 0, 'CuCuCuCu', shape('CuCuCuCu'), config,
    { needsColor: true, useCache: false, colorContext: { target: shape('CrCrCrCr') } });
check('expandUnaryOp: painter → one recolored descriptor', paintDesc,
    [{ type: 'Painter', inputIds: [0], outputCodes: ['CrCrCrCr'], color: 'r' }]);

// No target: referenceCodes must be an array of codes (solver materializes;
// explorer uses a getter). A function would throw "is not iterable".
// Reference CrCrCrCr supplies red for circle parts on the uncolored input.
const noTargetPaint = expandUnaryOp('Painter', operations['Painter'], 0, 'CuCuCuCu', shape('CuCuCuCu'), config, {
    needsColor: true,
    useCache: false,
    colorContext: {
        target: null,
        referenceCodes: ['CrCrCrCr'],
        getShape: (code) => shape(code),
    },
});
check('expandUnaryOp: painter without target uses referenceCodes array',
    noTargetPaint,
    [{ type: 'Painter', inputIds: [0], outputCodes: ['CrCrCrCr'], color: 'r' }]);

// Monolayer-paint pruning threads through expandUnaryOp too.
check('expandUnaryOp: multi-layer paint pruned under monolayerPainting',
    expandUnaryOp('Painter', operations['Painter'], 0, 'CuCuCuCu:RuRuRuRu', shape('CuCuCuCu:RuRuRuRu'), config,
        { needsColor: true, useCache: false, pruning: { monolayerPainting: true }, colorContext: { target: shape('CrCrCrCr:RrRrRrRr') } }),
    []);

// --- buildBinaryInputDescriptor: identity Swapper/Stacker must not expand -----
// The no-op guard is `isNoOp && outputCodes.length === 2`. Dropping either
// half lets identity Swapper successors fill the frontier (the state cap then
// hides it behind aborted:'maxStates'). A 1-output identity is still emitted
// — that length check is load-bearing, not a coincidence of Swapper arity.

const sameCircle = shape('CuCuCuCu');
const identSwapOut = operations['Swapper'].fn(sameCircle, sameCircle, config);
check('buildBinaryInputDescriptor: identical Swapper is a no-op',
    buildBinaryInputDescriptor('Swapper', 1, 2, 'CuCuCuCu', 'CuCuCuCu', identSwapOut),
    null);

const mixedSwapOut = operations['Swapper'].fn(sameCircle, shape('RuRuRuRu'), config);
const mixedSwapDesc = buildBinaryInputDescriptor('Swapper', 1, 2, 'CuCuCuCu', 'RuRuRuRu', mixedSwapOut);
check('buildBinaryInputDescriptor: mixed Swapper is not a no-op',
    mixedSwapDesc,
    { type: 'Swapper', inputIds: [1, 2], outputCodes: ['CuCuRuRu', 'RuRuCuCu'], color: null });

check('buildBinaryInputDescriptor: 1-output identity still emits (length check)',
    buildBinaryInputDescriptor('Stacker', 3, 4, 'CuCuCuCu', 'RuRuRuRu', [sameCircle]),
    { type: 'Stacker', inputIds: [3, 4], outputCodes: ['CuCuCuCu'], color: null });

// --- expandBinaryOp: empty-input guard, real Stacker, cache/no-cache split ---

const empty = shape('--------');
const stacker = operations['Stacker'];
check('expandBinaryOp: empty first input → null',
    expandBinaryOp('Stacker', stacker, 1, 2, '--------', 'RuRuRuRu', empty, shape('RuRuRuRu'), config, { useCache: false }),
    null);
check('expandBinaryOp: empty second input → null',
    expandBinaryOp('Stacker', stacker, 1, 2, 'CuCuCuCu', '--------', sameCircle, empty, config, { useCache: false }),
    null);

const stackDesc = expandBinaryOp(
    'Stacker', stacker, 7, 9, 'CuCuCuCu', 'RuRuRuRu',
    sameCircle, shape('RuRuRuRu'), config, { useCache: false },
);
check('expandBinaryOp: real Stacker descriptor',
    stackDesc,
    { type: 'Stacker', inputIds: [7, 9], outputCodes: ['CuCuCuCu:RuRuRuRu'], color: null });

const stackCached = expandBinaryOp(
    'Stacker', stacker, 7, 9, 'CuCuCuCu', 'RuRuRuRu',
    sameCircle, shape('RuRuRuRu'), config, { useCache: true },
);
check('expandBinaryOp: cache and no-cache descriptors match', stackCached, stackDesc);

check('expandBinaryOp: identical Swapper → null (no-op threads through)',
    expandBinaryOp('Swapper', operations['Swapper'], 1, 2, 'CuCuCuCu', 'CuCuCuCu', sameCircle, sameCircle, config, { useCache: false }),
    null);

// --- enumerateUnaryColors: Crystal Generator (Painter is covered above) ------
// Three branches: explicit targetCrystalColors, derived from a crystal-bearing
// target, and the ['u'] fallback when nothing supplies a crystal color.

const crystalInput = sameCircle;
check('enumerateUnaryColors: explicit targetCrystalColors wins over target',
    enumerateUnaryColors('Crystal Generator', crystalInput, {
        target: shape('crcr----'),
        targetCrystalColors: ['g'],
    }),
    ['g']);
check('enumerateUnaryColors: crystal colors derived from target',
    enumerateUnaryColors('Crystal Generator', crystalInput, {
        target: shape('crcr----'),
    }),
    ['r']);
check('enumerateUnaryColors: no target and no reference crystals → [u]',
    enumerateUnaryColors('Crystal Generator', crystalInput, {
        target: null,
        referenceCodes: [],
        getShape: (code) => shape(code),
    }),
    ['u']);
check('enumerateUnaryColors: referenceCodes union when no target',
    enumerateUnaryColors('Crystal Generator', crystalInput, {
        target: null,
        referenceCodes: ['crcr----', 'cg------'],
        getShape: (code) => shape(code),
    }),
    ['r', 'g']);
check('enumerateUnaryColors: referenceCodes with no crystals still → [u]',
    enumerateUnaryColors('Crystal Generator', crystalInput, {
        target: null,
        referenceCodes: ['CuCuCuCu'],
        getShape: (code) => shape(code),
    }),
    ['u']);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
