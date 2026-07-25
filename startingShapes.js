// UI-side helpers for building the solver's Starting Shapes list: extractLayers
// seeds it from a shape (the "Extract Shapes" modal), filterStartingShapes
// prunes it against the target before a solve. Both are pre-solve prep — the
// solver itself only ever sees the resulting list of shape codes.
import {
    Shape,
    ShapePart,
    NOTHING_CHAR,
    CRYSTAL_CHAR,
    PIN_CHAR,
    UNPAINTABLE_SHAPES,
    layerToCode
} from './shapeClass.js';

export function getRequiredColors(targetShape) {
    const colors = new Set();

    for (const layer of targetShape.layers) {
        for (const part of layer) {
            // Skip unpaintable shapes
            if (UNPAINTABLE_SHAPES.includes(part.shape)) continue;

            // Add non-uncolored parts
            if (part.color !== 'u') {
                colors.add(part.color);
            }
        }
    }

    return colors;
}

export function getRequiredShapes(targetShape) {
    const shapes = new Set();

    for (const layer of targetShape.layers) {
        for (const part of layer) {
            // Skip nothing and crystal shapes (they're generated, not base shapes)
            if (part.shape !== NOTHING_CHAR && part.shape !== CRYSTAL_CHAR) {
                shapes.add(part.shape);
            }
        }
    }

    return shapes;
}

export function filterStartingShapes(startingShapeCodes, targetShapeCode) {
    const target = Shape.fromShapeCode(targetShapeCode);
    const requiredColors = getRequiredColors(target);
    const requiredShapes = getRequiredShapes(target);

    // If target has no specific colors or shapes, keep all starting shapes
    if (requiredColors.size === 0 && requiredShapes.size === 0) {
        return startingShapeCodes;
    }

    return startingShapeCodes.filter(shapeCode => {
        const shape = Shape.fromShapeCode(shapeCode);

        for (const layer of shape.layers) {
            for (const part of layer) {
                // Check if this part's shape is required
                if (requiredShapes.has(part.shape)) {
                    return true;
                }

                // Check if this part's color is required (and shape is paintable)
                if (!UNPAINTABLE_SHAPES.includes(part.shape) &&
                    requiredColors.has(part.color)) {
                    return true;
                }
            }
        }

        return false;
    });
}

// Decompose a shape into one sub-shape-code per distinct key (mode): each
// grouped layer keeps its parts at their original index. Nothing and Crystal
// parts are always dropped; Pins drop only when includePins is false. Used by
// the UI's "Extract Shapes" modal to seed the starting-shapes list.
export function extractLayers(shape, mode = 'part', includePins = true, includeColor = true) {
    const numParts = shape.numParts;
    const groupedLayers = [];

    shape.layers.forEach((layer) => {
        const seen = {};

        layer.forEach((part, partIndex) => {
            if (!includePins && (part.shape === PIN_CHAR)) return;
            if (part.shape === NOTHING_CHAR || part.shape === CRYSTAL_CHAR) return;

            let key;
            if (mode === 'layer') {
                key = "valid";
            } else if (mode === 'part') {
                key = part.shape;
            } else if (mode === 'color') {
                key = part.color;
            } else if (mode === 'part-color') {
                key = `${part.shape}-${part.color}`;
            }

            if (!seen[key]) {
                seen[key] = [];
            }
            seen[key].push({ index: partIndex, shape: part.shape, color: part.color });
        });

        Object.entries(seen).forEach(([, entries]) => {
            const newLayer = Array.from({ length: numParts }, () => new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
            entries.forEach(({ index, shape: partType, color }) => {
                newLayer[index] = new ShapePart(partType, includeColor ? color : 'u');
            });
            groupedLayers.push(newLayer);
        });
    });

    return groupedLayers.map(layerToCode);
}
