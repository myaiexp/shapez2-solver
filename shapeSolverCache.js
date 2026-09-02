import { Shape } from './shapeClass.js';

// ---------------------------------------------------------------------------
// Optimization 1: Shape Parsing Cache
// ---------------------------------------------------------------------------
export const shapeCache = new Map();

export function getCachedShape(code) {
    let shape = shapeCache.get(code);
    if (!shape) {
        shape = Shape.fromShapeCode(code);
        shapeCache.set(code, shape);
    }
    return shape;
}

// ---------------------------------------------------------------------------
// Optimization 7: Operation Result Cache
// ---------------------------------------------------------------------------
// Keys include maxShapeLayers: Pin Pusher / Stacker drop overflow layers, so
// the same op+code under two caps must not share an entry.
export const operationResultCache = new Map();

export function getCachedUnaryResult(opName, fn, inputShape, config) {
    const key = `${opName}|${inputShape.toShapeCode()}|${config.maxShapeLayers}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, config);
        operationResultCache.set(key, result);
    }
    return result;
}

export function getCachedColoredUnaryResult(opName, fn, inputShape, color, config) {
    const key = `${opName}|${inputShape.toShapeCode()}|${color}|${config.maxShapeLayers}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, color, config);
        operationResultCache.set(key, result);
    }
    return result;
}

export function getCachedBinaryResult(opName, fn, inputShape1, inputShape2, config) {
    const key = `${opName}|${inputShape1.toShapeCode()}|${inputShape2.toShapeCode()}|${config.maxShapeLayers}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape1, inputShape2, config);
        operationResultCache.set(key, result);
    }
    return result;
}
