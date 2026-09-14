// Bounds for the space explorer's BFS: the depth clamp and the node cap.
//
// Every extra level re-applies every enabled operation across the whole
// frontier, so shapes, op nodes and edges grow multiplicatively with depth. At
// the UI defaults (4 starts, all ops) depth 2 is 2052 shapes + 2846 ops, while
// depth 3 runs through gigabytes of heap without finishing. Two bounds keep
// that out of the browser:
//   - depth: an empty field or a typo'd 99 is clamped to [1, MAX], default 2
//   - nodes: the worker passes DEFAULT_EXPLORE_MAX_NODES, so any depth stops at
//     a graph renderSpaceGraph can still hydrate (one canvas, data URL and
//     THREE texture per shape node, all on the main thread)
//
// These bounds guard the UI/worker boundary only. The CLI harness
// (`tests/shared/solve.mjs --explore N`) calls shapeExplorer directly and sets
// its own `--max-nodes`, so deliberate deep runs outside the browser still work.
export const DEFAULT_EXPLORE_DEPTH = 2;
export const MAX_EXPLORE_DEPTH = 8;

// Shape nodes + op nodes. Holds the complete default-depth graph at the UI
// defaults (4898 nodes) with headroom, so a first Explore click is never cut
// short; tests/solver/shapeExplorerNodeCap.test.js pins that.
export const DEFAULT_EXPLORE_MAX_NODES = 6000;

// Coerce whatever the UI (or a worker message) supplies into a usable depth:
// empty/absent/non-numeric -> the safe default, out-of-range -> clamped.
export function clampExploreDepth(value) {
    if (value === null || value === undefined) return DEFAULT_EXPLORE_DEPTH;
    if (typeof value === 'string' && value.trim() === '') return DEFAULT_EXPLORE_DEPTH;

    // Only NaN (non-numeric) falls back to the default. +/-Infinity is a
    // meaningful request for "as deep as possible", so it clamps to the bounds
    // like any other out-of-range number — that request is the footgun itself.
    const depth = Math.floor(Number(value));
    if (Number.isNaN(depth)) return DEFAULT_EXPLORE_DEPTH;

    return Math.min(Math.max(depth, 1), MAX_EXPLORE_DEPTH);
}
