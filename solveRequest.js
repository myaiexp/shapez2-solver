// Worker payloads for Solve and Explore. The shared budget input is one number
// written to both maxStatesPerLevel (BFS beam) and nodeBudget (Constructive's
// per-node cap). The browser never sends maxStates — that global ceiling stays
// uncapped and Cancel is the stop.
import { filterStartingShapes } from './startingShapes.js';
import { clampExploreDepth } from './exploreDepth.js';

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
            nodeBudget: budget,
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
