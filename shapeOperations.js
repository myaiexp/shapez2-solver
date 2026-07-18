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
    crystalsFused,
    breakCrystals,
    cloneLayers,
    makeLayersFall,
    cleanUpEmptyUpperLayers,
    requireSameNumParts
} from './shapeLayerMechanics.js';

// Shape Operations
export function cut(shape, config = new ShapeOperationConfig()) {
    const takeParts = Math.ceil(shape.numParts / 2);
    const cutPoints = [[0, shape.numParts - 1], [shape.numParts - takeParts, shape.numParts - takeParts - 1]];
    const layers = cloneLayers(shape.layers);

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (const [start, end] of cutPoints) {
            if (crystalsFused(layers[layerIndex][start], layers[layerIndex][end])) {
                breakCrystals(layers, layerIndex, start);
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
        cleanUpEmptyUpperLayers(makeLayersFall(shapeA)),
        cleanUpEmptyUpperLayers(makeLayersFall(shapeB))
    ];

    return [new Shape(processedA), new Shape(processedB)];
}

export function halfCut(shape, config = new ShapeOperationConfig()) {
    return [cut(shape, config)[1]];
}

export const swapHalves = requireSameNumParts(function(shapeA, shapeB, config = new ShapeOperationConfig()) {
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

    const processedA = cleanUpEmptyUpperLayers(returnShapeA);
    const processedB = cleanUpEmptyUpperLayers(returnShapeB);

    return [new Shape(processedA), new Shape(processedB)];
});

export const stack = requireSameNumParts(function(bottomShape, topShape, config = new ShapeOperationConfig()) {
    // Deep-copy input layers: makeLayersFall mutates its `layers` argument in place,
    // so passing the shared layer arrays from bottomShape/topShape would corrupt those
    // (cached) shapes. cut() and pushPin() copy for the same reason.
    const newLayers = [
        ...cloneLayers(bottomShape.layers),
        Array.from({ length: bottomShape.numParts }, () => new ShapePart(NOTHING_CHAR, NOTHING_CHAR)),
        ...cloneLayers(topShape.layers)
    ];
    const processed = cleanUpEmptyUpperLayers(makeLayersFall(newLayers));
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
    const layers = cloneLayers(shape.layers);
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
            if (crystalsFused(part, removedLayer[partIndex])) {
                breakCrystals(newLayers, newLayers.length - 1, partIndex);
            }
        }
    }

    const processed = cleanUpEmptyUpperLayers(makeLayersFall(newLayers));
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
