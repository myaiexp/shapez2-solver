// Half-split geometry for Cutter / Half Destroyer / Swapper / decompose.
//
// Quadrants are indexed clockwise from top-right (0=TR, 1=BR, 2=BL, 3=TL).
// LEADING indices form the RIGHT half; TRAILING indices form the LEFT half.
// cut() returns halves in [left, right] order — this module is the sole source
// of that convention so inverse, expansion pruning, and decompose stay in sync
// with the live cut product (including odd/hex part counts via ceil/floor sizes).

import { NOTHING_CHAR } from './shapeClass.js';

/** Trailing half size (left product of cut). ceil so odd rings favour the left. */
export function leftHalfSize(numParts) {
    return Math.ceil(numParts / 2);
}

/** Leading half size (right product of cut). */
export function rightHalfSize(numParts) {
    return numParts - leftHalfSize(numParts);
}

/** True when every part of the left (trailing) half of a layer is empty. */
export function isLeftHalfEmpty(layer) {
    const right = rightHalfSize(layer.length);
    for (let i = right; i < layer.length; i++) {
        if (layer[i].shape !== NOTHING_CHAR) return false;
    }
    return true;
}

/** True when every part of the right (leading) half of a layer is empty. */
export function isRightHalfEmpty(layer) {
    const right = rightHalfSize(layer.length);
    for (let i = 0; i < right; i++) {
        if (layer[i].shape !== NOTHING_CHAR) return false;
    }
    return true;
}

/** Shape-level: left (trailing) half empty on every layer. */
export function isLeftHalfEmptyShape(shape) {
    return shape.layers.every(isLeftHalfEmpty);
}

/** Shape-level: right (leading) half empty on every layer. */
export function isRightHalfEmptyShape(shape) {
    return shape.layers.every(isRightHalfEmpty);
}

/**
 * Build a positioned left half from a layer: trailing parts kept, leading emptied.
 * `emptyPart` is reused read-only (serializers only read .shape/.color).
 */
export function buildLeftHalfParts(layer, emptyPart) {
    const n = layer.length;
    const leftSize = leftHalfSize(n);
    const rightSize = rightHalfSize(n);
    const out = new Array(n);
    for (let i = 0; i < rightSize; i++) out[i] = emptyPart;
    for (let i = 0; i < leftSize; i++) out[rightSize + i] = layer[rightSize + i];
    return out;
}

/**
 * Build a positioned right half from a layer: leading parts kept, trailing emptied.
 */
export function buildRightHalfParts(layer, emptyPart) {
    const n = layer.length;
    const leftSize = leftHalfSize(n);
    const rightSize = rightHalfSize(n);
    const out = new Array(n);
    for (let i = 0; i < rightSize; i++) out[i] = layer[i];
    for (let i = 0; i < leftSize; i++) out[rightSize + i] = emptyPart;
    return out;
}
