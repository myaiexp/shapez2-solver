// Legacy shape-similarity metric — TEST-ONLY, no production importers.
//
// This was the solver's pre-#1677 A* heuristic. A* now scores states with
// _matchAndCoverage in shapeSolverCore.js (clean sub-shape coverage per target
// slot), which the old whole-shape similarity ratio could not express. The
// stack lives here rather than alongside the app because nothing but the test
// suite calls it: smoke.js pins getSimilarity as a pure-op snapshot, and the
// rotation tests use comparePartOrder as a rotation-agnostic comparator.
//
// Do NOT import this from app code — reintroducing it as a heuristic would
// resurrect the assembly plateau described in shapeSolverCore.js.
import { ShapeOperationConfig } from '../../shapeClass.js';
import { rotate90CW } from '../../shapeRotation.js';

// rotate90CW ignores its config argument, so share one instance instead of
// allocating a fresh ShapeOperationConfig per rotation in the hot similarity
// path (comparePartOrder rotates numParts times per call, via getSimilarity).
const DEFAULT_CONFIG = new ShapeOperationConfig();

export function getSimilarity(shape1, shape2, weights = {type: 0.5, color: 0.3, order: 0.2}) {
    const typeSim = compareCounts(getPartTypeCounts(shape1), getPartTypeCounts(shape2));
    const colorSim = compareCounts(getPartCounts(shape1), getPartCounts(shape2));
    const orderSim = comparePartOrder(shape1, shape2);

    return (typeSim * weights.type) +
           (colorSim * weights.color) +
           (orderSim * weights.order);
}

export function getPartTypeCounts(shape) {
    const counts = new Map();
    for (const layer of shape.layers) {
        for (const part of layer) {
            counts.set(part.shape, (counts.get(part.shape) || 0) + 1);
        }
    }
    return counts;
}

export function getPartCounts(shape) {
    const counts = new Map();
    for (const layer of shape.layers) {
        for (const part of layer) {
            const key = `${part.shape}:${part.color}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return counts;
}

export function compareCounts(countsA, countsB) {
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

export function comparePartOrder(shape1, shape2) {
    if (shape1.layers.length !== shape2.layers.length) return 0; // Different structure

    const rotations = [];
    let current = shape1;

    // Generate all rotations
    for (let i = 0; i < shape1.numParts; i++) {
        rotations.push(current);
        current = rotate90CW(current, DEFAULT_CONFIG)[0];
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
