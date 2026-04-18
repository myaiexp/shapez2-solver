import { Shape } from './shapeOperations.js';

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
export const operationResultCache = new Map();

export function getCachedOpResult1(opName, fn, inputShape, config) {
    const key = `${opName}|${inputShape.toShapeCode()}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, config);
        operationResultCache.set(key, result);
    }
    return result;
}

export function getCachedOpResult1Color(opName, fn, inputShape, color, config) {
    const key = `${opName}|${inputShape.toShapeCode()}|${color}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, color, config);
        operationResultCache.set(key, result);
    }
    return result;
}

export function getCachedOpResult2(opName, fn, inputShape1, inputShape2, config) {
    const key = `${opName}|${inputShape1.toShapeCode()}|${inputShape2.toShapeCode()}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape1, inputShape2, config);
        operationResultCache.set(key, result);
    }
    return result;
}
