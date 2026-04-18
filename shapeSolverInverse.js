import {
    Shape, ShapePart, NOTHING_CHAR, SHAPE_LAYER_SEPARATOR,
    UNPAINTABLE_SHAPES,
    rotate90CW, rotate90CCW, rotate180
} from './shapeOperations.js';

/**
 * Unpaint: set all paintable parts on the top layer to uncolored.
 * Returns an array of shape codes (one per possible original color).
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

        const bottomCode = bottomLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);

        const topCode = topLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);

        results.push(bottomCode, topCode);
    }
    return results;
}

/**
 * Uncut: the shape is one half of a cut result. Generate possible whole shapes
 * by pairing with an empty half or a mirrored copy.
 */
export function inverseUncut(shape, config) {
    const results = [];
    if (shape.numLayers !== 1) return results;

    const numParts = shape.numParts;
    const half = Math.floor(numParts / 2);
    const layer = shape.layers[0];

    // Check if this is a left half (right side empty) or right half (left side empty)
    const leftEmpty = layer.slice(0, half).every(p => p.shape === NOTHING_CHAR);
    const rightEmpty = layer.slice(half).every(p => p.shape === NOTHING_CHAR);

    if (rightEmpty) {
        // This was the left output of a cut — the original had these parts on the left
        // and anything on the right
        const wholeParts = layer.map((p, i) => i < half ? p : new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        // Just stacking with empty right gives us back
        const wholeCode = wholeParts.map(p => p.shape + p.color).join('');
        results.push(wholeCode);
    }
    if (leftEmpty) {
        // This was the right output
        const wholeParts = layer.map((p, i) => i >= half ? p : new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        const wholeCode = wholeParts.map(p => p.shape + p.color).join('');
        results.push(wholeCode);
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
        const code = remainingLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);
        results.push(code);
    }
    return results;
}
