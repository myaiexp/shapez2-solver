import { NOTHING_CHAR } from './shapeClass.js';
import { getAllRotations } from './shapeOperations.js';
import { getPaintColors, getCrystalColors } from './shapeAnalysis.js';
import {
    getCachedOpResult1,
    getCachedOpResult1Color,
    getCachedOpResult2
} from './shapeSolverCache.js';

// Build a single-input successor descriptor from an op's raw output shapes.
// Returns null when no usable output remains.
export function buildSingleInputDescriptor(opName, id, inputCode, outputs, color) {
    const outputCodes = [];
    for (const outputShape of outputs) {
        if (outputShape.isEmpty()) continue;
        const outCode = outputShape.toShapeCode();
        if (outCode === inputCode) continue;
        outputCodes.push(outCode);
    }
    return outputCodes.length > 0
        ? { type: opName, inputIds: [id], outputCodes, color }
        : null;
}

// Build a two-input successor descriptor. Returns null on no-op or empty outputs.
export function buildBinaryInputDescriptor(opName, id1, id2, inputCode1, inputCode2, outputs) {
    const outputCodes = [];
    let isNoOp = true;
    for (const outputShape of outputs) {
        if (outputShape.isEmpty()) continue;
        const outCode = outputShape.toShapeCode();
        if (outCode !== inputCode1 && outCode !== inputCode2) isNoOp = false;
        outputCodes.push(outCode);
    }
    if (isNoOp && outputCodes.length === 2) return null;
    return outputCodes.length > 0
        ? { type: opName, inputIds: [id1, id2], outputCodes, color: null }
        : null;
}

// Solver-style unary pruning (rotation symmetry, empty-half cuts, monolayer painting).
// Trash is handled separately by the solver; the explorer records trash for visualization.
export function shouldSkipUnaryOp(opName, inputShape, {
    config,
    monolayerPainting = false,
    availableIdsSize = Infinity,
}) {
    if (inputShape.isEmpty()) return true;

    if (opName === 'Trash' && availableIdsSize === 1) return true;

    if (opName === 'Rotator CW' || opName === 'Rotator CCW' || opName === 'Rotator 180') {
        const rotations = getAllRotations(inputShape, config);
        if (rotations.size === 1) return true;
        if (opName === 'Rotator 180' && rotations.size <= 2) return true;
    }

    if (opName === 'Cutter' || opName === 'Half Destroyer') {
        // A cut is a pure no-op only when one whole side is empty across EVERY
        // layer — then one piece is empty and the other is the untouched input.
        // Inspecting layer 0 alone wrongly prunes multi-layer shapes whose empty
        // halves sit on different layers (e.g. CuCu----:----SuSu cuts into two
        // useful pieces), silently making such targets unreachable via cutting.
        const half = Math.floor(inputShape.numParts / 2);
        const leftEmpty = inputShape.layers.every(layer => layer.slice(0, half).every(p => p.shape === NOTHING_CHAR));
        const rightEmpty = inputShape.layers.every(layer => layer.slice(half).every(p => p.shape === NOTHING_CHAR));
        if (leftEmpty || rightEmpty) return true;
    }

    if (monolayerPainting && opName === 'Painter' && inputShape.layers.length !== 1) {
        return true;
    }

    return false;
}

// Target-aware color enumeration aligned with shapeSolverCore generateSuccessors.
// When target is null, unions colors implied by referenceCodes (all shapes in the run).
export function enumerateUnaryColors(opName, inputShape, {
    target = null,
    targetCrystalColors = null,
    referenceCodes = [],
    getShape,
}) {
    if (opName === 'Painter') {
        if (target) return getPaintColors(inputShape, target);
        const colors = new Set();
        for (const code of referenceCodes) {
            for (const c of getPaintColors(inputShape, getShape(code))) colors.add(c);
        }
        return Array.from(colors);
    }
    if (opName === 'Crystal Generator') {
        if (target) return targetCrystalColors ?? getCrystalColors(target);
        const colors = new Set();
        for (const code of referenceCodes) {
            for (const c of getCrystalColors(getShape(code))) colors.add(c);
        }
        return colors.size > 0 ? Array.from(colors) : ['u'];
    }
    return [null];
}

function runUnaryOp(opName, fn, inputShape, color, config, useCache) {
    if (color != null) {
        return useCache
            ? getCachedOpResult1Color(opName, fn, inputShape, color, config)
            : fn(inputShape, color, config);
    }
    return useCache
        ? getCachedOpResult1(opName, fn, inputShape, config)
        : fn(inputShape, config);
}

function runBinaryOp(opName, fn, inputShape1, inputShape2, config, useCache) {
    return useCache
        ? getCachedOpResult2(opName, fn, inputShape1, inputShape2, config)
        : fn(inputShape1, inputShape2, config);
}

// Expand one unary op application into zero or more lightweight descriptors.
export function expandUnaryOp(opName, op, id, inputCode, inputShape, config, options) {
    const {
        needsColor,
        pruning = {},
        colorContext = {},
        useCache = true,
    } = options;

    if (shouldSkipUnaryOp(opName, inputShape, { config, ...pruning })) {
        return [];
    }

    const descriptors = [];
    if (needsColor) {
        const colors = enumerateUnaryColors(opName, inputShape, colorContext);
        for (const color of colors) {
            const outputs = runUnaryOp(opName, op.fn, inputShape, color, config, useCache);
            const desc = buildSingleInputDescriptor(opName, id, inputCode, outputs, color);
            if (desc) descriptors.push(desc);
        }
    } else {
        const outputs = runUnaryOp(opName, op.fn, inputShape, null, config, useCache);
        const desc = buildSingleInputDescriptor(opName, id, inputCode, outputs, null);
        if (desc) descriptors.push(desc);
    }
    return descriptors;
}

export function expandBinaryOp(opName, op, id1, id2, inputCode1, inputCode2, inputShape1, inputShape2, config, { useCache = true } = {}) {
    if (inputShape1.isEmpty() || inputShape2.isEmpty()) return null;
    const outputs = runBinaryOp(opName, op.fn, inputShape1, inputShape2, config, useCache);
    return buildBinaryInputDescriptor(opName, id1, id2, inputCode1, inputCode2, outputs);
}