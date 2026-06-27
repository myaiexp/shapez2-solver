// Unit tests for getConnectedSingleLayer wrap-around — run with:
//   node tests/connectedSingleLayer.test.js
// Covers the FORWARD wrap-around path: the forward walk overruns the end of the
// layer and getCorrectedIndex folds the index back to the start (e.g. quadrant
// 3 -> quadrant 0). The crystal suite only exercises the backward wrap, so this
// guards the positive-overflow branch of getCorrectedIndex. A contrasting
// non-wrapping case (empty cell at the seam) proves the grouping isn't
// unconditional and that the seam is a real boundary.
import { Shape } from '../shapeClass.js';
import { gravityConnected, getConnectedSingleLayer } from '../shapeOperationsTestUtils.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        failed = true;
    }
}

// Shape codes use Shapez 2 notation: each part is two chars (shape+color),
// four parts per layer. '-' = empty; under gravityConnected any two non-empty,
// non-pin parts are connected, so empties act as component boundaries.
const layerOf = code => Shape.fromShapeCode(code).layers[0];

// --- forward wrap-around -------------------------------------------------
// Layer [Cu, Cu, --, Cu] starting at index 3. The forward walk runs off the
// end (i = 4) and wraps to index 0, then continues to index 1; index 2 is
// empty so the walk stops there. Connectivity crosses the 3->0 seam.
check('forward wrap: quadrant 3 connects across the seam to 0 and 1',
    getConnectedSingleLayer(layerOf('CuCu--Cu'), 3, gravityConnected),
    [3, 0, 1]);

// --- contrasting non-wrapping case ---------------------------------------
// Same kind of layer but the empty sits AT the seam: [--, Cu, Cu, Cu] from
// index 1. The forward walk reaches the seam (index 0) but it's empty, so the
// component stops at index 3 and does NOT wrap around to anything. This proves
// the wrap above is a genuine seam crossing, not the function always linking
// every solid part.
check('no wrap: empty cell at the seam keeps the component contiguous',
    getConnectedSingleLayer(layerOf('--CuCuCu'), 1, gravityConnected),
    [1, 2, 3]);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
