import {
    Shape,
    ShapePart,
    NOTHING_CHAR,
    PIN_CHAR,
    CRYSTAL_CHAR,
    UNPAINTABLE_SHAPES
} from './shapeClass.js';
import { rotate90CW } from './shapeOperations.js';

export function _extractLayers(shape, mode = 'part', includePins = true, includeColor = true) {
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
            entries.forEach(({ index, shape, color }) => {
                newLayer[index] = new ShapePart(shape, includeColor ? color : 'u');
            });
            groupedLayers.push(newLayer);
        });
    });

    return groupedLayers.map(layer => layer.map(part => part.shape + part.color).join(''));
}

export function _getPaintColors(inputShape, targetShape) {
    const targetColorMap = new Map();
    for (const layer of targetShape.layers) {
        for (const part of layer) {
            if (!UNPAINTABLE_SHAPES.includes(part.shape) && part.color !== "u") {
                if (!targetColorMap.has(part.shape)) {
                    targetColorMap.set(part.shape, new Set());
                }
                targetColorMap.get(part.shape).add(part.color);
            }
        }
    }

    const validColors = new Set();
    const topLayer = inputShape.layers[inputShape.layers.length - 1];
    if (topLayer) {
        for (const part of topLayer) {
            if (!UNPAINTABLE_SHAPES.includes(part.shape)) {
                const targetColors = targetColorMap.get(part.shape);
                if (targetColors) {
                    targetColors.forEach(color => {
                        if (color !== part.color) {
                            validColors.add(color);
                        }
                    });
                }
            }
        }
    }

    return Array.from(validColors);
}

export function _getCrystalColors(shape) {
    const crystalColors = new Set();
    for (const layer of shape.layers) {
        for (const part of layer) {
            if (part.shape === CRYSTAL_CHAR) crystalColors.add(part.color);
        }
    }
    return crystalColors.size > 0 ? Array.from(crystalColors) : ["u"];
}

export function _getSimilarity(shape1, shape2, weights = {type: 0.5, color: 0.3, order: 0.2}) {
    // Part type similarity
    const typeSim = _compareCounts(_getPartTypeCounts(shape1), _getPartTypeCounts(shape2));

    // Part+color similarity
    const colorSim = _compareCounts(_getPartCounts(shape1), _getPartCounts(shape2));

    // Overall similarity
    const orderSim = _comparePartOrder(shape1, shape2);

    // Final score
    return (typeSim * weights.type) +
           (colorSim * weights.color) +
           (orderSim * weights.order);
}

export function _getPartTypeCounts(shape) {
    const counts = new Map();
    for (const layer of shape.layers) {
        for (const part of layer) {
            counts.set(part.shape, (counts.get(part.shape) || 0) + 1);
        }
    }
    return counts;
}

export function _getPartCounts(shape) {
    const counts = new Map();
    for (const layer of shape.layers) {
        for (const part of layer) {
            const key = `${part.shape}:${part.color}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return counts;
}

export function _compareCounts(countsA, countsB) {
    const keys = new Set([...countsA.keys(), ...countsB.keys()]);
    let total = 0;
    let match = 0;

    for (const key of keys) {
        const a = countsA.get(key) || 0;
        const b = countsB.get(key) || 0;
        match += Math.min(a, b);
        total += Math.max(a, b);
    }

    return total === 0 ? 1 : match / total; // Handles case where both shapes are empty
}

export function _comparePartOrder(shape1, shape2) {
    if (shape1.layers.length !== shape2.layers.length) return 0; // Different structure

    const rotations = [];
    let current = shape1;

    // Generate all rotations
    for (let i = 0; i < shape1.numParts; i++) {
        rotations.push(current);
        current = rotate90CW(current)[0];
    }

    let bestMatchRatio = 0;

    for (const rotatedShape of rotations) {
        let totalParts = 0;
        let correctParts = 0;

        for (let layerIndex = 0; layerIndex < shape2.layers.length; layerIndex++) {
            const layerA = rotatedShape.layers[layerIndex];
            const layerB = shape2.layers[layerIndex];

            const len = Math.min(layerA.length, layerB.length);
            totalParts += len;

            for (let i = 0; i < len; i++) {
                if (layerA[i].shape === layerB[i].shape) {
                    correctParts += 1;
                }
            }
        }

        if (totalParts > 0) {
            const matchRatio = correctParts / totalParts;
            if (matchRatio > bestMatchRatio) {
                bestMatchRatio = matchRatio;
            }
        }
    }

    return bestMatchRatio;
}

// Shape Filtering Functions - for Solver Optimization
export function _getRequiredColors(targetShape) {
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

export function _getRequiredShapes(targetShape) {
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

export function _filterStartingShapes(startingShapeCodes, targetShapeCode) {
    const target = Shape.fromShapeCode(targetShapeCode);
    const requiredColors = _getRequiredColors(target);
    const requiredShapes = _getRequiredShapes(target);

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
