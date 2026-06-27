// Unit tests for crystal mechanics — run with: node tests/shape/shapeCrystals.test.js
// Covers genCrystal (color assignment), pushPin (with/without maxLayers
// overflow), breakCrystals via a cut on a fused-crystal ring, and the
// connected-component traversal helpers (getConnectedSingleLayer wrap-around,
// getConnectedMultiLayer up/down layer linking) with the crystalsFused predicate.
import { Shape, ShapePart, ShapeOperationConfig } from '../../shapeClass.js';
import { cut, pushPin, genCrystal } from '../../shapeOperations.js';
import {
    crystalsFused,
    getConnectedSingleLayer,
    getConnectedMultiLayer
} from '../../shapeOperationsTestUtils.js';

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

// Shape codes use Shapez 2 notation: each part is two chars (shape+color),
// four parts per layer, ':' separates layers (first segment = bottom/floor).
// 'c'=crystal, 'P'=pin, '-'=empty, uppercase letters = solid shapes.
const codes = shapes => shapes.map(s => s.toShapeCode());
const layerOf = code => Shape.fromShapeCode(code).layers[0];
const layersOf = code => Shape.fromShapeCode(code).layers;
const part = (shape, color) => new ShapePart(shape, color);

// --- crystalsFused predicate --------------------------------------------
// Fusion holds only when BOTH parts are crystals; colors are irrelevant.
check('crystalsFused: two crystals fuse regardless of colour',
    crystalsFused(part('c', 'r'), part('c', 'b')), true);
check('crystalsFused: crystal + solid shape do not fuse',
    crystalsFused(part('c', 'r'), part('C', 'u')), false);
check('crystalsFused: crystal + empty do not fuse',
    crystalsFused(part('c', 'r'), part('-', '-')), false);

// --- genCrystal ----------------------------------------------------------
// Pins and empty cells become crystals of the requested colour; existing
// solid shapes are left untouched (NOT recoloured). Here colour 'g':
//   Cu (solid)  -> Cu        P- (pin)   -> cg
//   -- (empty)  -> cg        Sr (solid) -> Sr
check('genCrystal: fills pins and empties with coloured crystals, keeps solids',
    codes(genCrystal(Shape.fromShapeCode('CuP---Sr'), 'g')), ['CucgcgSr']);

// An already-present crystal keeps its own colour — genCrystal's colour only
// applies to newly-generated crystals, never recolours existing ones.
check('genCrystal: existing crystal keeps its colour, empties take the new one',
    codes(genCrystal(Shape.fromShapeCode('cb------'), 'r')), ['cbcrcrcr']);

// --- pushPin -------------------------------------------------------------
// Below max layers: a new pin layer is prepended, with a pin under every
// occupied column and nothing under empty columns. Nothing falls (pins
// support the parts above them).
check('pushPin: prepends pins under occupied columns only (no overflow)',
    codes(pushPin(Shape.fromShapeCode('Cu--Cu--'), new ShapeOperationConfig(4))),
    ['P---P---:Cu--Cu--']);

// At max layers: prepending a pin layer overflows, so the top layer is
// dropped. Two solid layers, max 2 -> the upper 'Ru--' is discarded.
check('pushPin: drops the top layer on overflow',
    codes(pushPin(Shape.fromShapeCode('Cu--:Ru--'), new ShapeOperationConfig(2))),
    ['P---:Cu--']);

// Overflow where the dropped layer was fused (crystal) to the new top layer:
// severing that fusion shatters the connected crystal. The lone crystal
// column breaks and the emptied upper layer is trimmed, leaving just the pin.
check('pushPin: shatters crystals fused across the dropped overflow layer',
    codes(pushPin(Shape.fromShapeCode('cr--:cr--'), new ShapeOperationConfig(2))),
    ['P---']);

// --- breakCrystals via cut ----------------------------------------------
// A full ring of fused crystals is fused across BOTH cut seams. Cutting
// triggers breakCrystals, whose connected-component walk shatters the entire
// fused ring, so both halves come out empty.
check('cut: shatters a fully-fused crystal ring on both halves',
    codes(cut(Shape.fromShapeCode('crcrcrcr'))), ['--------', '--------']);

// --- getConnectedSingleLayer (with crystalsFused) ----------------------
// A fully-fused ring links every index in one component.
check('singleLayer: full fused ring links all four parts',
    getConnectedSingleLayer(layerOf('crcrcrcr'), 0, crystalsFused),
    [0, 1, 2, 3]);

// Circular wrap-around: from index 0, forward stops at the empty index 2,
// but the backward walk wraps past the seam to reach the fused index 3.
// [cr, cr, --, cr] starting at 0 -> {0, 1, 3} (3 found via wrap-around).
check('singleLayer: wraps around the seam to reach a fused part',
    getConnectedSingleLayer(layerOf('crcr--cr'), 0, crystalsFused),
    [0, 1, 3]);

// Starting on an empty cell short-circuits to the empty component.
check('singleLayer: empty start index yields no component',
    getConnectedSingleLayer(layerOf('--crcrcr'), 0, crystalsFused),
    []);

// --- getConnectedMultiLayer (with crystalsFused) -----------------------
// Vertical fusion across three layers, walked from the MIDDLE layer: the
// component must extend both DOWN (to layer 0) and UP (to layer 2).
check('multiLayer: links both up and down from a middle layer',
    getConnectedMultiLayer(layersOf('cr:cr:cr'), 1, 0, crystalsFused),
    [[1, 0], [0, 0], [2, 0]]);

// Combined topology: a bottom-layer ring that wraps the seam (0 <-> 3) plus a
// vertical link up to the layer above at column 0.
//   layer0: cr -- -- cr   (0 and 3 fused across the seam)
//   layer1: cr -- -- --   (fused above column 0)
check('multiLayer: combines seam wrap-around with an upward layer link',
    getConnectedMultiLayer(layersOf('cr----cr:cr------'), 0, 0, crystalsFused),
    [[0, 0], [0, 3], [1, 0]]);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
