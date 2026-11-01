// Worker payloads for Solve and Explore. The shared budget input is one number
// written to both maxStatesPerLevel (BFS beam) and nodeBudget (Constructive's
// per-node cap). Every solve also sends the global maxStates ceiling.
import { filterStartingShapes } from './startingShapes.js';
import { clampExploreDepth } from './exploreDepth.js';

// Distinct states a browser solve may hold before it stops with the 'state
// limit' message. Cancel stays the fast stop; this one exists because a hopeless
// search otherwise grows until the renderer runs out of memory and takes the
// tab with it (a worker shares its tab's process).
//
// Measured peak live heap per state on CrRgSbWy: 1.4 KB for A* and Bidirectional
// at the defaults, 1 KB for BFS, 0.55 KB for IDA*, and 3 KB for A* at 6 layers
// with Prevent Waste. So this holds about 700 MB at the defaults and 1.5 GB at
// that worst case, inside the 2 GB V8 heap limit of smaller desktops. There is
// no portable way to read the real limit, so a count sized to the worst case
// stands in: performance.memory is Chromium-only and Firefox has no equivalent.
export const DEFAULT_SOLVE_MAX_STATES = 500_000;

export function buildSolveRequest({
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    maxLayers,
    budget,
    preventWaste,
    orientationSensitive,
    monolayerPainting,
    heuristicDivisor,
    searchMethod,
    filterUnusedShapes,
}) {
    let starting = startingShapeCodes;
    let filteredOut = 0;
    if (filterUnusedShapes && starting.length > 0) {
        const next = filterStartingShapes(starting, targetShapeCode);
        filteredOut = starting.length - next.length;
        starting = next;
    }
    return {
        request: {
            targetShapeCode,
            startingShapeCodes: starting,
            enabledOperations,
            maxLayers,
            maxStatesPerLevel: budget,
            // Constructive passes this to core as maxStates, so the ceiling has
            // to hold here too. BFS checks maxStates itself.
            nodeBudget: Math.min(budget, DEFAULT_SOLVE_MAX_STATES),
            maxStates: DEFAULT_SOLVE_MAX_STATES,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor,
            searchMethod,
        },
        filteredOut,
    };
}

// `targetShapeCode` is forwarded as given (trimmed); an empty target is null
// because Explore treats it as optional color context, not a goal.
export function buildExploreRequest({
    startingShapeCodes,
    enabledOperations,
    depthLimit,
    maxLayers,
    targetShapeCode,
}) {
    const target = (targetShapeCode ?? '').trim();
    return {
        startingShapeCodes,
        enabledOperations,
        depthLimit: clampExploreDepth(depthLimit),
        maxLayers,
        targetShapeCode: target || null,
    };
}
