import {
    Shape, ShapePart, NOTHING_CHAR,
    isPaintedPart, layersToCode,
} from './shapeClass.js';
import { rotate90CW, rotate90CCW, rotate180 } from './shapeRotation.js';
import {
    isLeftHalfEmpty, isRightHalfEmpty, leftHalfSize, rightHalfSize,
} from './shapeHalfGeometry.js';
import { cut } from './shapeOperations.js';

/**
 * Unpaint: set all paintable parts on the top layer to uncolored.
 * Returns a 0-or-1 array — empty when the top layer has no painted parts,
 * otherwise the single fully-unpainted predecessor (lower layers untouched).
 * Painter is many-to-one (any color → uncolored), so there is no per-color
 * original to recover; one unpainted code is the whole predecessor set.
 */
export function inverseUnpaint(shape, config) {
    const results = [];
    const topLayer = shape.layers[shape.layers.length - 1];
    if (!topLayer.some(isPaintedPart)) return results;

    const newLayers = shape.layers.map((layer, li) => {
        if (li === shape.layers.length - 1) {
            return layer.map(p => (isPaintedPart(p) ? new ShapePart(p.shape, 'u') : p));
        }
        return layer;
    });
    const unpainted = new Shape(newLayers);
    const code = unpainted.toShapeCode();
    if (code) results.push(code);
    return results;
}

/**
 * Unrotate CW: apply CCW rotation to get predecessor.
 */
export function inverseRotateCW(shape, config) {
    const results = rotate90CCW(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Unrotate CCW: apply CW rotation to get predecessor.
 */
export function inverseRotateCCW(shape, config) {
    const results = rotate90CW(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Unrotate 180: apply 180 rotation (self-inverse).
 */
export function inverseRotate180(shape, config) {
    const results = rotate180(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Uncut (Cutter inverse for Bidirectional): the shape is treated as one geometric
 * half of a cut result, and the predecessors are whole shapes that cut back to it.
 *
 * Geometry from shapeHalfGeometry (same as cut()): leading = RIGHT half, trailing
 * = LEFT half; cut returns [left, right].
 *
 * The true predecessor set is every possible content of the empty half, so this
 * emits a bounded, plausible subset: the 180° mirror of the occupied half (when
 * both halves have the same size) and the empty half filled uniformly with each
 * distinct part the half contains. Those are the wholes a factory usually starts
 * from (CuCu---- ← CuCuCuCu). The half itself is never emitted — it is already the
 * node being expanded, so the backward map would discard it.
 *
 * Every candidate is kept only if cut() really returns the half, so gravity and
 * crystal shatter cannot sneak in a false predecessor. Shapes that are not a pure
 * half on every layer (both sides occupied, or fully empty) return [].
 */
export function inverseUncut(shape, config) {
    const isRightHalf = shape.layers.every(isLeftHalfEmpty);
    const isLeftHalf = shape.layers.every(isRightHalfEmpty);
    if (isRightHalf === isLeftHalf) return [];

    const n = shape.numParts;
    const rightSize = rightHalfSize(n);
    const leftSize = leftHalfSize(n);
    const halfCode = shape.toShapeCode();
    // Index ranges of the occupied and empty halves (right = [0, rightSize)).
    const [occStart, occSize] = isRightHalf ? [0, rightSize] : [rightSize, leftSize];
    const [emptyStart, emptySize] = isRightHalf ? [rightSize, leftSize] : [0, rightSize];

    const fills = [];
    if (occSize === emptySize) {
        fills.push((layer, i) => layer[occStart + i]);
    }
    const distinctParts = new Map();
    for (const layer of shape.layers) {
        for (let i = 0; i < occSize; i++) {
            const part = layer[occStart + i];
            if (part.shape !== NOTHING_CHAR) distinctParts.set(part.shape + part.color, part);
        }
    }
    for (const part of distinctParts.values()) fills.push(() => part);

    const results = [];
    for (const fill of fills) {
        const layers = shape.layers.map(layer => {
            const out = layer.slice();
            for (let i = 0; i < emptySize; i++) out[emptyStart + i] = fill(layer, i);
            return out;
        });
        const code = layersToCode(layers);
        if (code === halfCode || results.includes(code)) continue;
        const [left, right] = cut(new Shape(layers), config);
        if ((isRightHalf ? right : left).toShapeCode() === halfCode) results.push(code);
    }
    return results;
}

/**
 * Unpin: remove bottom pin layer if present.
 */
export function inverseUnpin(shape, config) {
    const results = [];
    if (shape.numLayers < 2) return results;

    const bottomLayer = shape.layers[0];
    const allPins = bottomLayer.every(p => p.shape === 'P' || p.shape === NOTHING_CHAR);
    const hasPins = bottomLayer.some(p => p.shape === 'P');
    if (allPins && hasPins) {
        const remainingLayers = shape.layers.slice(1);
        results.push(layersToCode(remainingLayers));
    }
    return results;
}
