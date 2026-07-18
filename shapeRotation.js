// JS port of rotation operations from Loupau38's Shapez 2 Library https://pypi.org/project/shapez2/

import { Shape, ShapeOperationConfig } from './shapeClass.js';

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

// The set of distinct shape codes reachable by rotating `shape` through every
// 90° CW step. A solver/expansion concern (rotation-symmetry pruning and the
// acceptable-rotation goal set), lives here next to the rotators it drives.
export function getAllRotations(shape, config) {
    const rotations = new Set();
    let current = shape;

    for (let i = 0; i < current.numParts; i++) {
        rotations.add(current.toShapeCode());
        current = rotate90CW(current, config)[0];
    }

    return rotations;
}
