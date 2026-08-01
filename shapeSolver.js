import { shapeSolver } from './shapeSolverCore.js';
import { shapeExplorer } from './shapeExplorerCore.js';
import { solveConstructive } from './shapeSolverConstructive.js';
import { clampExploreDepth } from './exploreDepth.js';

let cancelled = false;
const shouldCancel = () => cancelled;
const onProgress = (message) => self.postMessage({ type: 'status', message });

self.onmessage = async function (e) {
    const { action, data } = e.data;

    if (action === 'solve') {
        cancelled = false;
        // Three distinct budgets — keep the names separate end-to-end:
        //   maxStatesPerLevel  BFS beam width (per-depth prune)
        //   maxStates          global distinct-state ceiling (optional; browser omits → Infinity)
        //   nodeBudget         Constructive per-node A* budget (fail-fast → decompose)
        // The UI shares one numeric field for beam vs nodeBudget (label switches by
        // method); the payload always uses the correct key so callers never alias them.
        const {
            targetShapeCode,
            startingShapeCodes,
            enabledOperations,
            maxLayers,
            maxStatesPerLevel,
            nodeBudget,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor = 0.1,
            searchMethod = 'A*',
            maxStates
        } = data;
        try {
            // Constructive calls core shapeSolver as a bounded subroutine and is
            // dispatched here (not in core) to avoid an import cycle.
            const result = searchMethod === 'Constructive'
                ? await solveConstructive(
                    targetShapeCode,
                    startingShapeCodes,
                    enabledOperations,
                    {
                        maxLayers,
                        preventWaste,
                        orientationSensitive,
                        monolayerPainting,
                        heuristicDivisor,
                        shouldCancel,
                        onProgress,
                        nodeBudget: nodeBudget || 4000,
                    }
                )
                : await shapeSolver(
                    targetShapeCode,
                    startingShapeCodes,
                    enabledOperations,
                    {
                        maxLayers,
                        maxStatesPerLevel,
                        preventWaste,
                        orientationSensitive,
                        monolayerPainting,
                        heuristicDivisor,
                        searchMethod,
                        shouldCancel,
                        onProgress,
                        maxStates,
                    }
                );
            if (!cancelled) self.postMessage({ type: 'result', result });
        } catch (err) {
            self.postMessage({ type: 'error', message: `Error: ${err.message}` });
        }
    } else if (action === 'explore') {
        cancelled = false;
        const { startingShapeCodes, enabledOperations, depthLimit, maxLayers, targetShapeCode } = data;
        try {
            const graph = await shapeExplorer(
                startingShapeCodes,
                enabledOperations,
                // Clamped here as well as in the UI: the explorer has no state
                // cap, so an unbounded depth arriving from any caller grows the
                // graph until the tab OOMs.
                clampExploreDepth(depthLimit),
                maxLayers || 4,
                shouldCancel,
                onProgress,
                targetShapeCode || null
            );
            if (!cancelled) self.postMessage({ type: 'result', result: graph });
        } catch (err) {
            self.postMessage({ type: 'error', message: `Error: ${err.message}` });
        }
    } else if (action === 'cancel') {
        cancelled = true;
        self.postMessage({ type: 'status', message: 'Cancelled.' });
    }
};
