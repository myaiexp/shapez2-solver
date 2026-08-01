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
import { leftHalfSize, rightHalfSize } from './shapeHalfGeometry.js';

// Shape Operations
// Half-split sizes and left/right naming come from shapeHalfGeometry.js (cut
// returns [left, right] = trailing / leading). Do not re-derive Math.floor(n/2)
// elsewhere — that silently disagrees for odd part counts.

const emptyLayer = numParts => Array(numParts).fill(new ShapePart(NOTHING_CHAR, NOTHING_CHAR));

export function cut(shape, config = new ShapeOperationConfig()) {
    const leftSize = leftHalfSize(shape.numParts);
    const rightSize = rightHalfSize(shape.numParts);

    // The blade travels a full diameter, so it crosses the ring at TWO places: the
    // wrap-around seam (last quadrant of the left half -> quadrant 0) and the mid
    // seam (last quadrant of the right half -> first of the left half). A crystal
    // fused across either seam shatters. Each pair is [oneSide, otherSide]; only
    // the pairing matters, since breakCrystals shatters the whole connected group.
    const wrapSeam = [0, shape.numParts - 1];
    const midSeam = [rightSize, rightSize - 1];
    const layers = cloneLayers(shape.layers);

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (const [seamStart, seamEnd] of [wrapSeam, midSeam]) {
            if (crystalsFused(layers[layerIndex][seamStart], layers[layerIndex][seamEnd])) {
                breakCrystals(layers, layerIndex, seamStart);
            }
        }
    }

    const leftLayers = [];
    const rightLayers = [];
    for (const layer of layers) {
        // Left half: trailing quadrants survive, leading ones are emptied.
        leftLayers.push([
            ...emptyLayer(rightSize),
            ...layer.slice(-leftSize)
        ]);
        // Right half: leading quadrants survive, trailing ones are emptied.
        rightLayers.push([
            ...layer.slice(0, -leftSize),
            ...emptyLayer(leftSize)
        ]);
    }

    // Each half settles under gravity on its own, so they can end up with
    // different layer counts.
    const leftHalf = cleanUpEmptyUpperLayers(makeLayersFall(leftLayers));
    const rightHalf = cleanUpEmptyUpperLayers(makeLayersFall(rightLayers));

    return [new Shape(leftHalf), new Shape(rightHalf)];
}

export function halfCut(shape, config = new ShapeOperationConfig()) {
    // The Half Destroyer keeps the right half (leading quadrants) and destroys the left.
    const [, rightHalf] = cut(shape, config);
    return [rightHalf];
}

export const swapHalves = requireSameNumParts(function(shapeA, shapeB, config = new ShapeOperationConfig()) {
    const numLayers = Math.max(shapeA.numLayers, shapeB.numLayers);
    const leftSize = leftHalfSize(shapeA.numParts);
    const [leftA, rightA] = cut(shapeA, config);
    const [leftB, rightB] = cut(shapeB, config);

    // A cut half can be shorter than its sibling (each settles separately), so a
    // layer missing from one half reads as empty.
    const layerOrEmpty = (half, layerIndex, numParts) => half.layers[layerIndex] || emptyLayer(numParts);

    const swappedA = [];
    const swappedB = [];

    for (let i = 0; i < numLayers; i++) {
        const leftLayerA = layerOrEmpty(leftA, i, shapeA.numParts);
        const rightLayerA = layerOrEmpty(rightA, i, shapeA.numParts);
        const leftLayerB = layerOrEmpty(leftB, i, shapeB.numParts);
        const rightLayerB = layerOrEmpty(rightB, i, shapeB.numParts);

        // The Swapper exchanges left halves: each output keeps its own right half
        // (leading quadrants) and receives the other shape's left half (trailing).
        // The slices pick the populated side out of each half, whose other side is
        // already emptied by cut().
        swappedA.push([
            ...rightLayerA.slice(0, -leftSize),
            ...leftLayerB.slice(-leftSize)
        ]);
        swappedB.push([
            ...rightLayerB.slice(0, -leftSize),
            ...leftLayerA.slice(-leftSize)
        ]);
    }

    const processedA = cleanUpEmptyUpperLayers(swappedA);
    const processedB = cleanUpEmptyUpperLayers(swappedB);

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
