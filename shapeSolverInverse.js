import {
    Shape, ShapePart, NOTHING_CHAR,
    UNPAINTABLE_SHAPES, layersToCode,
} from './shapeClass.js';
import { rotate90CW, rotate90CCW, rotate180 } from './shapeRotation.js';
import { isLeftHalfEmpty, isRightHalfEmpty } from './shapeHalfGeometry.js';

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
    // Check if top layer has any painted parts
    const hasPainted = topLayer.some(p =>
        !UNPAINTABLE_SHAPES.includes(p.shape) && p.color !== 'u'
    );
    if (!hasPainted) return results;

    // Generate the unpainted version
    const newLayers = shape.layers.map((layer, li) => {
        if (li === shape.layers.length - 1) {
            return layer.map(p => {
                if (!UNPAINTABLE_SHAPES.includes(p.shape) && p.color !== 'u') {
                    return new ShapePart(p.shape, 'u');
                }
                return p;
            });
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
 * Unstack: decompose a multi-layer shape into (bottom, top) pairs.
 * For each split point, yield the bottom layers and top layers as separate shapes.
 */
export function inverseUnstack(shape, config) {
    const results = [];
    if (shape.numLayers < 2) return results;

    for (let splitAt = 1; splitAt < shape.numLayers; splitAt++) {
        const bottomLayers = shape.layers.slice(0, splitAt);
        const topLayers = shape.layers.slice(splitAt);

        results.push(layersToCode(bottomLayers), layersToCode(topLayers));
    }
    return results;
}

/**
 * Uncut (Cutter inverse for Bidirectional): the shape is treated as one geometric
 * half of a cut result.
 *
 * Geometry from shapeHalfGeometry (same as cut()): leading = RIGHT half, trailing
 * = LEFT half; cut returns [left, right].
 *
 * Contract is the *identity empty-opposite* predecessor only: if exactly one
 * geometric side is empty, re-emit this half (other side already empty). Cutting
 * that whole yields the half plus empty, so Bidirectional can step through Cutter
 * without inventing content. Does NOT generate non-empty mates or mirrors — a pure
 * half is the only useful predecessor we currently contribute. Both-empty and
 * both-occupied shapes return [].
 */
export function inverseUncut(shape, config) {
    if (shape.numLayers !== 1) return [];

    const layer = shape.layers[0];
    const leftEmpty = isLeftHalfEmpty(layer);
    const rightEmpty = isRightHalfEmpty(layer);
    // Pure geometric half: exactly one side empty.
    if (leftEmpty === rightEmpty) return [];

    const code = shape.toShapeCode();
    return code ? [code] : [];
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
