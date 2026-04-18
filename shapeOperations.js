// JS port of a file in Loupau38's Shapez 2 Library https://pypi.org/project/shapez2/

import {
    Shape,
    ShapePart,
    ShapeOperationConfig,
    NOTHING_CHAR,
    UNPAINTABLE_SHAPES,
    REPLACED_BY_CRYSTAL,
    PIN_CHAR,
    CRYSTAL_CHAR
} from './shapeClass.js';
import {
    _crystalsFused,
    _breakCrystals,
    _makeLayersFall,
    _cleanUpEmptyUpperLayers,
    _differentNumPartsUnsupported
} from './shapeOperationsHelpers.js';

// Re-exports for backward compatibility
export {
    NOTHING_CHAR,
    SHAPE_LAYER_SEPARATOR,
    PIN_CHAR,
    CRYSTAL_CHAR,
    UNPAINTABLE_SHAPES,
    REPLACED_BY_CRYSTAL,
    ShapePart,
    Shape,
    InvalidOperationInputs,
    ShapeOperationConfig
} from './shapeClass.js';

export {
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
    _filterStartingShapes
} from './shapeAnalysis.js';

// Shape Operations
export function cut(shape, config = new ShapeOperationConfig()) {
    const takeParts = Math.ceil(shape.numParts / 2);
    const cutPoints = [[0, shape.numParts - 1], [shape.numParts - takeParts, shape.numParts - takeParts - 1]];
    const layers = JSON.parse(JSON.stringify(shape.layers)); // Deep copy

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (const [start, end] of cutPoints) {
            if (_crystalsFused(layers[layerIndex][start], layers[layerIndex][end])) {
                _breakCrystals(layers, layerIndex, start);
            }
        }
    }

    const shapeA = [];
    const shapeB = [];
    for (const layer of layers) {
        shapeA.push([
            ...Array(shape.numParts - takeParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR)),
            ...layer.slice(-takeParts)
        ]);
        shapeB.push([
            ...layer.slice(0, -takeParts),
            ...Array(takeParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR))
        ]);
    }

    const [processedA, processedB] = [
        _cleanUpEmptyUpperLayers(_makeLayersFall(shapeA)),
        _cleanUpEmptyUpperLayers(_makeLayersFall(shapeB))
    ];

    return [new Shape(processedA), new Shape(processedB)];
}

export function halfCut(shape, config = new ShapeOperationConfig()) {
    return [cut(shape, config)[1]];
}

export function rotate90CW(shape, config = new ShapeOperationConfig()) {
    const newLayers = [];
    for (const layer of shape.layers) {
        newLayers.push([layer[layer.length - 1], ...layer.slice(0, -1)]);
    }
    return [new Shape(newLayers)];
}

export function rotate90CCW(shape, config = new ShapeOperationConfig()) {
    const newLayers = [];
    for (const layer of shape.layers) {
        newLayers.push([...layer.slice(1), layer[0]]);
    }
    return [new Shape(newLayers)];
}

export function rotate180(shape, config = new ShapeOperationConfig()) {
    const takeParts = Math.ceil(shape.numParts / 2);
    const newLayers = [];
    for (const layer of shape.layers) {
        newLayers.push([...layer.slice(takeParts), ...layer.slice(0, takeParts)]);
    }
    return [new Shape(newLayers)];
}

export const swapHalves = _differentNumPartsUnsupported(function(shapeA, shapeB, config = new ShapeOperationConfig()) {
    const numLayers = Math.max(shapeA.numLayers, shapeB.numLayers);
    const takeParts = Math.ceil(shapeA.numParts / 2);
    const [shapeACut1, shapeACut2] = cut(shapeA, config);
    const [shapeBCut1, shapeBCut2] = cut(shapeB, config);

    const returnShapeA = [];
    const returnShapeB = [];

    for (let i = 0; i < numLayers; i++) {
        const layerA1 = shapeACut1.layers[i] || Array(shapeA.numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        const layerA2 = shapeACut2.layers[i] || Array(shapeA.numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        const layerB1 = shapeBCut1.layers[i] || Array(shapeB.numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        const layerB2 = shapeBCut2.layers[i] || Array(shapeB.numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));

        returnShapeA.push([
            ...layerA2.slice(0, -takeParts),
            ...layerB1.slice(-takeParts)
        ]);
        returnShapeB.push([
            ...layerB2.slice(0, -takeParts),
            ...layerA1.slice(-takeParts)
        ]);
    }

    const processedA = _cleanUpEmptyUpperLayers(returnShapeA);
    const processedB = _cleanUpEmptyUpperLayers(returnShapeB);

    return [new Shape(processedA), new Shape(processedB)];
});

export const stack = _differentNumPartsUnsupported(function(bottomShape, topShape, config = new ShapeOperationConfig()) {
    const newLayers = [
        ...bottomShape.layers,
        Array(bottomShape.numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR)),
        ...topShape.layers
    ];
    const processed = _cleanUpEmptyUpperLayers(_makeLayersFall(newLayers));
    return [new Shape(processed.slice(0, config.maxShapeLayers))];
});

export function topPaint(shape, color, config = new ShapeOperationConfig()) {
    const newLayers = shape.layers.slice(0, -1);
    const newTopLayer = shape.layers[shape.layers.length - 1].map(p =>
        new ShapePart(p.shape, UNPAINTABLE_SHAPES.includes(p.shape) ? p.color : color)
    );
    newLayers.push(newTopLayer);
    return [new Shape(newLayers)];
}

export function pushPin(shape, config = new ShapeOperationConfig()) {
    const layers = JSON.parse(JSON.stringify(shape.layers)); // Deep copy
    const addedPins = [];

    for (const part of layers[0]) {
        if (part.shape === NOTHING_CHAR) {
            addedPins.push(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        } else {
            addedPins.push(new ShapePart(PIN_CHAR, NOTHING_CHAR));
        }
    }

    let newLayers;
    if (layers.length < config.maxShapeLayers) {
        newLayers = [addedPins, ...layers];
    } else {
        newLayers = [addedPins, ...layers.slice(0, config.maxShapeLayers - 1)];
        const removedLayer = layers[config.maxShapeLayers - 1];
        for (let partIndex = 0; partIndex < newLayers[newLayers.length - 1].length; partIndex++) {
            const part = newLayers[newLayers.length - 1][partIndex];
            if (_crystalsFused(part, removedLayer[partIndex])) {
                _breakCrystals(newLayers, newLayers.length - 1, partIndex);
            }
        }
    }

    const processed = _cleanUpEmptyUpperLayers(_makeLayersFall(newLayers));
    return [new Shape(processed)];
}

export function genCrystal(shape, color, config = new ShapeOperationConfig()) {
    const newLayers = shape.layers.map(layer =>
        layer.map(p => {
            // Only replace pins and nothing with crystals
            if (REPLACED_BY_CRYSTAL.includes(p.shape)) {
                return new ShapePart(CRYSTAL_CHAR, color);
            }
            // Keep existing shapes unchanged (don't paint them)
            return new ShapePart(p.shape, p.color);
        })
    );
    return [new Shape(newLayers)];
}

export function trash(shape, config = new ShapeOperationConfig()) {
    return [];
}

export function beltSplit(shape, config = new ShapeOperationConfig()) {
    return [shape, shape];
}

// Extra functions for Shape Analysis - for Solver
export function _getAllRotations(shape, config) {
    const rotations = new Set();
    let current = shape;

    for (let i = 0; i < current.numParts; i++) {
        rotations.add(current.toShapeCode());
        current = rotate90CW(current, config)[0];
    }

    return rotations;
}
