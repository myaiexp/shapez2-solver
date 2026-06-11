// Pure, stateless decomposition splits + cost metric for the Constructive planner.
// Each split takes a shape-code and returns piece shape-codes in fold order (the
// orchestrator left-folds them with stack), or null when the split does not apply.
// No mutation of cached shapes: we read parsed shapes to inspect quadrants and
// build brand-new code strings.

import { getCachedShape } from './shapeSolverCache.js';
import { SHAPE_LAYER_SEPARATOR, NOTHING_CHAR } from './shapeClass.js';

const EMPTY_PART = NOTHING_CHAR + NOTHING_CHAR; // '--'
const partCode = (part) => part.shape + part.color;
const isMultiLayer = (code) => code.includes(SHAPE_LAYER_SEPARATOR);

// Multi-layer -> the layers, BOTTOM first (Shape.fromShapeCode treats the first
// ':'-segment as the floor layer). Single-layer -> null.
export function splitByLayer(code) {
    if (!isMultiLayer(code)) return null;
    return code.split(SHAPE_LAYER_SEPARATOR);
}

// Single-layer only. One positioned single-quadrant code per occupied quadrant,
// in quadrant order. Null for multi-layer input or fewer than 2 occupied quadrants
// (a single occupied quadrant is the recursion base case, not decomposable).
export function splitByQuadrant(code) {
    if (isMultiLayer(code)) return null;
    const layer = getCachedShape(code).layers[0];
    const n = layer.length;
    const occupied = [];
    for (let q = 0; q < n; q++) {
        if (layer[q].shape !== NOTHING_CHAR) occupied.push(q);
    }
    if (occupied.length < 2) return null;
    return occupied.map((q) => {
        const parts = new Array(n).fill(EMPTY_PART);
        parts[q] = partCode(layer[q]);
        return parts.join('');
    });
}

// Single-layer only. [leftHalf, rightHalf] as positioned 2-quadrant codes. Null
// for multi-layer input or when either half is entirely empty (a half-split into
// one empty piece is useless — by-quadrant covers that case).
export function splitByHalf(code) {
    if (isMultiLayer(code)) return null;
    const layer = getCachedShape(code).layers[0];
    const n = layer.length;
    const half = Math.floor(n / 2);
    const leftOccupied = layer.slice(0, half).some((p) => p.shape !== NOTHING_CHAR);
    const rightOccupied = layer.slice(half).some((p) => p.shape !== NOTHING_CHAR);
    if (!leftOccupied || !rightOccupied) return null;
    const parts = layer.map(partCode);
    const left = parts.map((p, i) => (i < half ? p : EMPTY_PART)).join('');
    const right = parts.map((p, i) => (i >= half ? p : EMPTY_PART)).join('');
    return [left, right];
}

// ---------------------------------------------------------------------------
// Cost metric — the operational definition of "intelligent".
// ---------------------------------------------------------------------------
// opCountOf: total steps when the plan is flattened, with memoized (object-shared)
// sub-plans counted exactly ONCE. A direct-search leaf contributes its search
// path length; a split contributes (children.length - 1) assembly stacks plus
// its children. Reuse — the same Plan object appearing more than once — is the
// shared-sub-factory that the cost rewards by counting it a single time.
export function opCountOf(plan) {
    const seen = new Set();
    function walk(p) {
        if (seen.has(p)) return 0; // already counted this exact sub-plan
        seen.add(p);
        if (p.method === 'direct-search') return p.steps.length;
        let total = Math.max(0, p.children.length - 1); // assembly stacks (n-1)
        for (const child of p.children) total += walk(child);
        return total;
    }
    return walk(plan);
}

// depthOf: decomposition-recursion depth. A direct-search leaf is 0; a split is
// 1 + the deepest child. A flat by-quadrant split (depth 1) is therefore shallower
// than a nested by-half→by-quadrant plan (depth 2), so on an op-count tie the
// flatter, more-parallel decomposition is preferred.
export function depthOf(plan) {
    if (plan.method === 'direct-search') return 0;
    if (!plan.children || plan.children.length === 0) return 0;
    return 1 + Math.max(...plan.children.map(depthOf));
}

// Reuse-credited op count, with shallower decomposition depth as the tie-break.
export function cost(plan) {
    return opCountOf(plan) + depthOf(plan) * 1e-6;
}
