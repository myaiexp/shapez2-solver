// Unit tests for makeLayersFall gravity/support physics — run with: node tests/shape/shapeGravity.test.js
import { Shape } from '../../shapeClass.js';
import { makeLayersFall } from '../../shapeOperationsTestUtils.js';

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

// makeLayersFall mutates a raw layers array in place; round-trip through shape
// codes so assertions read as Shapez 2 notation. First segment = bottom layer
// (index 0 = floor); '-'=empty, 'c'=crystal, uppercase letters = solid shapes.
const fall = code => {
    const layers = Shape.fromShapeCode(code).layers;
    makeLayersFall(layers);
    return new Shape(layers).toShapeCode();
};

// --- Fall geometry -------------------------------------------------------

// An unsupported part free-falls to the floor (layer 0). makeLayersFall does
// NOT trim emptied upper layers (that's cleanUpEmptyUpperLayers), so the
// vacated top layer remains as '--'.
check('unsupported part falls to the floor',
    fall('--:Cu'), 'Cu:--');

// A part falls only until it lands on the first occupied cell beneath it — it
// does not pass through the part sitting on the floor.
check('falling part stops on top of an occupied cell',
    fall('Cu:--:Cu'), 'Cu:Cu:--');

// --- Crystals shatter instead of falling ---------------------------------

// An unsupported crystal shatters (becomes empty) rather than falling — this is
// the crystal-break branch, distinct from the solid-shape fall above.
check('unsupported crystal shatters instead of falling',
    fall('--:cu'), '--:--');

// A vertically fused crystal pair with nothing anchoring it is one rigid body
// with no support — the whole body shatters, not just the bottom crystal.
check('floating fused-crystal stack shatters entirely',
    fall('--:cu:cu'), '--:--:--');

// --- Support keeps crystals from shattering ------------------------------
// (Crystal survival is the only output-visible probe of per-part support:
//  for solid shapes, "supported" and "physically blocked from falling"
//  coincide, so support is observable only through which crystals break.)

// Below-support: a crystal resting directly on a floor-supported shape stays.
check('crystal supported by the part directly below stays',
    fall('Cu:cu'), 'Cu:cu');

// Neighbour-support: a crystal with empty space below and an empty cell on its
// outer side stays because its inner same-layer gravity-connected neighbour
// (index 0) is column-supported. Support reaches it only via the lower-index
// (prev) lateral branch.
check('crystal supported by a gravity-connected neighbour stays',
    fall('Cu----:Cucu--'), 'Cu----:Cucu--');

// Crystal-fused suspension: a crystal hangs with nothing below it and both
// horizontal neighbours empty, held only by a fused crystal in the layer above
// (which is in turn anchored sideways to a supported column at index 2).
check('crystal suspended by a fused crystal above stays',
    fall('----Cu--:cu--Cu--:cuCuCu--'), '----Cu--:cu--Cu--:cuCuCu--');

// --- Two-pass crystal path: break, re-evaluate, then fall ----------------

// A floating crystal shatters; the solid shape that was resting on it loses its
// only support and then falls to the floor. Exercises the break -> recompute ->
// fall cascade in one shape.
check('shape falls after its supporting crystal shatters',
    fall('--:cu:Cu'), 'Cu:--:--');

// --- Support is order-independent (#1630) --------------------------------
// A crystal chain anchored at a high index reaches the floor only by walking
// the lower-index (prev) lateral branch: index3 (column-supported) -> index0
// (via wrap-around) -> index1. The old path-blocked DFS visited index0 before
// index1 and memoized index1's blocked route as a context-free "unsupported",
// wrongly shattering it. Its index-rotated mirror, where support flows in the
// outer-loop (next) direction, was always handled correctly — so the pair
// together pins the fix: both must stay intact regardless of traversal order.
check('prev-direction crystal chain stays supported (regression #1630)',
    fall('------Cu:cucu--cu'), '------Cu:cucu--cu');
check('next-direction crystal chain stays supported (mirror)',
    fall('----Cu--:cucucu--'), '----Cu--:cucucu--');

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
