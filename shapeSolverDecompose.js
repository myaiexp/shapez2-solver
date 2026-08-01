// Pure, stateless decomposition splits + cost metric for the Constructive planner.
// Each split takes a shape-code and returns piece shape-codes in fold order (the
// orchestrator left-folds them with stack), or null when the split does not apply.
// No mutation of cached shapes: we read parsed shapes to inspect quadrants, then
// route serialization through the canonical layerToCode codec (never re-joining
// part codes by hand) so splits can't drift from Shape.toShapeCode.

import { getCachedShape } from './shapeSolverCache.js';
import { SHAPE_LAYER_SEPARATOR, NOTHING_CHAR, layerToCode, ShapePart } from './shapeClass.js';
import {
    isLeftHalfEmpty,
    isRightHalfEmpty,
    buildLeftHalfParts,
    buildRightHalfParts,
} from './shapeHalfGeometry.js';

// A single empty ('--') part, reused read-only as filler for unoccupied slots.
// layerToCode only reads .shape/.color, so sharing one instance is safe.
const EMPTY_PART = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
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
        parts[q] = layer[q];
        return layerToCode(parts);
    });
}

// Single-layer only. [leftHalf, rightHalf] in cut() product order (trailing,
// leading) as positioned codes. Null for multi-layer input or when either half
// is entirely empty (a half-split into one empty piece is useless — by-quadrant
// covers that case). Geometry from shapeHalfGeometry so odd/hex part counts match cut.
export function splitByHalf(code) {
    if (isMultiLayer(code)) return null;
    const layer = getCachedShape(code).layers[0];
    if (isLeftHalfEmpty(layer) || isRightHalfEmpty(layer)) return null;
    return [
        layerToCode(buildLeftHalfParts(layer, EMPTY_PART)),
        layerToCode(buildRightHalfParts(layer, EMPTY_PART)),
    ];
}

// ---------------------------------------------------------------------------
// Cost metric — the operational definition of "intelligent".
// ---------------------------------------------------------------------------
// A plan that solved its target in zero steps IS a starting shape. It is the one
// piece a second consumer can have for free — flatten draws it another feed
// instead of splitting a belt — so both the cost metric and flatten key off this.
export const isBareStart = (plan) => plan.method === 'direct-search' && plan.steps.length === 0;

// opCountOf: total steps when the plan is flattened. A direct-search leaf
// contributes its search path length; a split contributes (children.length - 1)
// assembly stacks plus its children. Reuse — the same Plan object appearing more
// than once — is the shared-sub-factory the cost rewards: it is built once and
// its product copied, so every EXTRA consumer costs only `reuseCost` (the one
// Belt Split that flatten emits to fan it out), not the sub-plan again.
//
// Pass reuseCost: null when Belt Split is unavailable — flatten then re-builds
// the sub-plan per consumer, so reuse earns no credit at all and each occurrence
// must be charged in full. A zero-step leaf (the piece IS a starting shape) is
// the one free case either way: flatten draws it a second feed, no op at all.
export function opCountOf(plan, { reuseCost = 1 } = {}) {
    const seen = new Set();
    function walk(p) {
        if (seen.has(p) && isBareStart(p)) return 0;             // second feed, free
        if (reuseCost !== null && seen.has(p)) return reuseCost; // one split per extra consumer
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
// `opts` is forwarded to opCountOf (see reuseCost there).
export function cost(plan, opts) {
    return opCountOf(plan, opts) + depthOf(plan) * 1e-6;
}
