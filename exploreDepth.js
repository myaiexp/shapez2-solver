// Bounds for the space explorer's BFS depth.
//
// Unlike the solver, the explorer has no state cap (`maxStates`): every extra
// level re-applies every enabled operation across the whole frontier, so shapes,
// op nodes and edges grow multiplicatively and a large depth OOMs the tab long
// before it finishes. The depth input is therefore the ONLY bound on that
// growth, which makes an empty field or a typo'd 99 a real footgun — hence a
// small default and a hard ceiling.
//
// These bounds guard the UI/worker boundary only. The CLI harness
// (`tests/shared/solve.mjs --explore N`) calls shapeExplorer directly and stays
// unclamped, so deliberate deep runs outside the browser still work.
export const DEFAULT_EXPLORE_DEPTH = 3;
export const MAX_EXPLORE_DEPTH = 8;

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
